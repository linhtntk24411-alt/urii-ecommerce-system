const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  sender: { type: String, enum: ['user', 'bot', 'admin'], required: true },
  timestamp: { type: Number, default: () => Date.now() },
  isSystemLog: { type: Boolean, default: false }
}, { _id: false });

const chatSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, trim: true },
  userEmail: { type: String, default: '' },
  avatar: { type: String, default: 'images/avatar_user.jpeg' },
  status: { type: String, enum: ['ai', 'waiting', 'active'], default: 'ai' },
  unreadCount: { type: Number, default: 0 },
  lastMessageTime: { type: Number, default: () => Date.now() },
  messages: [messageSchema]
}, { timestamps: true });

chatSessionSchema.pre('validate', function () {
  if (!this.userId && !this.userName) {
    this.invalidate('userId', 'Phiên chat phải có userId hoặc userName.');
  }
});

module.exports = mongoose.model('ChatSession', chatSessionSchema);
