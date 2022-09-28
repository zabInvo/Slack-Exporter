const express = require("express");
const app = express();
const cors = require('cors');
const port = 8080;

const findConversation = require("./exporter").findConversation;
const fetchConversationHistroy = require("./exporter").fetchConversationHistroy;

app.use(cors({
    origin: '*'
}));

app.get("/", (req, res) => {
    res.send("You land on a wrong planet, no one lives here.");
});

app.get("/fetch-groups", findConversation);
app.get("/histroy", fetchConversationHistroy);


app.listen(port, () => {
    console.log(`App is listening at http://localhost:${port}`);
});
  
module.exports = app;