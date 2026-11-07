const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Notification = require('../models/Notification');
const User = require('../models/User');
const notificationTypesData = require('../data/notification_types.json');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

const categoriesById = new Map(
  (notificationTypesData.notificationCategories || []).map((c) => [c.id, c])
);
const prioritiesById = new Map(
  (notificationTypesData.notificationPriorities || []).map((p) => [p.id, p])
);
const typesById = new Map(
  (notificationTypesData.notificationTypes || []).map((t) => [t.id, t])
);

function renderTemplate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => (
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
  ));
}

async function enrichNotifications(notifications) {
  const userIds = [
    ...new Set(
      notifications
        .flatMap((n) => [n.recipientUserId, n.actorUserId])
        .filter(Boolean)
        .map(String)
    )
  ];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name avatar email role').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  return notifications.map((notif) => {
    const typeMeta = typesById.get(notif.typeId);
    const categoryMeta = typeMeta ? categoriesById.get(typeMeta.categoryId) : null;
    const priorityMeta = typeMeta ? prioritiesById.get(typeMeta.priority) : null;
    const recipient = notif.recipientUserId ? usersById.get(String(notif.recipientUserId)) : null;
    const actor = notif.actorUserId ? usersById.get(String(notif.actorUserId)) : null;
    const ref = notif.reference || {};

    const templateVars = {
      ...ref,
      actorUserId: notif.actorUserId ? String(notif.actorUserId) : '',
      recipientUserId: notif.recipientUserId ? String(notif.recipientUserId) : '',
      actorName: actor?.name || 'Thành viên Urii',
      recipientName: recipient?.name || 'Bạn'
    };

    return {
      ...notif,
      categoryId: typeMeta?.categoryId || '',
      categoryLabel: categoryMeta?.label || '',
      priority: typeMeta?.priority || 'normal',
      priorityLabel: priorityMeta?.label || '',
      icon: typeMeta?.icon || categoryMeta?.icon || 'notifications',
      title: notif.title || renderTemplate(typeMeta?.titleTemplate, templateVars),
      message: notif.message || renderTemplate(typeMeta?.messageTemplate, templateVars),
      actionUrl: notif.actionUrl || renderTemplate(typeMeta?.actionUrlTemplate, templateVars),
      actorName: actor?.name || undefined,
      actorAvatar: actor?.avatar || undefined,
      recipientName: recipient?.name || undefined
    };
  });
}

exports.enrichNotifications = enrichNotifications;

exports.getNotificationMetadata = (req, res) => {
  res.json(notificationTypesData);
};

exports.getMyNotifications = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const isAdmin = req.auth?.role === 'admin';
    const filter = isAdmin
      ? {
          audience: 'admin',
          $or: [{ recipientUserId: null }, { recipientUserId: req.auth.id }]
        }
      : {
          audience: 'user',
          recipientUserId: req.auth.id
        };

    if (typeof req.query.isRead === 'string') {
      filter.isRead = req.query.isRead === 'true';
    }
    if (typeof req.query.typeId === 'string' && req.query.typeId.trim()) {
      filter.typeId = req.query.typeId.trim();
    }
    if (typeof req.query.categoryId === 'string' && req.query.categoryId.trim()) {
      const matchingTypeIds = (notificationTypesData.notificationTypes || [])
        .filter((t) => t.categoryId === req.query.categoryId.trim())
        .map((t) => t.id);
      filter.typeId = { $in: matchingTypeIds };
    }

    const [items, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Notification.countDocuments({ ...filter, isRead: false })
    ]);

    res.json({
      unreadCount,
      notifications: await enrichNotifications(items)
    });
  } catch (error) {
    console.error('Lỗi tải thông báo cá nhân:', error);
    res.status(500).json({ message: 'Không thể tải danh sách thông báo.' });
  }
};

exports.getAdminNotifications = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const filter = {};
    if (typeof req.query.audience === 'string' && ['user', 'admin'].includes(req.query.audience)) {
      filter.audience = req.query.audience;
    } else {
      filter.audience = 'admin';
    }
    if (typeof req.query.isRead === 'string') {
      filter.isRead = req.query.isRead === 'true';
    }
    if (typeof req.query.typeId === 'string' && req.query.typeId.trim()) {
      filter.typeId = req.query.typeId.trim();
    }

    const adminNotifications = mongoose.connection.db.collection('admin_notifications');
    const [items, unreadCount] = await Promise.all([
      adminNotifications.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      adminNotifications.countDocuments({ ...filter, isRead: false })
    ]);

    res.json({
      unreadCount,
      notifications: await enrichNotifications(items)
    });
  } catch (error) {
    console.error('Lỗi tải thông báo quản trị:', error);
    res.status(500).json({ message: 'Không thể tải danh sách thông báo quản trị.' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const notif = await Notification.findOne(filter);
    if (!notif) {
      res.status(404).json({ message: 'Không tìm thấy thông báo.' });
      return;
    }

    const isAdmin = req.auth?.role === 'admin';
    if (!isAdmin && (notif.audience !== 'user' || String(notif.recipientUserId) !== String(req.auth?.id))) {
      res.status(403).json({ message: 'Bạn không có quyền cập nhật thông báo này.' });
      return;
    }

    notif.isRead = true;
    notif.readAt = notif.readAt || new Date();
    await notif.save();
    emitCrudChange('notifications', 'updated', notif._id);
    const [enriched] = await enrichNotifications([notif.toObject()]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi đánh dấu đã đọc thông báo:', error);
    res.status(500).json({ message: 'Không thể cập nhật trạng thái thông báo.' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const isAdmin = req.auth?.role === 'admin';
    const filter = isAdmin
      ? { audience: 'admin', isRead: false }
      : { audience: 'user', recipientUserId: req.auth.id, isRead: false };
    const now = new Date();
    const result = isAdmin
      ? await mongoose.connection.db.collection('admin_notifications').updateMany(
          filter,
          { $set: { isRead: true, readAt: now } }
        )
      : await Notification.updateMany(filter, {
          $set: { isRead: true, readAt: now }
        });
    emitCrudChange('notifications', 'updated', req.auth.id);
    res.json({
      message: 'Đã đánh dấu đọc tất cả thông báo.',
      modifiedCount: result.modifiedCount ?? 0
    });
  } catch (error) {
    console.error('Lỗi đánh dấu đọc tất cả thông báo:', error);
    res.status(500).json({ message: 'Không thể cập nhật tất cả thông báo.' });
  }
};

exports.createNotification = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu thông báo không hợp lệ.' });
    return;
  }

  try {
    const notif = await Notification.create({
      ...req.body,
      id: req.body.id || `NOTIF-${randomUUID()}`
    });
    emitCrudChange('notifications', 'created', notif._id);
    const [enriched] = await enrichNotifications([notif.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu thông báo không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã thông báo đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo thông báo:', error);
    res.status(500).json({ message: 'Không thể tạo thông báo.' });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const notif = await Notification.findOneAndDelete(filter);
    if (!notif) {
      res.status(404).json({ message: 'Không tìm thấy thông báo.' });
      return;
    }
    emitCrudChange('notifications', 'deleted', notif._id);
    res.json({ message: 'Đã xóa thông báo.' });
  } catch (error) {
    console.error('Lỗi xóa thông báo:', error);
    res.status(500).json({ message: 'Không thể xóa thông báo.' });
  }
};
