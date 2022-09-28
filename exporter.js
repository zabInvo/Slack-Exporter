require("dotenv").config({ path: ".env" });

const { WebClient } = require("@slack/web-api");
const web = new WebClient(process.env.SLACK_USER_TOKEN);
console.log(process.env.SLACK_USER_TOKEN, "here");

// Find conversation ID using the conversations.list method
const findConversation = async (req, res) => {
  try {
    const name = req.query.channel;
    // Call the conversations.list method using the built-in WebClient
    const result = await web.conversations.list({
      token: process.env.SLACK_USER_TOKEN,
      types: "private_channel",
      // types: "public_channel,private_channel,mpim,im",
    });

    for (const channel of result.channels) {
      if (channel.name === name) {
        conversationId = channel.id;

        // Print result
        console.log("Found conversation ID: " + conversationId);
        // Break from for loop
        break;
      }
    }
    res.status(200).json({ data: result });
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
      token: process.env.SLACK_USER_TOKEN,
      channel: channelId,
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
  findConversation,
  fetchConversationHistroy,
  slackMessageEv,
};
