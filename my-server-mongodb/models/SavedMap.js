const mongoose = require('mongoose');

const savedMapSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  author: String,
  image: String,
  rating: Number,
  liked: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SavedMap', savedMapSchema);
