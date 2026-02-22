require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const axios = require("axios");
const { CronJob } = require("cron");
const app = express();
const port = process.env.PORT || 4003;

const { twitterClient } = require("./twitterClient");
const { createClient } = require("redis");

const SUMMARY_ENDPOINT = process.env.SUMMARY_ENDPOINT || "https://ces.dbrata.my.id/api/briefs/getSummary";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const REDIS_URL = process.env.REDIS_URL;
const REDIS_LAST_KEY = process.env.REDIS_LAST_KEY || "twitter:last_slug";

const truncate = (text, maxLen = 280) => {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
};

let redisClient;
const getRedis = async () => {
  if (!REDIS_URL) return null;
  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => console.error("Redis error:", err));
    await redisClient.connect();
  }
  return redisClient;
};

const fetchSummaries = async () => {
  try {
    const { data } = await axios.get(SUMMARY_ENDPOINT, { timeout: 15000 });
    if (!data || !Array.isArray(data.summary) || data.summary.length === 0) return [];
    return data.summary;
  } catch (err) {
    console.error("Error fetching summary endpoint:", err.message || err);
    return [];
  }
};

const generateTweetWithGemini = async ({ title, content }) => {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const prompt = `Write a tweet in English with Samuel L. Jackson-style swagger (tough tone, no profanity), 1–2 sentences, max 280 characters.\n\nTitle: ${title}\nContent: ${content}\n\nReturn only the tweet text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const { data } = await axios.post(
    url,
    {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    },
    { timeout: 20000 }
  );

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return truncate(text.trim(), 280);
};

const tweet = async () => {
  try {
    console.log("Fetching summaries...");
    const summaries = await fetchSummaries();
    if (!summaries.length) {
      console.log("No summary available to post.");
      return;
    }

    const redis = await getRedis();
    const lastSlug = redis ? await redis.get(REDIS_LAST_KEY) : null;

    const pick = summaries.find((item) => {
      const slug = item.slug || `${item.title || ""}|${item.content || ""}`;
      return !lastSlug || slug !== lastSlug;
    });

    if (!pick) {
      console.log("All summaries are duplicates. Skipping tweet.");
      return;
    }

    const pickSlug = pick.slug || `${pick.title || ""}|${pick.content || ""}`;

    console.log("Generating tweet with Gemini...");
    const tweetText = await generateTweetWithGemini({
      title: pick.title || "",
      content: pick.content || ""
    });

    if (!tweetText) {
      console.log("Gemini returned empty tweet.");
      return;
    }

    console.log("Creating a tweet...");
    const response = await twitterClient.v2.tweet(tweetText);
    console.log("Tweet posted successfully:", response);

    if (redis) {
      await redis.set(REDIS_LAST_KEY, pickSlug);
    }
  } catch (err) {
    if (err.response && err.response.status === 429) {
      console.error("Rate limit exceeded. Try again later.");
    } else {
      console.error("Error posting tweet:", err);
    }
  }
};

// Local testing endpoints
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/tweet", async (req, res) => {
  try {
    await tweet();
    res.status(200).send("Tweet posted successfully!");
  } catch (err) {
    res.status(500).send("Failed to post tweet");
  }
});

// Start the Express server + cron
if (require.main === module) {
  app.listen(port, () => {
    console.log("Listening to port:", port);
  });

  const job = new CronJob("*/85 * * * *", async () => {
    await tweet();
  }, null, true, "Asia/Jakarta");

  console.log("Cron started: every 10 minutes");
}
