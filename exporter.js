require("dotenv").config();

const { WebClient } = require("@slack/web-api");
const token = process.env.SLACK_USER_TOKEN
const web = new WebClient(token);

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
    console.log('channelId',req.body);
    let conversationHistory;
    const result = await web.conversations.history({
      channel: channelId,
      limit: 100
    });

    conversationHistory = result.messages;

    console.log(conversationHistory.length + " messages found in " + channelId);
    res.status(200).json({ data: conversationHistory });
  } catch (error) {
    console.error(error);
  }
};

const fetchMessageThread = async (req, res) =>{
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
  }
  catch (error) {
    console.error(error);
  }
}


const fetchMessageWithTreads = async (req, res) =>{
  try {
    const channelId = req.body.channelId;
    const result = await web.conversations.history({
      channel: channelId,
      limit: 1000
    });
    let repliesIds = []
    message = result.messages;
    await message.forEach(item => {
      if(item.reply_count >= 1)
      {
        repliesIds.push(item.thread_ts);
      }
    });
  
    res.status(200).json({ data: message , repliesIds: repliesIds });
  }
  catch (error) {
    console.error(error);
  }
}

const slackMessageEv = async (ev) => {
  console.log(ev);
};

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchMessageThread,
  fetchMessageWithTreads,
  slackMessageEv,
};
