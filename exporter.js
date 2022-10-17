require("dotenv").config();
const { WebClient } = require("@slack/web-api");
const axios = require("axios");
const https = require("https");
const fs = require("fs");
const FormData = require("form-data");

const token = process.env.SLACK_USER_TOKEN;
const web = new WebClient(token);

const slackChannelsModel = require("./models").SlackChannel;

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
    res.status(200).json({ data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const findDirectMessages = async (req, res) => {
  try {
    const type = req.body.type; // Can be either "private_channel", "public_channel", "mpim", "im"
    const result = await web.conversations.list({
      types: type,
    });

    res.status(200).json({ data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchDirectMessages = async (req, res) => {
  try {
    const id = req.body.id;
    const messages = await web.conversations.history({
      channel: id,
      limit: 100,
    });

    res.status(200).json({ data: messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchConversationHistroy = async (req, res) => {
  try {
    const channelId = req.body.channelId;
    let currentMessage;
    const result = await web.conversations.history({
      channel: channelId,
      limit: 100,
    });

    currentMessage = result.messages;

    console.log(currentMessage.length + " messages found in " + channelId);
    res.status(200).json({ data: currentMessage });
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
    // const date = new Date();
    // await channelRecord.update({ lastUpdatedAt: date, status: "Completed" });
    // res.status(200).json({});
    res.status(200).json({
      messages: allMessages,
      replies: allReplies,
      lengths: {
        messagesLength: allMessages.length,
        repliesLength: allReplies.length,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchAllMessageInfo = async (req, res) => {
  try {
    // Extract the channel id.
    const channelId = req.body.channelId;
    const week = req.body.week;
    const limit = req.body.limit || 100;
    // Complete messages being stored into an array.
    let allMessages = [];
    // Complete replies being stored into an array.
    let allReplies = [];
    // Cursor changes overtime as new requests update it.
    let cursor = req.body.cursor || null;
    const channelRecord = await slackChannelsModel.findOne({
      where: {
        slackId: channelId,
      },
    });
    await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      limit,
      cursor,
      channelRecord
    );

    // Call all messages and sort by incoming date.
    const messages = new Array();
    const images = new Array();
    const videos = new Array();
    allMessages.map((message) => {
      const milliseconds = Number(message.ts.split(".")[0]) * 1000; // 1575909015000
      const dateObject = new Date(milliseconds);
      dateObject.toLocaleString("en-US", { weekday: "long" }); // Monday
      dateObject.toLocaleString("en-US", { month: "long" }); // December
      dateObject.toLocaleString("en-US", { day: "numeric" }); // 9
      dateObject.toLocaleString("en-US", { year: "numeric" }); // 2019
      dateObject.toLocaleString("en-US", { hour: "numeric" }); // 10 AM
      dateObject.toLocaleString("en-US", { minute: "numeric" }); // 30
      dateObject.toLocaleString("en-US", { second: "numeric" }); // 15
      dateObject.toLocaleString("en-US", { timeZoneName: "short" }); // 12/9/2019, 10:30:15 AM CST
      const humanDateFormat = dateObject.toLocaleString(); //2019-12-9 10:30:15
      if (!message.files) {
        messages.unshift(new Date(humanDateFormat).toString().slice(0, 10)); // (Thu Oct 6)
      } else if (
        message.type === "message" &&
        message.files &&
        message.files[0].mimetype.slice(0, 5) === "image"
      ) {
        images.unshift(new Date(humanDateFormat).toString().slice(0, 10)); // (Thu Oct 6)
      } else if (
        message.type === "message" &&
        message.files &&
        message.files[0].mimetype.slice(0, 5) === "video"
      ) {
        videos.unshift(new Date(humanDateFormat).toString().slice(0, 10)); // (Thu Oct 6)
      }
    });

    // timestamps = all the time from chat messages (slack)
    // week = data coming of the current week from front end (react)
    week.date.map((date, ix) => {
      messages.map((time, idx) => {
        if (date === time) {
          console.log("true");
          week.messages[ix] += 1;
        }
      });
      videos.map((time, idx) => {
        if (date === time) {
          console.log("true");
          week.videos[ix] += 1;
        }
      });
      images.map((time, idx) => {
        if (date === time) {
          console.log("true");
          week.images[ix] += 1;
        }
      });
    });

    console.log({
      messages: allMessages.length,
      total: {
        images: allMessages.filter(
          (message) =>
            message.type === "message" &&
            message.files &&
            message.files[0].mimetype.slice(0, 5) === "image"
        ).length,
        messages: allMessages.filter(
          (message) => message.type === "message" && !message.files
        ).length,
        videos: allMessages.filter(
          (message) =>
            message.type === "message" &&
            message.files &&
            message.files[0].mimetype.slice(0, 5) === "video"
        ).length,
      },
      week,
    });

    res.status(200).json({
      messages: allMessages.length,
      total: {
        images: allMessages.filter(
          (message) =>
            message.type === "message" &&
            message.files &&
            message.files[0].mimetype.slice(0, 5) === "image"
        ).length,
        messages: allMessages.filter(
          (message) => message.type === "message" && !message.files
        ).length,
        videos: allMessages.filter(
          (message) =>
            message.type === "message" &&
            message.files &&
            message.files[0].mimetype.slice(0, 5) === "video"
        ).length,
      },
      week,
    });
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

const slackMessageEv = async (ev) => {};

const fetchUserById = async (req, res) => {
  const userId = req.body.userId;
  const token = req.body.userId;
  const data = await web.users.info({
    token,
    user: userId,
  });

  console.log(data);
};

const exportToMattermost = async (req, res) => {
  try {
    const channelId = "C03N7TDEFLK";
    const mattermostChannelId = "training-golang";

    await loopAndPost();
    res
      .status(200)
      .json({ message: "data transfer has finished succesfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const loopAndPost = async (cursor = null) => {
  try {
    // Getting Message.
    let currentMessage;
    let resp;
    // Get The Initial Message from slack...
    const message = await web.conversations.history({
      channel: "C03N7TDEFLK",
      limit: 1,
      cursor: cursor,
    });

    currentMessage = message.messages[0];

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
      await loopForReplies("C03N7TDEFLK", currentMessage.ts, resp.data.id);
      console.log("replies function has completed.... moving to loop again!");
    } else {
      // Simple post message to mattermost
      resp = await axios.post(
        "http://10.10.21.132:8065/hooks/u457hbw49ff7u8tyaar51n64ce",
        {
          text: currentMessage.text,
          normal_hook: true,
          username: username.user.real_name,
          channel: "training-golang",
        }
      );

      console.log("simple post function has completed.... on to replies");

      // Step 2. Check if message contains replies..
      if (currentMessage.reply_count) {
        await loopForReplies("C03N7TDEFLK", currentMessage.ts, resp.data.id);
        console.log("replies function has completed.... moving to loop again!");
      }
    }

    if (message.has_more) {
      // repeat the whole process..
      loopAndPost(message.response_metadata.next_cursor);
    } else {
      return 1;
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
            "http://10.10.21.132:8065/hooks/u457hbw49ff7u8tyaar51n64ce",
            {
              root_id: identity,
              text: reply.messages[ix]?.text,
              normal_hook: true,
              username: realName?.user.real_name,
              channel: "training-golang",
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
      const URLsite = "http://10.10.21.132:8065/api/v4/files";
      let formData = new FormData();
      console.log(fileCollection?.length, "POSTING TO MATTERMOST!");
      fileCollection.map((file) => {
        formData.append("files", file);
      });
      formData.append("channel_id", "gatf9inux3885f49ijm94dkkgr");
      // formData.append("client_ids", "d3924d3d-5b15-4807-b55f-91cdcfc948d8");
      formData.append("Authorization", "Bearer w6d9e1857pfsu8u8hw67on1d4y");
      // All posted files will be received in the response
      let responseData = await axios.post(URLsite, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: "Bearer w6d9e1857pfsu8u8hw67on1d4y",
        },
      });
      // Will stay 0
      const postIds = responseData?.data?.file_infos?.map((el) => el.id);
      // After posting multiple files, we need to
      messageId = await axios.post(
        "http://10.10.21.132:8065/hooks/u457hbw49ff7u8tyaar51n64ce",
        {
          root_id: isReply ? identity : null,
          text: userMsg ? userMsg : " ",
          normal_hook: true,
          username: userName,
          channel: "training-golang",
          file_ids: postIds,
        }
      );
    } catch (error) {
      console.log("Error, please have a look at ", error);
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
  fetchAllMessageInfo,
  slackMessageEv,
  syncHistroy,
  fetchUserById,
  updateMapping,
  findDirectMessages,
  fetchDirectMessages,
  exportToMattermost,
};
