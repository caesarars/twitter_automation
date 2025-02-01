const {  TwitterApi } = require('twitter-api-v2')


const client = new TwitterApi({
    appKey : process.env.API_KEY,
    appSecret : process.env.API_SECRET,
    accessToken : process.env.ACCESS_TOKEN,
    accessSecret : process.env.ACCESS_SECRET,
})

console.log(process.env.APP_KEY)
console.log(process.env.API_SECRET)


const bearer = new TwitterApi(process.env.BEARER_TOKEN);

const twitterClient =  client.readWrite;

const twitterBearer = bearer.readOnly;

module.exports = { twitterBearer, twitterClient }