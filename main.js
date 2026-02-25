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
const REDIS_RATE_LIMIT_KEY = process.env.REDIS_RATE_LIMIT_KEY || "twitter:rate_limited";
const REDIS_POST_STEP_KEY = process.env.REDIS_POST_STEP_KEY || "twitter:post_step";
const RATE_LIMIT_TTL_SEC = parseInt(process.env.RATE_LIMIT_TTL_SEC || "86400", 10); // default 24h
const PROMO_URL = process.env.PROMO_URL || "https://www.cryptobriefs.net/brief";

const truncate = (text, maxLen = 280) => {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
};

let redisClient;
let inMemoryPostStep = 0;

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

  const prompt = `You are writing one high-engagement post for X (Twitter).
Goal: maximize meaningful engagement (replies, reposts, likes) while sounding human and credible.

Rules:
- Language: English.
- Voice: Samuel L. Jackson-style swagger (bold, confident, no profanity).
- Length: 1-2 short sentences, maximum 260 characters.
- Start with a strong hook in the first 6-10 words.
- Make one clear takeaway from the content (insight, warning, or opportunity).
- End with a light CTA that invites replies (example style: "Agree or nah?" / "What do you think?").
- Use natural, conversational wording. Avoid clickbait, hype spam, and generic motivational fluff.
- Do not use emojis.
- Hashtags: use 0-1 relevant hashtag only if truly useful.
- Do not include links.

Context:
Title: ${title}
Content: ${content}

Return only the final tweet text, no quotes, no labels, no extra formatting.`;

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

const generatePromoTweetWithGemini = async () => {
  if (!GEMINI_API_KEY) {
    return truncate(
      `Skip the noise and get fast crypto market briefs you can actually use. Check ${PROMO_URL} and tell me your take.`,
      280
    );
  }

  const prompt = `You are writing one promotional post for X (Twitter).
Goal: get clicks and replies for this website: ${PROMO_URL}

Rules:
- Language: English.
- Voice: Samuel L. Jackson-style swagger (bold, confident, no profanity).
- Length: 1-2 short sentences, max 260 characters.
- Mention a concrete value proposition: fast, clear crypto brief/summaries.
- Include this exact link once: ${PROMO_URL}
- End with a light CTA inviting replies.
- No emojis.
- No hashtags.
- Avoid spammy marketing phrases.

Return only the final tweet text, no quotes, no labels, no extra formatting.`;

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
  const promoTweet = text.trim();

  if (!promoTweet) {
    return truncate(
      `Skip the noise and get fast crypto market briefs you can actually use. Check ${PROMO_URL} and tell me your take.`,
      280
    );
  }

  return truncate(promoTweet, 280);
};

const getPostStep = async (redis) => {
  if (!redis) return inMemoryPostStep;
  const raw = await redis.get(REDIS_POST_STEP_KEY);
  const parsed = Number.parseInt(raw || "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed % 3;
};

const setPostStep = async (redis, step) => {
  const safeStep = ((step % 3) + 3) % 3;
  if (!redis) {
    inMemoryPostStep = safeStep;
    return;
  }
  await redis.set(REDIS_POST_STEP_KEY, String(safeStep));
};

const tweet = async () => {
  try {
    const redis = await getRedis();

    // If previously rate-limited, skip Gemini + tweeting to save API calls
    const rateLimited = redis ? await redis.get(REDIS_RATE_LIMIT_KEY) : null;
    if (rateLimited) {
      console.log("Rate limit flag is set. Skipping Gemini and tweet.");
      return;
    }

    const postStep = await getPostStep(redis); // 0 -> normal, 1 -> normal, 2 -> promo
    const isPromoPost = postStep === 2;
    let tweetText = "";
    let pickSlug = null;

    if (isPromoPost) {
      console.log("Promo turn detected. Generating promo tweet...");
      tweetText = await generatePromoTweetWithGemini();
    } else {
      console.log("Fetching summaries...");
      const summaries = await fetchSummaries();
      if (!summaries.length) {
        console.log("No summary available to post.");
        return;
      }

      const lastSlug = redis ? await redis.get(REDIS_LAST_KEY) : null;

      const pick = summaries.find((item) => {
        const slug = item.slug || `${item.title || ""}|${item.content || ""}`;
        return !lastSlug || slug !== lastSlug;
      });

      if (!pick) {
        console.log("All summaries are duplicates. Skipping tweet.");
        return;
      }

      pickSlug = pick.slug || `${pick.title || ""}|${pick.content || ""}`;

      console.log("Generating tweet with Gemini...");
      tweetText = await generateTweetWithGemini({
        title: pick.title || "",
        content: pick.content || ""
      });
    }

    if (!tweetText) {
      console.log("Gemini returned empty tweet.");
      return;
    }

    console.log("Creating a tweet...");
    const response = await twitterClient.v2.tweet(tweetText);
    console.log("Tweet posted successfully:", response);

    if (redis) {
      if (pickSlug) {
        await redis.set(REDIS_LAST_KEY, pickSlug);
      }
    }
    await setPostStep(redis, postStep + 1);
  } catch (err) {
    if (err.response && err.response.status === 429) {
      console.error("Rate limit exceeded. Try again later.");

      try {
        const redis = await getRedis();
        if (redis) {
          await redis.set(REDIS_RATE_LIMIT_KEY, "1", { EX: RATE_LIMIT_TTL_SEC });
          console.log(`Rate limit flag set for ${RATE_LIMIT_TTL_SEC}s.`);
        }
      } catch (e) {
        console.error("Failed to set rate limit flag in Redis:", e);
      }
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
