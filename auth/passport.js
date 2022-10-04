const passport = require("passport");

const SlackStrategy = require("passport-slack-oauth2").Strategy;

const SLACK_CLIENT_ID = "4161180073968.4137388626883";
const SLACK_CLIENT_SECRET = "4b9cce3edb3c01e8a303b4493aba2ce9";

passport.use(
  new SlackStrategy(
    {
      clientID: SLACK_CLIENT_ID,
      clientSecret: SLACK_CLIENT_SECRET,
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
