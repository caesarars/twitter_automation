const mongoose = require("mongoose");


const Tweet = new mongoose.Schema({
    id : {
        type : mongoose.Schema.Types.ObjectId, 
        ref : "User", 
        required: true
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

module.exports = mongoose.model("Tweet", Tweet);