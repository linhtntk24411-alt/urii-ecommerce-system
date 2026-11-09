const mongoose = require('mongoose');

const commentReplySchema = new mongoose.Schema({
  id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  author: { type: String, trim: true },
  avatar: String,
  content: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  time: { type: String, default: 'Vừa xong' },
  role: { type: String, enum: ['user', 'admin', 'author'], default: 'user' },
  replyTo: { type: String, trim: true },
  replyToAuthor: { type: String, trim: true }
}, { _id: false });

const commentSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  blogId: { type: Number, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  author: { type: String, trim: true },
  avatar: String,
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  time: String,
  replies: { type: [commentReplySchema], default: [] }
}, { timestamps: true });

commentSchema.pre('validate', function () {
  if (!this.userId && !this.author) {
    this.invalidate('userId', 'Bình luận phải có userId hoặc author.');
  }
});

module.exports = mongoose.model('Comment', commentSchema);
