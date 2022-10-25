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
    // locally save all mattermost employees
    let allMembers = [];
    let cursor = req.body.cursor || null;
    const channelRecord = await slackChannelsModel.findOne({
      where: {
        slackId: req.body.channelId,
      },
    });

    const getAllMembers = await fetchAllMembersfromSlack(allMembers);

    const response = await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      limit,
      cursor,
      channelRecord
    );

    for (let i = allMessages.length - 1; i >= 0; i--) {
      const userEmail = findEmail(allMembers, allMessages[i].user);
      if (allMessages[i].files) {
        console.log("going in files function...");
        const fetchedFiles = await fetchFromSlack(allMessages[i].files);
        console.log("This file is fetchec", fetchedFiles);
        if (fetchedFiles.length >= 1) {
          try {
            const sendFile = await postFilesToMettermost(
              fetchedFiles,
              allMessages[i].text,
              allMembers,
              allMessages[i].ts,
              userEmail,
              channelRecord.mattermostId,
              false
            );
            console.log("This is send file Response -> ", sendFile);
            if (allMessages[i].thread_ts && sendFile.data) {
              rootIds.push({ ts: allMessages[i].thread_ts, rootId: sendFile.data.id })
            }
          } catch (error) {
            console.log("Error occur during file sending -> ", error);
          }
        }
      } else {
        try {
          let payload = {
            text: appendTextWithUserName(allMessages[i].text, allMembers),
            normal_hook: true,
            user_email: userEmail,
            channel: channelRecord.mattermostId,
            create_at: parseInt(allMessages[i].ts * 1000)
          }
          let singleMessage = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
            {
              text: appendTextWithUserName(allMessages[i].text,allMembers),
              normal_hook: true,
              user_email: userEmail,
              channel: channelRecord.mattermostId,
              create_at: parseInt(allMessages[i].ts * 1000)
            }
          );
          if (allMessages[i].thread_ts && singleMessage.data) {
            rootIds.push({ ts: allMessages[i].thread_ts, rootId: singleMessage.data.id })
          }
        } catch (error) {
          console.log("Error occur during message sending -> ", error);
        }
      }
    }

    for (let i = 0; i < allReplies.length; i++) {
      for (let x = 1; x < allReplies[i].length; x++) {
        const userEmail = findEmail(allMembers, allReplies[i][x].user);
        const isReply = true;
        const FindRootId = rootIds.find((item) => allReplies[i][x].thread_ts === item.ts);
        if (typeof (FindRootId) !== 'undefined') {
          const rootId = FindRootId.rootId;
          console.log("This is root for this thread", rootId);
          if (allReplies[i][x].files) {
            console.log("going in files function for thread...");
            const fetchedFiles = await fetchFromSlack(allReplies[i][x].files);
            if (fetchedFiles.length >= 1) {
              try {
                const sendFileThread = await postFilesToMettermost(
                  fetchedFiles,
                  allReplies[i][x].text,
                  allMembers,
                  allReplies[i][x].ts,
                  userEmail,
                  channelRecord.mattermostId,
                  isReply,
                  rootId
                );
              } catch (error) {
                console.log("Error occur during thread file sending -> ", error);
              }
            }
          } else {
            try {
              const singleReply = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
                {
                  root_id: rootId,
                  text: appendTextWithUserName(allReplies[i][x].text, allMembers),
                  normal_hook: true,
                  user_email: userEmail,
                  channel: channelRecord.mattermostId,
                  create_at: parseInt(allReplies[i][x].ts * 1000)
                }
              );
            } catch (error) {
              console.log("Error occur during thread message sending -> ", error);
            }

          }
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
    // res.status(200).json({ messages: allMessages, replies: allReplies });
    return;
  } catch (error) {
    console.error('this is error -> ', error);
    res.status(500).json({ messages: "Internal Server Error", error: error });
  }
};


const fetchAllMembersfromSlack = async (allMembers) => {
  // fetching all members from slack 
  let result = await web.users.list();
  if (result.ok !== true) {
    console.log("Error while fetching users", result);
    fetchAllMembersfromSlack(allMembers);
  }
  if (result.members.length > 0) {
    result.members.forEach((user) => {
      allMembers.push({ name: user.name, id: user.id, email: user.profile.email })
    })
  }
  return;
}


const appendTextWithUserName = (text, allMembers) => {
  let checkString = indexesOf(text, /<@/g);
  let findNames = [];
  for (let i = 0; i < checkString.length; i++) {
    let completeId = text.substring(checkString[i], checkString[i] + 14);
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
    text = text.replace(findNames[i].id, findNames[i].name);
  }
  return text;
};

const findName = (allMembers, userId) => {
  const user = allMembers.find((member) => {
    return member.id === userId
  });
  if (typeof (user) === 'undefined') {
    return false;
  }
  return '@' + user.name;
}

const findEmail = (allMembers, userId) => {
  const user = allMembers.find((member) => {
    return member.id === userId
  });
  if (typeof (user) === 'undefined') {
    return false;
  }
  return user.email;
}

// This function is used to find index of user ids from slack text message
const indexesOf = (string, regex) => {
  let match,
    indexes = [];

  regex = new RegExp(regex);

  while (match = regex.exec(string)) {
    indexes.push(match.index);
  }
  return indexes;
}


const fetchFromSlack = async (file) => {
  return new Promise((resolve, reject) => {
    const filesFromSlack = [];
    for (let i = 0; i < file.length; i++) {
      try {

      } catch (error) {

      }
      if (file[i].url_private_download && typeof (file[i].url_private_download) !== 'undefined') {
        https.get(
          file[i].url_private_download,
          {
            headers: { Authorization: "Bearer " + process.env.SLACK_USER_TOKEN },
          }, async (res) => {
            await filesFromSlack.push(res);
            if (i === file.length - 1) {
              resolve(filesFromSlack);
            }
          })
      } else {
        if (i === file.length - 1) {
          resolve(filesFromSlack);
        }
      }
    }
  })
}

const postFilesToMettermost = async (
  fetchedFiles,
  textMessage,
  allMembers,
  createdAt,
  userEmail,
  mattermostId,
  isReply,
  rootId = null
) => {
  try {
    const URLsite = BASEURL + "/api/v4/files";
    let formData = new FormData();
    console.log(fetchedFiles?.length, "POSTING TO MATTERMOST!");
    fetchedFiles.map((file) => {
      formData.append("files", file);
    });
    formData.append("channel_id", "pf4dxpf51fy4dgrzktmh9kx4sy");
    formData.append("Authorization", "Bearer " + ACCESSTOKEN);
    // All posted files will be received in the response

    const instance = axios.create({
      httpAgent: new https.Agent({ keepAlive: true }),
    });

    let responseData = await instance.post(URLsite, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: "Bearer " + ACCESSTOKEN,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    // Will stay 0
    const postIds = responseData?.data?.file_infos?.map((el) => el.id);

    // After posting multiple files, we need to
    const response = await instance.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
      {
        root_id: isReply ? rootId : null,
        text: appendTextWithUserName(textMessage, allMembers),
        normal_hook: true,
        user_email: userEmail,
        channel: mattermostId,
        file_ids: postIds,
        create_at: parseInt(createdAt * 1000)
      },
      {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    console.log("Attachment Sent Successfully");
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

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchAllMessageWithTreads,
  slackMessageEv,
  syncHistroy,
};
