const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    default: '',
    trim: true
  },
  hashedPassword: {
    type: String,
    default: ''
  },
  otp: {
    type: String,
    required: true
  },
  purpose: {
    type: String,
    enum: ['register', 'reset-password'],
    default: 'register'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // TTL index: MongoDB tự động dọn dẹp sau 5 phút
  }
});

module.exports = mongoose.model('Otp', otpSchema);
