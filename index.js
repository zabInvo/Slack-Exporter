// Server Setup.
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");
const { createEventAdapter } = require("@slack/events-api");
const cookieSession = require("cookie-session");
const passport = require("passport");
const e = require("express");
const port = process.env.PORT || 8080;

// For Locally use of https cert instead of http
const fs = require("fs");
const https = require("https");
const key = fs.readFileSync("localhost-key.pem", "utf-8");
const cert = fs.readFileSync("localhost.pem", "utf-8");

const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackEvents = createEventAdapter(slackSigningSecret);
require("./auth/passport");

const syncHistroy = require("./exporter").syncHistroy;
const findChannels = require("./exporter").findChannels;
const fetchConversationHistroy = require("./exporter").fetchConversationHistroy;
const fetchMessageThread = require("./exporter").fetchMessageThread;
const fetchAllMessageWithTreads =
  require("./exporter").fetchAllMessageWithTreads;
const slackMessageEv = require("./exporter").slackMessageEv;

app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_KEY],
    maxAge: 24 * 60 * 60 * 100,
    sameSite: false,
    secure: true,
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(bodyParser.json());

app.use(
  cors({
    origin: "https://localhost:3000",
    methods: "GET, POST, PUT, DELETE",
    credentials: true,
  })
);

// Plug the adapter in as a middleware
app.use("/slack/events", slackEvents.requestListener());

app.get("/", (req, res) => {
  res.send("You land on a wrong planet, no one lives here.");
});

app.post("/api/sync-histroy", syncHistroy);
app.post("/api/fetch-groups", findChannels);
app.post("/api/histroy", fetchConversationHistroy);
app.post("/api/fetch-message-thread", fetchMessageThread);
app.post("/api/fetch-all-message-with-threads", fetchAllMessageWithTreads);

// Auth Routes
app.get("/auth/slack", passport.authorize("Slack"));
app.get(
  "/auth/slack/callback",
  passport.authenticate("Slack", {
    successRedirect: "https://localhost:3000/public",
    failureRedirect: "/login/failed",
  })
);

app.get("/api/login/success", (req, res) => {
  if (req.user) {
    res.status(200).json({ user: req.user });
  } else res.send("no user data found, please repeat the login process..");
});

app.get("/api/login/failed", (req, res) => {
  res.status(401);
});

app.get("/api/logout", (req, res) => {
  req.logout();
  res.redirect("https://localhost:3000/login");
});

// Slack Message Listener.
slackEvents.on("message", slackMessageEv);

https.createServer({ key, cert }, app).listen(port, () => {
  console.log(`App is listening at https://localhost:${port}`);
});

module.exports = app;
