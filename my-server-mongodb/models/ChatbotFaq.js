const mongoose = require('mongoose');

const chatbotFaqSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  intent: { type: String, required: true },
  title: { type: String, required: true },
  keywords: [{ type: String }],
  response: { type: String, required: true },
  quickReplies: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model('ChatbotFaq', chatbotFaqSchema);
