require("dotenv").config();
const process = require("process");
const token = process.env.SLACK_USER_TOKEN;
const axios = require("axios");
const https = require("https");
const FormData = require("form-data");
const userStore = [{ id: null, name: null }];

const { WebClient } = require("@slack/web-api");
const web = new WebClient(token);

const slackChannelsModel = require("./models").SlackChannel;

const exporter = new Object();

const BASEURL = "https://source-im.invo.zone";
const ACCESSTOKEN = "huokuoz633yupcqi9zti4ywdna";

// Find conversation ID using the conversations.list method
const findChannels = async (req, res) => {
  try {
    const type = req.body.type;
    const result = await web.conversations.list({
      types: type,
    });
    const channels = result.channels;
    for (let i = 0; i < channels.length; i++) {
      const channelExist = await slackChannelsModel.findOne({
        where: {
          slackId: channels[i].id,
        },
      });
      if (!channelExist) {
        const payload = {
          name: channels[i].name,
          slackId: channels[i].id,
          type: type,
          membersCount: channels[i].num_members,
          creationDate: channels[i].created,
        };
        await slackChannelsModel.create(payload);
      }
    }
    const allChannels = await slackChannelsModel.findAll({
      where: {
        type: type,
      },
      attributes: [
        "name",
        "slackId",
        "mattermostName",
        "mattermostId",
        "lastUpdatedAt",
        "lastCursor",
        "forwardUrl",
        "type",
        "membersCount",
        "creationDate",
        "status",
      ],
    });
    res.status(200).json({ data: allChannels });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchConversationHistroy = async (req, res) => {
  try {
    const channelId = req.body.channelId;
    let conversationHistory;
    const result = await web.conversations.history({
      channel: channelId,
      limit: 100,
    });

    conversationHistory = result.messages;

    console.log(conversationHistory.length + " messages found in " + channelId);
    res.status(200).json({ data: conversationHistory });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchMessageThread = async (req, res) => {
  try {
    const channelId = req.body.channelId;
    const messageId = req.body.messageId;
    const result = await web.conversations.replies({
      channel: channelId,
      ts: messageId,
    });
    message = result.messages;
    res.status(200).json({ data: message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const syncHistroy = async (req, res) => {
  try {
    const channelRecord = await slackChannelsModel.findOne({
      where: {
        slackId: req.body.channelId,
      },
    });
    await channelRecord.update({ status: "Pending" });
    fetchAllMessageWithTreads(req);
    res.status(200).json({ data: "Syncing start successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchAllMessageWithTreads = async (req, res) => {
  /*
   1. request via web.conversations.history without any cursor
   2A. if data doesnt have next_cursor, break the iterations and send the response
   2B. if data have next_cursor, send request again on web.conversations.history with cursor set until no cursor
  */

  try {
    // Extract the channel id.
    const channelId = req.body.channelId;
    const limit = req.body.limit || 100;
    // Complete messages being stored into an array.
    let allMessages = [];
    // Complete replies being stored into an array.
    let allReplies = [];
    // Cursor changes overtime as new requests update it.
    let cursor = req.body.cursor || null;
    const channelRecord = await slackChannelsModel.findOne({
      where: {
        slackId: req.body.channelId,
      },
    });
    const response = await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      limit,
      cursor,
      channelRecord
    );
    const date = new Date();
    await channelRecord.update({ lastUpdatedAt: date, status: "Completed" });
    return;
    // res.status(200).json({ messages: allMessages, replies: allReplies });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const getCompleteMessageHistroy = async (
  allMessages,
  allReplies,
  channelId,
  limit,
  cursor,
  channelRecord
) => {
  // fetchConversationHistroy
  let result = await web.conversations.history({
    channel: channelId,
    limit: limit,
    cursor: cursor,
  });

  // Push all messages into main message array
  let messages = result.messages;
  await messages.forEach((item) => {
    allMessages.push(item);
  });

  // replies id's being stored into an array for those messages where replies exists.
  let repliesIds = [];
  await messages.forEach((item) => {
    if (item.reply_count >= 1) {
      repliesIds.push(item.thread_ts);
    }
  });

  // fetchMessageThread
  for (let i = 0; i < repliesIds.length; i++) {
    const reply = await web.conversations.replies({
      channel: channelId,
      ts: repliesIds[i],
    });

    // Push all replies into main replies array
    allReplies.push(reply.messages);
  }

  // if more data exists then update cursor and re-calls the function, else return
  if (result.has_more === true) {
    cursor = result.response_metadata.next_cursor;
    if (channelRecord) {
      await channelRecord.update({ lastCursor: cursor });
    }
    await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      limit,
      cursor,
      channelRecord
    );
  }
  return result;
};

const slackMessageEv = async (ev) => {
  if (!ev.subtype) {
    console.log(ev.text);
  } else if (ev.subtype == "message_changed") {
    console.log(
      ev.previous_message.text + " is now --->>>>> " + ev.message.text
    );
  } else if (ev.subtype == "message_deleted") {
    console.log(ev.previous_message.text + " has now been deleted!");
  }
};

const updateMapping = async (req, res) => {
  try {
    const record = await slackChannelsModel.findOne({
      where: { slackId: req.body.id },
    });
    if (record) {
      await record.update({
        mattermostName: req.body.mattermostName,
        mattermostId: req.body.mattermostName,
      });
      res.sendStatus(200);
    }
  } catch (error) {
    res.send(error);
  }
};

const exportToMattermost = async (req, res) => {
  try {
    //Global Details
    exporter.channelId = req.body.channelId;
    exporter.mattermostName = req.body.mattermostName;

    // Get Users.
    exporter.usersInfo = new Array();
    await getChannelUsers(exporter.usersInfo);

    // Get Messages.
    const messages = new Array();
    await getCompleteMessageHistroy(
      messages,
      [],
      exporter.channelId,
      1000,
      null,
      null
    );

    const completeMessages = messages.reverse();

    let postingCount = 0;
    await loopAndPost(completeMessages, postingCount);

    res
      .status(200)
      .json({ message: "data transfer has finished succesfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const loopAndPost = async (completeMessages, postingCount) => {
  try {
    // Getting Message.
    let currentMessage;
    let resp;

    currentMessage = completeMessages[postingCount];
    // const username = await convertToName(currentMessage.user);
    const username = currentMessage.user;

    // Step 1. Check if message contains files..
    if (currentMessage.files) {
      // if there are files, add filed message.
      console.log("going in files function...");
      resp = await loopForFiles(
        currentMessage.files,
        currentMessage.text,
        username,
        currentMessage.ts
      );
      // Step 2. Check if message contains replies..
      if (currentMessage.reply_count) {
        await loopForReplies(
          exporter.channelId,
          currentMessage.ts,
          resp?.data?.id
        );
      }
    } else {
      // Simple post message to mattermost
      resp = await axios.post(
        BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
        {
          text: appendTextWithUserName(currentMessage.text, exporter.usersInfo),
          normal_hook: true,
          channel: exporter.mattermostName,
          create_at: parseInt(currentMessage.ts * 1000),
          user_email: getEmail(username),
        },
        {
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      // Step 2. Check if message contains replies..
      if (currentMessage.reply_count) {
        await loopForReplies(
          exporter.channelId,
          currentMessage.ts,
          resp?.data?.id
        );
      }
    }

    if (completeMessages[postingCount + 1]) {
      loopAndPost(completeMessages, ++postingCount);
    }
  } catch (error) {
    console.log(error);
    return -1;
  }
};

const loopForReplies = async (channelId, timestamp, identity) => {
  try {
    // Get All Replies for that message.
    const reply = await web.conversations.replies({
      channel: channelId,
      ts: timestamp, // id of that message whose reply we need..
    });

    for (let ix = 1; ix < reply.messages.length; ix++) {
      // const realName = await convertToName(reply.messages[ix]?.user);
      const realName = reply.messages[ix]?.user;
      !reply.messages[ix].files
        ? await axios.post(
            BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
            {
              root_id: identity,
              text: appendTextWithUserName(
                reply.messages[ix]?.text,
                exporter.usersInfo
              ),
              normal_hook: true,
              // username: realName,
              channel: exporter.mattermostName,
              create_at: parseInt(reply.messages[ix]?.ts * 1000),
              user_email: getEmail(realName),
            },
            {
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
            }
          )
        : await loopForFiles(
            reply.messages[ix]?.files,
            reply.messages[ix]?.text,
            realName,
            reply.messages[ix]?.ts,
            true,
            identity
          );
    }
  } catch (error) {
    console.log(error);
  }
};

const loopForFiles = async (
  bundle,
  userMsg,
  userName,
  createdAtDate,
  isReply,
  identity
) => {
  let messageId = null;
  // Fetch ALL files from slack, and then send only one save request to database.
  const fetchFromSlack = async (indx, bundle) => {
    return new Promise((resolve, reject) => {
      https.get(
        bundle[indx].url_private_download,
        {
          headers: { Authorization: "Bearer " + process.env.SLACK_USER_TOKEN },
        },
        async (res) => {
          filesFromSlack.push(res);

          // if there are more files... keep fetching...
          console.log("checking for condition");
          bundle[indx + 1]
            ? await fetchFromSlack(++indx, bundle)
            : await postToMm(filesFromSlack);

          resolve();
          // Done pushing, then resolving the loop.
        }
      );
    });
  };

  const postToMm = async (fileCollection) => {
    try {
      let formData = new FormData();
      console.log(fileCollection?.length, "POSTING TO MATTERMOST!");
      fileCollection.map((file) => {
        formData.append("files", file);
      });
      formData.append("channel_id", "mjkhchcykidofe9ncgtzbge3ec");
      formData.append("Authorization", "Bearer " + ACCESSTOKEN);
      // All posted files will be received in the response
      let responseData = await axios.post(BASEURL + "/api/v4/files", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: "Bearer " + ACCESSTOKEN,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      // Will stay 0
      const postIds = responseData?.data?.file_infos?.map((el) => el.id);
      console.log("postIds => " + postIds);
      console.log("createAtDate", createdAtDate);
      // After posting multiple files, we need to

      // if post id is not correct, undefined..
      messageId = await axios.post(
        BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
        {
          root_id: isReply ? identity : null,
          text: appendTextWithUserName(
            userMsg ? userMsg : " ",
            exporter.usersInfo
          ),
          normal_hook: true,
          // username: userName,
          channel: exporter.mattermostName,
          file_ids: postIds,
          create_at: parseInt(createdAtDate * 1000),
          user_email: "darab.monib@invozone.com",
        },
        {
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );
    } catch (error) {
      console.log("Error, please have a look at ", error);
      process.exit();
    }
  };

  // Get file data.
  const filesFromSlack = new Array();
  let bundleIndx = -1;
  await fetchFromSlack(++bundleIndx, bundle);

  return messageId;
};

const testMattermost = async (req, res) => {
  await axios.post(
    BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
    {
      text: "@furqanaziz here are the details?",
      normal_hook: true,
      username: "Node-Testing",
      channel: req.body.mattermostName,
      user_email: "darab.monib@invozone.com",
    },
    {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  res.status(200).json({
    success: true,
    body: { ...req.body },
  });
};

const getEmail = (id) => {
  const user = exporter.usersInfo.find((el) => el.id === id);
  // return user.email === undefined ? "furqan@invozone.com" : user.email;
  return "darab.monib@invozone.com";
};

const getChannelUsers = async (usersArr, cursor = null) => {
  const usersInfo = await web.users.list({
    cursor,
  });

  usersArr.push(
    ...usersInfo.members.map((el) => {
      return {
        id: el.id,
        name: el.name,
        display_name: el.profile.display_name,
        email: el.profile.email,
      };
    })
  );
  console.log("repeating!!", usersArr.length);

  if (usersInfo.response_metadata.next_cursor) {
    console.log(usersInfo.response_metadata.next_cursor);
    await getChannelUsers(usersArr, usersInfo.response_metadata.next_cursor);
  }

  return true;
};

const appendTextWithUserName = (text, allMembers) => {
  let checkString = indexesOf(text, /<@/g);
  let findNames = [];
  for (let i = 0; i < checkString.length; i++) {
    let completeId = text.substring(checkString[i], checkString[i] + 14);
    console.log(completeId);
    // let requiredId = text.substring(checkString[i] + 2, checkString[i] + 13);
    let requiredId = "";
    for (let ix = 2; ix < completeId.length; ix++) {
      if (completeId[ix] !== ">") {
        requiredId += completeId[ix];
      } else {
        break;
      }
    }
    let name = findName(allMembers, requiredId);
    if (name !== false) {
      findNames.push({ name: name, id: "<@" + requiredId + ">" });
    }
  }
  for (let i = 0; i < findNames.length; i++) {
    console.log("replacing", findNames[i].id, "with", findNames[i].name);
    text = text.replace(findNames[i].id, findNames[i].name);
  }
  return text;
};

const findName = (allMembers, userId) => {
  const user = allMembers.find((member) => {
    return member.id === userId;
  });
  if (typeof user === "undefined") {
    return false;
  }
  console.log("Returning @" + user.name);
  return "@" + user.name;
};

const indexesOf = (string, regex) => {
  let match,
    indexes = [];

  regex = new RegExp(regex);

  while ((match = regex.exec(string))) {
    indexes.push(match.index);
  }
  return indexes;
};

const getUser = async (req, res) =>
  res.send(await web.users.info({ user: req.body.user }));

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchAllMessageWithTreads,
  slackMessageEv,
  syncHistroy,
  exportToMattermost,
  updateMapping,
  testMattermost,
  getUser,
};
