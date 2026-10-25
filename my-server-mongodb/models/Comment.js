const mongoose = require('mongoose');
const commentSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  blogId: { type: Number, required: true, index: true },
  author: { type: String, required: true },
  avatar: String,
  content: { type: String, required: true },
  time: String
}, { timestamps: true });
module.exports = mongoose.model('Comment', commentSchema);