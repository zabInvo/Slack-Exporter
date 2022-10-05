const passport = require("passport");
require("dotenv").config({ path: "../.env" });
const SlackStrategy = require("passport-slack-oauth2").Strategy;

passport.use(
  new SlackStrategy(
    {
      clientID: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      skipUserProfile: false,
      scope: [
        "identity.basic",
        "identity.email",
        "identity.avatar",
        "identity.team",
      ],
    },
    (accessToken, refreshToken, profile, done) => {
      // optionally persist user data into a database
      done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});
