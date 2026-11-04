const mongoose = require('mongoose');
const commentSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  blogId: { type: Number, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  author: { type: String, trim: true },
  avatar: String,
  content: { type: String, required: true },
  time: String
}, { timestamps: true });

commentSchema.pre('validate', function () {
  if (!this.userId && !this.author) {
    this.invalidate('userId', 'Bình luận phải có userId hoặc author.');
  }
});

module.exports = mongoose.model('Comment', commentSchema);
