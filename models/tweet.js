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
    productName : {
        type : String,
        required : true
    },
    is_posted : {
        type : Boolean,
        required : true
    },
    createdAt : {
        type : Date,
        default : Date.now
    },
    updatedAt : {
        type : Date,
        default : Date.now
    }
})

module.exports = mongoose.model("Tweet", Tweet);