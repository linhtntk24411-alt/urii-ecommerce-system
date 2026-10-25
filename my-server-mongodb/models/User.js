const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  joinDate: String,
  avatar: String,
  orders: Number,
  maps: Number,
  phone: String,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  birth: String,
  address: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  password: { type: String, required: true, select: false }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);