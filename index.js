// Server Setup.
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const { createEventAdapter } = require("@slack/events-api");
const port = process.env.PORT || 8080;

const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackEvents = createEventAdapter(slackSigningSecret);

const findChannels = require("./exporter").findChannels;
const fetchConversationHistroy = require("./exporter").fetchConversationHistroy;
const slackMessageEv = require("./exporter").slackMessageEv;

// Plug the adapter in as a middleware
app.use("/slack/events", slackEvents.requestListener());

app.use(
  cors({
    origin: "*",
  })
);

app.get("/", (req, res) => {
  res.send("You land on a wrong planet, no one lives here.");
});

app.get("/fetch-groups", findChannels);
app.get("/histroy", fetchConversationHistroy);

// Slack Message Listener.
slackEvents.on("message", slackMessageEv);

app.listen(port, () => {
  console.log(`App is listening at http://localhost:${port}`);
});

module.exports = app;
