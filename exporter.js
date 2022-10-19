require("dotenv").config();
const process = require("process");
const token = process.env.SLACK_USER_TOKEN;
const axios = require("axios");
const https = require("https");
const FormData = require("form-data");

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
  console.log(ev);
};

const updateMapping = async (req, res) => {
  try {
    const record = await slackChannelsModel.findOne({
      where: { slackId: req.body.id },
    });
    if (record) {
      await record.update({
        mattermostName: req.body.mattermostName,
        forwardUrl: req.body.forwardUrl,
      });
      res.sendStatus(200);
    }
  } catch (error) {
    res.send(error);
  }
};

const exportToMattermost = async (req, res) => {
  try {
    console.log(req.body);
    exporter.channelId = req.body.channelId;
    exporter.mattermostName = req.body.mattermostName;

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
    // Get The Initial Message from slack...
    // const message = await web.conversations.history({
    //   channel: exporter.channelId,
    //   limit: 1,
    //   cursor: cursor,
    // });

    currentMessage = completeMessages[postingCount];

    // from the messages user id, fetch username
    const username = await web.users.info({
      user: currentMessage.user,
    });

    // Step 1. Check if message contains files..
    if (currentMessage.files) {
      // if there are files, add filed message.
      console.log("going in files function...");
      resp = await loopForFiles(
        currentMessage.files,
        currentMessage.text,
        username.user.real_name
      );

      console.log(
        "message with attachment function has completed.... on to replies"
      );

      // Step 2. Check if message contains replies..
      if (currentMessage.reply_count) {
        await loopForReplies(
          exporter.channelId,
          currentMessage.ts,
          resp?.data?.id
        );
        console.log("replies function has completed.... moving to loop again!");
      }
    } else {
      // Simple post message to mattermost
      resp = await axios.post(
        BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
        {
          text: currentMessage.text,
          normal_hook: true,
          username: username.user.real_name,
          channel: exporter.mattermostName,
        },
        {
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      console.log("simple post function has completed.... on to replies");

      // Step 2. Check if message contains replies..
      if (currentMessage.reply_count) {
        await loopForReplies(
          exporter.channelId,
          currentMessage.ts,
          resp?.data?.id
        );
        console.log("replies function has completed.... moving to loop again!");
      }
    }

    // if (message.has_more) {
    //   // repeat the whole process..
    //   loopAndPost(message.response_metadata.next_cursor);
    // } else {
    //   return 1;
    // }

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
      // Get real name of the user...
      const realName = await web.users.info({
        user: reply.messages[ix]?.user,
      });

      console.log("checking for condition of reply-files!");
      !reply.messages[ix].files
        ? await axios.post(
            BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
            {
              root_id: identity,
              text: reply.messages[ix]?.text,
              normal_hook: true,
              username: realName?.user.real_name,
              channel: exporter.mattermostName,
            },
            {
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
            }
          )
        : await loopForFiles(
            reply.messages[ix]?.files,
            reply.messages[ix]?.text,
            realName?.user?.real_name,
            true,
            identity
          );
    }
  } catch (error) {
    console.log(error);
  }
};

const loopForFiles = async (bundle, userMsg, userName, isReply, identity) => {
  let messageId = null;
  // Fetch ALL files from slack, and then send only one save request to database.
  const fetchFromSlack = async (indx, bundle) => {
    // console.log("index no " + indx);
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
      // After posting multiple files, we need to

      // if post id is not correct, undefined..
      messageId = await axios.post(
        BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
        {
          root_id: isReply ? identity : null,
          text: userMsg ? userMsg : " ",
          normal_hook: true,
          username: userName,
          channel: exporter.mattermostName,
          file_ids: postIds,
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

  console.log("bye files fn..");
  console.log(messageId?.data?.id);
  return messageId;
};

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchAllMessageWithTreads,
  slackMessageEv,
  syncHistroy,
  exportToMattermost,
  updateMapping,
};
