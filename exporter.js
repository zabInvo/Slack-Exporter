require("dotenv").config();

const { WebClient } = require("@slack/web-api");

const axios = require("axios");
const https = require("https");
const FormData = require("form-data");
const fs = require("fs");

const token = process.env.SLACK_USER_TOKEN;
const web = new WebClient(token);
const BASEURL = "https://source-im.invo.zone";
const ACCESSTOKEN = "huokuoz633yupcqi9zti4ywdna";

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
    fetchAllMessageWithTreads(req, res);
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
    let rootIds = [];
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

    for (let i = allMessages.length - 1; i >= 0; i--) {
      const username = await web.users.info({
        user: allMessages[i].user,
      });
      if (allMessages[i].files) {
        console.log("going in files function...");
        const fetchedFiles = await fetchFromSlack(allMessages[i].files);
        if (fetchedFiles.length >= 1) {
          const sendFile = await postFilesToMettermost(
            fetchedFiles,
            allMessages[i].text,
            username.user.real_name,
            channelRecord.mattermostId
          );
        }
      } else {
        let singleMessage = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
          {
            text: allMessages[i].text,
            normal_hook: true,
            username: username.user.real_name,
            channel: channelRecord.mattermostId,
          }
        );
        if (allMessages[i].thread_ts) {
          rootIds.push({ ts: allMessages[i].thread_ts, rootId: singleMessage.data.id })
        }
      }
    }

    for (let i = allReplies.length - 1; i >= 0; i--) {
      for (let x = 1; x < allReplies[i].length; x++) {
        const username = await web.users.info({
          user: allReplies[i][x].user,
        });
        const rootId = rootIds.find((item) => allReplies[i][x].thread_ts === item.ts).rootId;
        console.log("This is root for this thread", rootId);
        if (allReplies[i][x].files) {
          console.log("going in files function for thread...");
          const fetchedFiles = await fetchFromSlack(allReplies[i][x].files);
          if (fetchedFiles.length >= 1) {
            const sendFile = await postFilesToMettermost(
              fetchedFiles,
              allReplies[i][x].text,
              username.user.real_name,
              channelRecord.mattermostId,
              rootId
            );
          }
        } else {
          const singleReply = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
            {
              root_id: rootId,
              text: allReplies[i][x].text,
              normal_hook: true,
              username: username.user.real_name,
              channel: channelRecord.mattermostId,
            }
          );
        }
      }
    }

    const date = new Date();
    await channelRecord.update({ lastUpdatedAt: date, status: "Completed" });
    const socketPayload = {
      lastUpdatedAt: date,
      channelId: channelId,
    };
    const io = req.app.get("socketio");
    io.emit("lastUpdated", socketPayload);
    return;
  } catch (error) {
    console.error('this is error -> ', error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};

const fetchFromSlack = async (file) => {
  const filesFromSlack = [];
  for (let i = 0; i < file.length; i++) {
    if (file[i].url_private_download && typeof(file[i].url_private_download) !== 'undefined') {
      const fetchFile = await axios.get(file[i].url_private_download, {
        headers: { Authorization: "Bearer " + process.env.SLACK_USER_TOKEN },
      });
      await filesFromSlack.push(fetchFile);
    }
  }
  return filesFromSlack;
};

const postFilesToMettermost = async (
  fileCollection,
  textMessage,
  username,
  mattermostId,
  rootId = null
) => {
  try {
    const URLsite = BASEURL + "/api/v4/files";
    let formData = new FormData();
    console.log(fileCollection?.length, "POSTING TO MATTERMOST!");
    fileCollection.map((file) => {
      formData.append("files", file);
    });
    formData.append("Authorization", "Bearer " + ACCESSTOKEN);
    formData.append("channel_id", "mjkhchcykidofe9ncgtzbge3ec");
    console.log("formData 2 -> ", formData);
    // All posted files will be received in the response
    let responseData = await axios.post(URLsite, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: "Bearer " + ACCESSTOKEN,
      },
    });
    // Will stay 0
    const postIds = responseData?.data?.file_infos?.map((el) => el.id);
    console.log("This is postIds -> ", postIds);
    // After posting multiple files, we need to
    const response = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
      {
        root_id: rootId ? rootId : null,
        text: textMessage,
        normal_hook: true,
        username: username,
        channel: mattermostId,
        file_ids: postIds,
      }
    );
    console.log("This is images response -> ", response);
    return response;
  } catch (error) {
    console.log("Error, please have a look at ", error);
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

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchAllMessageWithTreads,
  slackMessageEv,
  syncHistroy,
};
