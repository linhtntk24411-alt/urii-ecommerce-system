const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitCrudChange, emitToUser, emitToUserEmail } = require('../realtime');

/**
 * Tạo thông báo nhắm tới một User cụ thể và phát sự kiện realtime qua Socket.IO
 */
async function createUserNotification({
  userId,
  userEmail,
  typeId,
  reference = {},
  title,
  message,
  actionUrl
}) {
  try {
    let targetUserId = userId;
    let resolvedEmail = userEmail;
    if (!targetUserId && resolvedEmail) {
      const user = await User.findOne({ email: resolvedEmail.trim().toLowerCase() }).select('_id email').lean();
      if (user) {
        targetUserId = user._id;
        resolvedEmail = user.email;
      }
    }

    if (!targetUserId) {
      return null;
    }

    const notifId = `notif-user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const notifDoc = {
      id: notifId,
      audience: 'user',
      typeId,
      recipientUserId: targetUserId,
      reference,
      title: title || '',
      message: message || '',
      actionUrl: actionUrl || '',
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // 1. Lưu vào collection thô 'user_notifications'
    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.collection('user_notifications').insertOne({
          ...notifDoc,
          recipientUserId: String(targetUserId)
        });
      }
    } catch (colErr) {
      console.error('Lỗi lưu user_notifications collection:', colErr);
    }

    // 2. Lưu vào Mongoose model 'Notification'
    try {
      if (mongoose.connection.readyState === 1) {
        await Notification.create(notifDoc);
      }
    } catch (modelErr) {
      console.warn('Lỗi lưu Notification model:', modelErr.message);
    }

    // 3. Bắn sự kiện realtime trực tiếp qua Socket.IO tới User đang online
    if (targetUserId) {
      emitToUser(String(targetUserId), 'notification:new', notifDoc);
    }
    if (resolvedEmail) {
      emitToUserEmail(resolvedEmail, 'notification:new', notifDoc);
    }

    emitCrudChange('notifications', 'created', notifId);
    return notifDoc;
  } catch (error) {
    console.error('Lỗi khi tạo thông báo người dùng:', error);
    return null;
  }
}

module.exports = { createUserNotification };
