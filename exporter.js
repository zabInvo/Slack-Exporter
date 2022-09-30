require("dotenv").config();

const { WebClient } = require("@slack/web-api");
const { text } = require("body-parser");
const token = process.env.SLACK_USER_TOKEN;
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
    // const channelId = req.query.channelId;
    const channelId = req.body.channelId;
    // Store conversation history
    let conversationHistory;
    // Call the conversations.history method using WebClient
    const result = await web.conversations.history({
      channel: channelId,
      limit: 100,
    });

    conversationHistory = result.messages.map((elm) => elm.text);

    // Print results
    // console.log(conversationHistory.length + " messages found in " + channelId);
    res.status(200).json({ conversationHistory });
  } catch (error) {
    console.error(error);
  }
};

const fetchCursorBasedHistory = async (req, res) => {
  /*
   1. request via web.conversations.history without any cursor
   2A. if data doesnt have next_cursor, break the iterations and send the response
   2B. if data have next_cursor, send request again on web.conversations.history with cursor set until no cursor
  */

  // Extract the channel id.
  const channelId = req?.body?.channelId;
  // Changes overtime as new requests update it.
  let cursorLocation = null;
  // Complete data being stored into an array.
  const dataSet = [];
  // IntervalId for stopping interval later on.
  const intervalID = null;

  intervalID = setInterval(async () => {
    // if it hasnt been complete [There are still cursors], it will repeat the code.

    try {
      if (cursorLocation !== "complete") {
        // fetching results with variable cursor
        const result = await web.conversations.history({
          channel: channelId,
          limit: 1000,
          cursor: cursorLocation,
        });

        // gathering data per request.
        dataSet.unshift(...result.messages.map((elm) => elm.text).reverse());

        // if cursor exists in new request, update cursorLocation, otherwise turn in to "complete".
        cursorLocation = result.response_metadata.next_cursor
          ? result.response_metadata.next_cursor
          : "complete";
      }
      // if its complete.
      else {
        // return the complete data.
        res.send(dataSet);
        clearInterval(intervalID);
      }
    } catch (error) {
      console.log(error);
    }
  }, 250);
};

const slackMessageEv = async (ev) => {
  console.log(ev);
};

module.exports = {
  findChannels,
  fetchConversationHistroy,
  fetchCursorBasedHistory,
  slackMessageEv,
};
