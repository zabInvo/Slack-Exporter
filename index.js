// Server Setup.
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 8080;

// Environment Variables.
require("dotenv").config({ path: ".env" });
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

// Slack Essentials.
const { createEventAdapter } = require("@slack/events-api");
const slackEvents = createEventAdapter(slackSigningSecret);

const findConversation = require("./exporter").findConversation;
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

app.get("/fetch-groups", findConversation);
app.get("/histroy", fetchConversationHistroy);

// Slack Message Listener.
slackEvents.on("message", slackMessageEv);

app.listen(port, () => {
  console.log(`App is listening at http://localhost:${port}`);
});

module.exports = app;
