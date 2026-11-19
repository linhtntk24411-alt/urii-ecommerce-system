const mongoose = require('mongoose');
const blogSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  excerpt: String,
  content: String,
  image: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  author: String,
  avatar: String,
  date: String,
  categoryId: String,
  category: String,
  categorySlug: String,
  isFeatured: Boolean,
  likes: Number,
  comments: Number,
  views: Number,
  tags: [String],
  thumbnail: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'violated'],
    default: 'approved'
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'violated']
  },
  visible: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });
module.exports = mongoose.model('Blog', blogSchema);
