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
  interests: { type: String, trim: true, maxlength: 500 },
  gender: {
    type: String,
    enum: ['', 'male', 'female', 'other', 'prefer_not_to_say']
  },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  authProviders: {
    type: [{ type: String, enum: ['password', 'google', 'facebook'] }],
    default: []
  },
  oauthAccounts: [{
    provider: { type: String, enum: ['google', 'facebook'], required: true },
    providerUserId: { type: String, required: true }
  }],
  password: {
    type: String,
    required() {
      return !this.authProviders.some((provider) => provider === 'google' || provider === 'facebook');
    },
    select: false
  }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);