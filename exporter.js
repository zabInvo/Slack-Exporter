require("dotenv").config();
const { WebClient } = require("@slack/web-api");

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
    res.status(200).json({ messages: allMessages, replies: allReplies });
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
  const data = await web.users.info({ token, user: userId });

  console.log(data);
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
};
