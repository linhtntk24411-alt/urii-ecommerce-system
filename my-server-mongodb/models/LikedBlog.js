const mongoose = require('mongoose');

const likedBlogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  blogId: { type: Number, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  liked: { type: Boolean, default: true }
}, { timestamps: true });

likedBlogSchema.index(
  { userId: 1, blogId: 1 },
  { unique: true, name: 'userId_1_blogId_1_unique' }
);

module.exports = mongoose.model('LikedBlog', likedBlogSchema, 'liked_blogs');
