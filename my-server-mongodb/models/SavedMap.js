const mongoose = require('mongoose');

const savedMapSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  mapId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  author: String,
  image: String,
  rating: Number,
  liked: { type: Boolean, default: true }
}, { timestamps: true });

savedMapSchema.index(
  { userId: 1, mapId: 1 },
  { unique: true, name: 'userId_1_mapId_1_unique' }
);

module.exports = mongoose.model('SavedMap', savedMapSchema);
