require("dotenv").config();

const { WebClient } = require("@slack/web-api");
const token = process.env.SLACK_USER_TOKEN;
const web = new WebClient(token);
let recovery = {
  channelId: null,
  lastCursor: null,
  data: [],
};
// Complete messages being stored into an array.

// Find conversation ID using the conversations.list method
const findChannels = async (req, res) => {
  try {
    const type = req.body.type;
    const result = await web.conversations.list({
      types: type,
    });
    res.status(200).json({ data: result.channels });
  } catch (error) {
    console.error(error);
  }
};

const fetchConversationHistroy = async (req, res) => {
  try {
    const channelId = req.body.channelId;

    console.log("channelId", req.body);
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
    console.log(message.text);
    res.status(200).json({ data: message });
  } catch (error) {
    console.error(error);
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
    recovery.channelId = req.body.channelId;

    // Complete messages being stored into an array.
    let allMessages = [];
    // Complete replies being stored into an array.
    let allReplies = [];
    // Cursor changes overtime as new requests update it.
    let cursor = null;
    const response = await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      100,
      cursor
    );
    res.status(200).json({ messages: allMessages, replies: allReplies });
  } catch (error) {
    console.error(error);
    // fetchConversationHistroy
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const getCompleteMessageHistroy = async (
  allMessages,
  allReplies,
  channelId,
  limit,
  cursor
) => {
  // fetchConversationHistroy
  let result = await web.conversations.history({
    channel: channelId,
    limit: limit,
    cursor: cursor,
  });

  // Push all messages into main message array
  recovery.data.push(result);
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
    await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      100,
      cursor
    );
  }
  return result;
};

const fetchRecoveryData = async (req, res) => {
  recovery.lastCursor =
    recovery.data[recovery.data.length - 1].response_metadata.next_cursor;

  recovery.data.length !== 0
    ? res.status(200).json({ status: "ok", recovery })
    : res.status(200).json({ status: "nothing to recover" });
};

const continueRecoveryData = async (req, res) => {
  let allMessages = [];
  let allReplies = [];

  let channelId = req.body.channelId;

  recovery.lastCursor = recovery.data[recovery.data.length - 1]
    ?.response_metadata?.next_cursor
    ? recovery.data[recovery.data.length - 1]?.response_metadata?.next_cursor
    : null;

  try {
    if (channelId === recovery.channelId) {
      const recovered = await getCompleteMessageHistroy(
        allMessages,
        allReplies,
        recovery.channelId,
        (limit = 100),
        recovery.lastCursor
      );

      res.status(200).json({ recovered: [recovery.data, recovered] });
    } else {
      res.status(200).json({
        status: "Error",
        message:
          "This channel was not being fetched recently, However data for channel " +
          recovery.channelId +
          " is available!",
        requestId: channelId,
        recoveryId: recovery.channelId,
      });
    }
  } catch (error) {
    res.send({ status: "Error", error });
  }

  // recovery.data is the data that was fetched via /fetch-all-message-with-threads
  // but failed due to some reason

  // recovered is the data continued from the last cursor of recovery data
};

const slackMessageEv = async (ev) => {
  console.log(ev);
};

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchAllMessageWithTreads,
  fetchRecoveryData,
  continueRecoveryData,
  slackMessageEv,
};
