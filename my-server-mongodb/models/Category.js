const mongoose = require('mongoose');
const categorySchema = new mongoose.Schema({
  _id: String,
  name: { type: String, required: true },
  slug: { type: String, required: true }
});
module.exports = mongoose.model('Category', categorySchema);