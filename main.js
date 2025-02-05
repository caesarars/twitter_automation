require("dotenv").config({path: __dirname + "/.env"});

const express = require("express");
const app = express();
const port = process.env.PORT || 4003;
const mongoose = require('mongoose');
const Tweets = require("./models/tweets")


const { twitterClient } = require("./twitterClient");

const mongoURI =  process.env.MONGO_DB_DEV_URL;

mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }).then(() => {
    console.log('MongoDB connected');
  }).catch(err => {
    console.error('MongoDB connection error:', err.message);
  });

 // Function to fetch tweets from the database
const getTweet = async () => {
    try {
        // Fetch tweets where is_posted is false
        const products = await Tweets.find({})
        if (products) 
        {
              // Map the results to get an array of tweet texts
            console.log("products : " , products);
            return products.map(product => product.tweet);
        }
    } catch (err) {
        console.error("Error fetching tweets:", err);
        return []; // Return an empty array in case of error
    }
};

/// Function to post a tweet
const tweet = async () => {
    try {
        console.log("Fetching tweets from DB...");
        const tweetList = await getTweet();

        if (tweetList && tweetList.length) {
            console.log("Creating a tweet...");
            const response = await twitterClient.v2.tweet(tweetList[0]); // Post the first tweet in the list

            if (response) {
                console.log("Tweet posted successfully:", response);
                // Update the tweet in the database to mark it as posted
                await Tweet.updateOne({ tweet: tweetList[0] }, { is_posted: true });
            }
        } else {
            console.log("No tweets available to post.");
        }
    } catch (err) {
        if (err.response && err.response.status === 429) {
            console.error("Rate limit exceeded. Waiting for 24 hours before retrying...");
            // Wait for 24 hours (86400000 milliseconds)
            await new Promise(resolve => setTimeout(resolve, 86400000));
        } else {
            console.error("Error posting tweet:", err);
        }
    }
};

getTweet();

// Vercel serverless function
module.exports = async (req, res) => {
    await tweet();
    res.status(200).send("Tweet posted successfully!");
};

// Start the Express server (optional, if you want to run locally)
if (require.main === module) {
    app.listen(port, () => {
        console.log("Listening to port:", port);
    });
}