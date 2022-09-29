require("dotenv").config();

const { WebClient } = require("@slack/web-api");
const token = process.env.SLACK_USER_TOKEN
const web = new WebClient(token);

// Find conversation ID using the conversations.list method
const findChannels = async (req, res) => {
  try {
    const type = req.body.type;
    // Call the conversations.list method using the built-in WebClient
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
    const channelId = req.query.channelId;
    // Store conversation history
    let conversationHistory;
    // Call the conversations.history method using WebClient
    const result = await web.conversations.history({
      channel: channelId,
      limit: 100
    });

    conversationHistory = result.messages;

    // Print results
    console.log(conversationHistory.length + " messages found in " + channelId);
    res.status(200).json({ data: conversationHistory });
  } catch (error) {
    console.error(error);
  }
};

const slackMessageEv = async (ev) => {
  console.log(ev);
};

module.exports = {
  findChannels,
  fetchConversationHistroy,
  slackMessageEv,
};
