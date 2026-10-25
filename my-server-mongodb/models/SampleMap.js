const mongoose = require('mongoose');
const mapSchema = new mongoose.Schema({
  map_id: { type: String, required: true, unique: true },
  slug: String,
  map_name: { type: String, required: true },
  author: String,
  main_image: String,
  gallery_images: [String],
  difficulty: String,
  difficultyClass: String,
  categories: [String],
  grid_size: String,
  bead_type: String,
  total_beads: Number,
  download_link: String,
  description: String,
  related_product_ids: [String],
  time: String
}, { timestamps: true });
module.exports = mongoose.model('SampleMap', mapSchema);