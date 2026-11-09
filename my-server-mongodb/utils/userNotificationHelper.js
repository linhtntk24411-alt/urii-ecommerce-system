const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitCrudChange } = require('../realtime');

/**
 * Tạo thông báo nhắm tới một User cụ thể và phát sự kiện realtime
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} [params.userId]
 * @param {string} [params.userEmail]
 * @param {string} params.typeId - Mã loại thông báo (vd: USER_ORDER_CONFIRMED, USER_CHAT_ADMIN_REPLIED...)
 * @param {Object} [params.reference] - Thông tin tham chiếu (orderId, sessionId, customOrderId...)
 * @param {string} [params.title] - Tiêu đề tùy chỉnh (nếu có)
 * @param {string} [params.message] - Nội dung tùy chỉnh (nếu có)
 * @param {string} [params.actionUrl] - Đường dẫn khi click
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
    if (!targetUserId && userEmail) {
      const user = await User.findOne({ email: userEmail.trim().toLowerCase() }).select('_id').lean();
      if (user) {
        targetUserId = user._id;
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

    // 1. Lưu vào collection thô 'user_notifications' (phục vụ fallback query)
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

    // 3. Bắn sự kiện realtime
    emitCrudChange('notifications', 'created', notifId);
    return notifDoc;
  } catch (error) {
    console.error('Lỗi khi tạo thông báo người dùng:', error);
    return null;
  }
}

module.exports = { createUserNotification };
