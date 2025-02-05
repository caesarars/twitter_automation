const mongoose = require("mongoose");


const Tweets = new mongoose.Schema({
    _id : {
        type : mongoose.Schema.Types.ObjectId, 
        ref : "User", 
        required: true
    },
    id : {
        type : String , 
        required : true
    },
    tweet : {
        type : String , 
        required : true
    },
    is_posted : {
        type : Boolean,
        required : true
    },
    created_tt : {
        type : Date,
        default : Date.now
    }
})

module.exports = mongoose.model("Tweets", Tweets);