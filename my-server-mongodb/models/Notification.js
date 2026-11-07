const mongoose = require('mongoose');
const notificationTypes = require('../data/notification_types.json');

const typeEnum = (notificationTypes.notificationTypes || []).map(({ id }) => id);

const notificationReferenceSchema = new mongoose.Schema({
  orderId: { type: String, trim: true },
  customOrderId: { type: String, trim: true },
  productId: { type: String, trim: true },
  blogId: { type: Number },
  commentId: { type: Number },
  voucherId: { type: String, trim: true },
  mapId: { type: String, trim: true },
  sessionId: { type: String, trim: true }
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  audience: { type: String, enum: ['user', 'admin'], required: true },
  typeId: { type: String, enum: typeEnum, required: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reference: { type: notificationReferenceSchema, default: () => ({}) },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

notificationSchema.pre('validate', function () {
  if (this.audience === 'user' && !this.recipientUserId) {
    this.invalidate('recipientUserId', 'Thông báo cho user phải có recipientUserId.');
  }
});

module.exports = mongoose.model('Notification', notificationSchema, 'notifications');
