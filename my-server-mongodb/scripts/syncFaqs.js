const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/urii_ecommerce';

async function run() {
  try {
    await mongoose.connect(uri);
    const ChatbotFaq = require('../models/ChatbotFaq');
    const faqs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chatbot_faqs.json'), 'utf8'));
    
    // Clear old corrupted FAQs and replace with clean ones
    await ChatbotFaq.deleteMany({});
    await ChatbotFaq.insertMany(faqs);
    console.log(`Đã đồng bộ thành công ${faqs.length} FAQs vào MongoDB!`);
    await mongoose.disconnect();
  } catch (err) {
    console.error('Lỗi sync FAQs:', err);
    process.exit(1);
  }
}

run();
