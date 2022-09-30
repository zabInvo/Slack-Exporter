// Server Setup.
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require('body-parser'); 
const { createEventAdapter } = require("@slack/events-api");
const port = process.env.PORT || 8080;

const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackEvents = createEventAdapter(slackSigningSecret);

const findChannels = require("./exporter").findChannels;
const fetchConversationHistroy = require("./exporter").fetchConversationHistroy;
const fetchMessageThread = require("./exporter").fetchMessageThread;
const fetchAllMessageWithTreads = require("./exporter").fetchAllMessageWithTreads;
const slackMessageEv = require("./exporter").slackMessageEv;


app.use(cors({ origin: "*",}));

app.use(bodyParser.json());

// Plug the adapter in as a middleware
app.use("/slack/events", slackEvents.requestListener());

app.get("/", (req, res) => {
  res.send("You land on a wrong planet, no one lives here.");
});

app.post("/api/fetch-groups", findChannels);
app.post("/api/histroy", fetchConversationHistroy);
app.post("/api/fetch-message-thread", fetchMessageThread);
app.post("/api/fetch-all-message-with-threads", fetchAllMessageWithTreads);

// Slack Message Listener.
slackEvents.on("message", slackMessageEv);

app.listen(port, () => {
  console.log(`App is listening at http://localhost:${port}`);
});

module.exports = app;
