require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const { twitterClient } = require("./twitterClient");
const Tweet = require("./models/amazon");

const app = express();
const port = process.env.PORT || 4003;
const mongoURI = process.env.MONGO_DB_DEV_URL;

// MongoDB Connection
mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected successfully"))
.catch(err => console.error("MongoDB connection error:", err.message));

mongoose.connection.on("error", err => {
    console.error("MongoDB runtime error:", err.message);
});

// Function to fetch tweets from the database
const getTweet = async () => {
    try {
        const products = await Tweet.find({ is_posted: false }); // Fetch only unposted tweets
        console.log("Products fetched:", products);
        return products.map(product => product.tweet);
    } catch (err) {
        console.error("Error fetching tweets:", err);
        return [];
    }
};

// Function to post a tweet
const tweet = async () => {
    try {
        console.log("Fetching tweets from DB...");
        const tweetList = await getTweet();

        if (!tweetList.length) {
            console.log("No tweets available to post.");
            return;
        }

        console.log("Creating a tweet...");
        const response = await twitterClient.v2.tweet(tweetList[0]); // Post first tweet

        if (response) {
            console.log("Tweet posted successfully:", response);
            await Tweet.updateOne({ tweet: tweetList[0] }, { is_posted: true });
        }
    } catch (err) {
        if (err.response && err.response.status === 429) {
            console.error("Rate limit exceeded. Retrying in 24 hours...");
        } else {
            console.error("Error posting tweet:", err);
        }
    }
};

// Handle Unhandled Promise Rejections
process.on("unhandledRejection", err => {
    console.error("Unhandled Promise Rejection:", err);
});

// Start Express Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

tweet();
