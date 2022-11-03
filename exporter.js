require("dotenv").config();

const { WebClient } = require("@slack/web-api");

const axios = require("axios");
const https = require("https");
const FormData = require("form-data");

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
        "mattermostId",
        "lastUpdatedAt",
        "lastCursor",
        "syncStartedAt",
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

const updateMapping = async (req, res) => {
  try {
    const record = await slackChannelsModel.findOne({
      where: { slackId: req.body.id },
    });
    if (record) {
      await record.update({
        mattermostId: req.body.mattermostName,
      });
      res.status(200).json({ data: "Channel mapped successfully!" });
    }
  } catch (error) {
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
    const date = new Date();
    await channelRecord.update({ status: "Pending", syncStartedAt: date });
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
    // locally save all mattermost employees
    let allMembers = [];
    // Save all reaction with post ids
    let reactions = [];
    // locally save all mattermost user id's for reactions
    let mattermostUserIds = [];
    let cursor = req.body.cursor || null;
    const channelRecord = await slackChannelsModel.findOne({
      where: {
        slackId: req.body.channelId,
      },
    });
    const getAllMembers = await fetchAllMembersfromSlack(allMembers);

    const getMattermostUserId = await fetchMattermostUserIds(mattermostUserIds);

    const response = await getCompleteMessageHistroy(
      allMessages,
      allReplies,
      channelId,
      limit,
      cursor,
      channelRecord
    );

    // Sending Messages to mattermost
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const userEmail = findEmail(allMembers, allMessages[i].user);
      if (allMessages[i].files) {
        console.log("going in files function...");
        const fetchedFiles = await fetchFromSlack(allMessages[i].files);
        // console.log("This file is fetchec", fetchedFiles);
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
            if (allMessages[i].thread_ts && sendFile.data) {
              let parentId = allMessages[i].thread_ts;
              let rootId = sendFile.data.id;
              await sendReplyToMattermost(allReplies, rootId, allMembers, channelRecord, parentId, reactions);
            }
            if (allMessages[i].pinned_to && sendFile.data) {
              let postId = sendFile.data.id;
              await sendIsPinnedToMattermost(postId);
            }
            if (allMessages[i].reactions && sendFile.data) {
              for (let x = 0; x < allMessages[i].reactions.length; x++) {
                for (let z = 0; z < allMessages[i].reactions[x].users.length; z++) {
                  reactions.push({ name: allMessages[i].reactions[x].name, postId: sendFile.data.id, userId: allMessages[i].reactions[x].users[z], slackId: allMessages[i].ts })
                }
              }
            }
          } catch (error) {
            console.log("Error occur during file sending -> ", error);
          }
        }
      } else {
        try {
          let singleMessage = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
            {
              text: appendTextWithUserName(allMessages[i].text, allMembers),
              normal_hook: true,
              user_email: userEmail,
              channel: channelRecord.mattermostId,
              create_at: parseInt(allMessages[i].ts * 1000),
              source_post_id: allMessages[i].ts
            }
          );
          if (allMessages[i].thread_ts && singleMessage.data) {
            let parentId = allMessages[i].thread_ts;
            let rootId = singleMessage.data.id;
            await sendReplyToMattermost(allReplies, rootId, allMembers, channelRecord, parentId, reactions);
          }
          if (allMessages[i].pinned_to && singleMessage.data) {
            let postId = singleMessage.data.id;
            await sendIsPinnedToMattermost(postId);
          }
          if (allMessages[i].reactions && singleMessage.data) {
            for (let x = 0; x < allMessages[i].reactions.length; x++) {
              for (let z = 0; z < allMessages[i].reactions[x].users.length; z++) {
                reactions.push({ name: allMessages[i].reactions[x].name, postId: singleMessage.data.id, userId: allMessages[i].reactions[x].users[z], slackId: allMessages[i].ts })
              }
            }
          }
        } catch (error) {
          console.log("Error occur during message sending -> ", error);
        }
      }
    }

    // Sending Reactions to mattermost
    for (let i = 0; i < reactions.length; i++) {
      try {
        const sendRections = await axios.post(BASEURL + "/api/v4/reactions",
          {
            emoji_name: reactions[i].name,
            post_id: reactions[i].postId,
            user_id: getUserMattermostId(reactions[i].userId, mattermostUserIds, allMembers),
            source_post_id: reactions[i].slackId
          },
          {
            headers: {
              Authorization: "Bearer " + ACCESSTOKEN,
            },
          }
        );
      } catch (error) {
        console.log("Error occur during reaction sending -> ", error);
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


const sendReplyToMattermost = async (allReplies, rootId, allMembers, channelRecord, parentId, reactions) => {
  for (let i = 0; i < allReplies.length; i++) {
    for (let x = 1; x < allReplies[i].length; x++) {
      if (allReplies[i][x].thread_ts != parentId) {
        break;
      } else if (allReplies[i][x].thread_ts === parentId) {
        const userEmail = findEmail(allMembers, allReplies[i][x].user);
        let isReply = true;
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
              if (allReplies[i][x].pinned_to && sendFileThread.data) {
                let postId = sendFileThread.data.id;
                await sendIsPinnedToMattermost(postId);
              }
              if (allReplies[i][x].reactions && sendFileThread.data) {
                for (let y = 0; x < allReplies[i][x].reactions.length; y++) {
                  for (let z = 0; z < allReplies[i][x].reactions[y].users.length; z++) {
                    reactions.push({ name: allReplies[i][x].reactions[y].name, postId: sendFileThread.data.id, userId: allReplies[i][x].reactions[y].users[z], slackId: allReplies[i][x].ts })
                  }
                }
              }
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
                create_at: parseInt(allReplies[i][x].ts * 1000),
                source_post_id: allReplies[i][x].ts
              }
            );
            if (allReplies[i][x].pinned_to && singleReply.data) {
              let postId = singleReply.data.id;
              await sendIsPinnedToMattermost(postId);
            }
            if (allReplies[i][x].reactions && singleReply.data) {
              for (let y = 0; y < allReplies[i][x].reactions.length; y++) {
                for (let z = 0; z < allReplies[i][x].reactions[y].users.length; z++) {
                  reactions.push({ name: allReplies[i][x].reactions[y].name, postId: singleReply.data.id, userId: allReplies[i][x].reactions[y].users[z], slackId: allReplies[i][x].ts })
                }
              }
            }
          } catch (error) {
            console.log("Error occur during thread message sending -> ", error);
          }
        }
      }
    }
  }
  return;
}

const sendIsPinnedToMattermost = async (id, isEvent = false) => {
  try {
    let postId = id;
    if (isEvent) {
      postId = await getMattermostPostId(id);
    }
    let sendPinned = await axios.post(BASEURL + `/api/v4/posts/${postId}/pin`, null, {
      headers: {
        Authorization: "Bearer " + ACCESSTOKEN,
      },
    });
    console.log("Pin send successfuly", sendPinned);
  } catch (error) {
    console.log("Error occur during Pinned message sending -> ", error);
  }
  return;
}

const sendUnPinnedToMattermost = async (id) => {
  try {
    let postId = id;
    postId = await getMattermostPostId(id);
    let sendUnPinned = await axios.post(BASEURL + `/api/v4/posts/${postId}/unpin`, null, {
      headers: {
        Authorization: "Bearer " + ACCESSTOKEN,
      },
    });
    console.log("UnPined send successfuly", sendUnPinned);
  } catch (error) {
    console.log("Error occur during UnPinned message sending -> ", error);
  }
  return;
}

const removeReactionFromMattermost = async (event) => {
  const channelRecord = await slackChannelsModel.findOne({
    where: {
      slackId: event.item.channel,
    },
  });
  if (channelRecord && channelRecord.mattermostId && channelRecord.status === 'Completed') {
    console.log("reaction removed :", event);
    try {
      let allMembers = globalAllMembers;
      let mattermostUserIds = globalAllMattermostUserIds;

      if (allMembers.length <= 0) {
        const getAllMembers = await fetchAllMembersfromSlack(allMembers);
      }
      if (mattermostUserIds.length <= 0) {
        const getMattermostUserId = await fetchMattermostUserIds(mattermostUserIds);
      }
      const userId = getUserMattermostId(event.user, mattermostUserIds, allMembers);
      const postId = await getMattermostPostId(event.item.ts);
      const removeReaction = await axios.delete(BASEURL + `/api/v4/users/${userId}/posts/${postId}/reactions/${event.reaction}`,
        {
          headers: {
            Authorization: "Bearer " + ACCESSTOKEN,
          }
        });
    } catch (error) {
      console.log("Error while removing reaction", error);
    }
  }
  return;
}

const fetchAllMembersfromSlack = async (allMembers, cursor = null) => {
  // fetching all members from slack 
  let result = await web.users.list({
    limit: 100,
    cursor: cursor
  });
  if (result.ok !== true) {
    console.log("Error while fetching users", result);
    fetchAllMembersfromSlack(allMembers);
  }
  if (result.members.length > 0) {
    result.members.forEach((user) => {
      allMembers.push({ name: user.name, id: user.id, email: user.profile.email })
    })
  }
  if (result.response_metadata.next_cursor !== '') {
    await fetchAllMembersfromSlack(allMembers, result.response_metadata.next_cursor);
  }
  return;
}

const fetchMattermostUserIds = async (mattermostUserIds) => {
  // fetching all members from mattermost server 
  let result = await axios.get(BASEURL + "/hooks/GetAllUserIds");
  if (result.status !== 200) {
    console.log("Error while fetching users from mattermost", result);
    fetchMattermostUserIds(mattermostUserIds);
  }
  if (result.data.response.length > 0) {
    result.data.response.forEach((user) => {
      mattermostUserIds.push(user);
    })
  }
  return;
}

const getUserMattermostId = (userId, mattermostUserIds, allMembers) => {
  const userEmail = findEmail(allMembers, userId);
  const mattermostId = mattermostUserIds.find((item) => {
    return item.email == userEmail
  })
  if (typeof (mattermostId) === 'undefined') {
    return '';
  }
  return mattermostId.id;
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
  rootId = null,
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
        create_at: parseInt(createdAt * 1000),
        source_post_id: createdAt
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



//  !-----------------  Slack Event Functionalities  For Real Time Updates   -----------------!

let globalAllMembers = [];
const fetchAllMembersOnMount = async () => {
  await fetchAllMembersfromSlack(globalAllMembers);
  console.log("Slack Users", globalAllMembers);
}

let globalAllMattermostUserIds = []
const fetchAllMattermostUserIds = async () => {
  await fetchMattermostUserIds(globalAllMattermostUserIds);;
}

// Fetching All Slack Members From Slack On Application Start
fetchAllMembersOnMount();

// Fetching All Mattermost User Ids From Mattermost On Application Start
fetchAllMattermostUserIds();

const slackMessageEv = async (ev) => {
  // console.log(ev.subtype);
  if ((ev.type === 'message' && !ev.subtype) || (ev.type === 'message' && ev.subtype === "file_share")) {
    if (ev.thread_ts) {
      await sendRealTimeMessage(ev, true, false);
    }
    else {
      await sendRealTimeMessage(ev, false, false);
    }
  }
  if (ev.type === 'reaction_added') {
    await sendRealTimeMessage(ev, false, true);
  }
  else if (ev.type === "reaction_removed") {
    await removeReactionFromMattermost(ev);
  } else if (ev.subtype === "message_changed") {
    await updateRealTimeMessage(ev);
  } else if (ev.subtype === "message_deleted") {
    await deleteRealTimeMessage(ev);
  } else if (ev.type === "pin_added") {
    await sendIsPinnedToMattermost(ev.item.message.ts, true);
    console.log("Pin added", ev);
  } else if (ev.type === "pin_removed") {
    await sendUnPinnedToMattermost(ev.item.message.ts);
  } else {
    console.log("other events" + JSON.stringify(ev));
  }
};

// This function is used to send single message through slack events
const sendRealTimeMessage = async (message, isReply, isReaction) => {
  const channelRecord = await slackChannelsModel.findOne({
    where: {
      slackId: isReaction ? message.item.channel : message.channel,
    },
  });
  if (channelRecord && channelRecord.mattermostId && channelRecord.status === 'Completed') {
    console.log("This is RT messages", message);
    let rootId = null;
    let mattermostPostId = null;
    let allMembers = globalAllMembers;
    if (allMembers.length <= 0) {
      const getAllMembers = await fetchAllMembersfromSlack(allMembers);
      console.log("Re-calling Slack Members Api", allMembers);
    }
    if (isReply) {
      rootId = message.thread_ts;
      mattermostPostId = await getMattermostPostId(rootId);
    }
    else if (isReaction) {
      rootId = message.item.ts;
      mattermostPostId = await getMattermostPostId(rootId);
    }
    const userEmail = findEmail(allMembers, message.user);
    if (isReaction) {
      let mattermostUserIds = globalAllMattermostUserIds;
      if (mattermostUserIds.length <= 0) {
        const getMattermostUserId = await fetchMattermostUserIds(mattermostUserIds);
      }
      try {
        const sendRections = await axios.post(BASEURL + "/api/v4/reactions",
          {
            emoji_name: message.reaction,
            post_id: mattermostPostId,
            user_id: getUserMattermostId(message.user, mattermostUserIds, allMembers),
            source_post_id: message.event_ts
          },
          {
            headers: {
              Authorization: "Bearer " + ACCESSTOKEN,
            },
          })
      } catch (error) {
        console.log("RT : Error occur during reaction sending -> ", error);
      }
    }
    else if (message.files) {
      console.log("RT -> going in files function...");
      const fetchedFiles = await fetchFromSlack(message.files);
      if (fetchedFiles.length >= 1) {
        try {
          const sendFile = await postFilesToMettermost(
            fetchedFiles,
            message.text,
            allMembers,
            message.ts,
            userEmail,
            channelRecord.mattermostId,
            isReply,
            mattermostPostId
          );
          console.log("RT : This is send file Response -> Sent Successfully");
        } catch (error) {
          console.log("RT : Error occur during file sending -> ", error);
        }
      }
    } else {
      try {
        let singleMessage = await axios.post(BASEURL + "/hooks/16988a5j1pbabpdyxfiogh6o4h",
          {
            root_id: isReply ? mattermostPostId : () => { },
            text: appendTextWithUserName(message.text, allMembers),
            normal_hook: true,
            user_email: userEmail,
            channel: channelRecord.mattermostId,
            create_at: parseInt(message.ts * 1000),
            source_post_id: message.ts
          }
        );
        console.log("RT : This is singleMessageResponse ->  Sent Successfully", singleMessage);
      } catch (error) {
        console.log("RT : Error occur during message sending -> ", error);
      }
    }
    return;
  }
  else {
    console.log(`RT -> Unable to send message no channel record found`)
    return;
  }
}

const updateRealTimeMessage = async (ev) => {
  const channelRecord = await slackChannelsModel.findOne({
    where: {
      slackId: ev.channel,
    },
  });
  if (channelRecord && channelRecord.mattermostId && channelRecord.status === 'Completed') {
    console.log("Update", ev);
    if (ev.message.text === 'This message was deleted.') {
      await deleteRealTimeMessage(ev)
      return;
    }
    if (ev.message?.edited?.ts) {
      let rootId = ev.message.ts;
      let mattermostPostId = null;
      let allMembers = globalAllMembers;
      if (allMembers.length <= 0) {
        const getAllMembers = await fetchAllMembersfromSlack(allMembers);
      }
      mattermostPostId = await getMattermostPostId(rootId);
      try {
        const updateMessage = await axios.put(BASEURL + `/api/v4/posts/${mattermostPostId}/patch`,
          {
            channel_id: channelRecord.mattermostId,
            message: appendTextWithUserName(ev.message.text, allMembers),
            id: mattermostPostId
          },
          {
            headers: {
              Authorization: "Bearer " + ACCESSTOKEN,
            },
          }
        );
        console.log("Message Updated Successfully");
      } catch (error) {
        console.log("Error While Updating Message", error);
      }
      return;
    }
  }
  console.log("No id found for updating message");
  return;
}

const deleteRealTimeMessage = async (ev) => {
  const channelRecord = await slackChannelsModel.findOne({
    where: {
      slackId: ev.channel,
    },
  });
  if (channelRecord && channelRecord.mattermostId && channelRecord.status === 'Completed') {
    console.log("delete", ev);
    let rootId = ev.previous_message?.ts || null;
    let mattermostPostId = null;
    let allMembers = globalAllMembers;
    if (allMembers.length <= 0) {
      const getAllMembers = await fetchAllMembersfromSlack(allMembers);
    }
    mattermostPostId = await getMattermostPostId(rootId);
    try {
      const updateMessage = await axios.delete(BASEURL + `/api/v4/posts/${mattermostPostId}`,
        {
          headers: {
            Authorization: "Bearer " + ACCESSTOKEN,
          },
        }
      );
      console.log("Message deleted Successfully");
    } catch (error) {
      console.log("Error While deleting Message", error);
    }
    return;
  }
  console.log("No record found for deleting message");
  return;
}

// Utilty Function is used get the post id from mattermost using slack id
const getMattermostPostId = async (rootId) => {
  let retry = 0;
  let mattermostId = null;
  while (retry <= 10) {
    let result = await axios.post(BASEURL + "/hooks/GetSlackToMMPostId",
      {
        source_post_id: rootId
      },
      {
        headers: {
          Authorization: "Bearer " + ACCESSTOKEN,
        },
      });
    if (result.data.mmid) {
      mattermostId = result.data.mmid;
      return mattermostId;
    }
    await sleep(5000);
    retry = retry + 1;
  }
  return mattermostId
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchAllMessageWithTreads,
  updateMapping,
  slackMessageEv,
  syncHistroy,
};
