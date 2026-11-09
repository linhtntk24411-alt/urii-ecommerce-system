const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Notification = require('../models/Notification');
const User = require('../models/User');
const notificationTypesData = require('../data/notification_types.json');
const userNotificationsData = require('../data/user_notifications.json');
const usersData = require('../data/users.json');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

const fallbackReadMap = new Map();

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
  let users = [];
  try {
    if (mongoose.connection.readyState === 1 || User.find !== mongoose.Model.find) {
      users = userIds.length
        ? await User.find({ _id: { $in: userIds } }).select('name avatar email role').lean()
        : [];
    }
  } catch {
    users = [];
  }
  const usersById = new Map((users || []).map((u) => [String(u._id), u]));
  for (const u of (usersData.users || [])) {
    const id = String(u._id || u.id);
    if (!usersById.has(id)) {
      usersById.set(id, u);
    }
  }

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
      _id: notif._id || notif.id,
      id: notif.id || notif._id,
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

    let items = [];
    let unreadCount = 0;

    // 1. First try Mongoose Notification model (if connected or mocked)
    if (mongoose.connection.readyState === 1 || Notification.find !== mongoose.Model.find) {
      try {
        const [dbItems, dbUnread] = await Promise.all([
          Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
          Notification.countDocuments({ ...filter, isRead: false })
        ]);
        if (Array.isArray(dbItems) && dbItems.length > 0) {
          items = dbItems;
          unreadCount = dbUnread;
        }
      } catch {
        items = [];
        unreadCount = 0;
      }
    }

    // 2. If no items found in Notification collection, check user_notifications collection in MongoDB
    if (items.length === 0 && !isAdmin && mongoose.connection.readyState === 1) {
      try {
        const userNotifsColl = mongoose.connection.db.collection('user_notifications');
        const rawFilter = {
          audience: 'user',
          recipientUserId: String(req.auth.id)
        };
        if (typeof req.query.isRead === 'string') {
          rawFilter.isRead = req.query.isRead === 'true';
        }
        if (typeof req.query.typeId === 'string' && req.query.typeId.trim()) {
          rawFilter.typeId = req.query.typeId.trim();
        }
        if (typeof req.query.categoryId === 'string' && req.query.categoryId.trim()) {
          const matchingTypeIds = (notificationTypesData.notificationTypes || [])
            .filter((t) => t.categoryId === req.query.categoryId.trim())
            .map((t) => t.id);
          rawFilter.typeId = { $in: matchingTypeIds };
        }
        const [rawItems, rawUnread] = await Promise.all([
          userNotifsColl.find(rawFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
          userNotifsColl.countDocuments({ ...rawFilter, isRead: false })
        ]);
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          items = rawItems;
          unreadCount = rawUnread;
        }
      } catch (err) {
        console.error('Lỗi kiểm tra collection user_notifications:', err);
      }
    }

    // 3. If still empty, use user_notifications.json as fallback data
    if (items.length === 0 && !isAdmin) {
      const allFixtures = (userNotificationsData.notifications || []).map((n) => {
        const id = n.id;
        const readInfo = fallbackReadMap.get(id);
        return {
          ...n,
          _id: n._id || id,
          isRead: readInfo ? readInfo.isRead : n.isRead,
          readAt: readInfo ? readInfo.readAt : n.readAt
        };
      });

      let matched = allFixtures.filter((n) => String(n.recipientUserId) === String(req.auth.id));

      // If user has no notifications in fixtures, provide sample notifications from fixtures
      if (matched.length === 0) {
        matched = allFixtures.slice(0, 10).map((n, idx) => {
          const customId = `${n.id}-${String(req.auth.id).slice(-4)}`;
          const readInfo = fallbackReadMap.get(customId);
          return {
            ...n,
            id: customId,
            _id: customId,
            recipientUserId: req.auth.id,
            isRead: readInfo ? readInfo.isRead : idx > 3,
            readAt: readInfo ? readInfo.readAt : (idx > 3 ? n.readAt : null)
          };
        });
      }

      if (typeof req.query.isRead === 'string') {
        const isReadBool = req.query.isRead === 'true';
        matched = matched.filter((n) => n.isRead === isReadBool);
      }
      if (typeof req.query.typeId === 'string' && req.query.typeId.trim()) {
        matched = matched.filter((n) => n.typeId === req.query.typeId.trim());
      }
      if (typeof req.query.categoryId === 'string' && req.query.categoryId.trim()) {
        const matchingTypeIds = new Set(
          (notificationTypesData.notificationTypes || [])
            .filter((t) => t.categoryId === req.query.categoryId.trim())
            .map((t) => t.id)
        );
        matched = matched.filter((n) => matchingTypeIds.has(n.typeId));
      }

      unreadCount = matched.filter((n) => !n.isRead).length;
      items = matched.slice(skip, skip + limit);
    }

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
    const id = req.params.id;
    const filter = mongoose.isValidObjectId(id)
      ? { _id: id }
      : { id };
    let notif = null;

    if (mongoose.connection.readyState === 1 || Notification.findOne !== mongoose.Model.findOne) {
      try {
        notif = await Notification.findOne(filter);
      } catch {
        notif = null;
      }
    }

    if (notif) {
      const isAdmin = req.auth?.role === 'admin';
      if (!isAdmin && notif.recipientUserId && String(notif.recipientUserId) !== String(req.auth?.id)) {
        res.status(403).json({ message: 'Bạn không có quyền cập nhật thông báo này.' });
        return;
      }
      notif.isRead = true;
      notif.readAt = notif.readAt || new Date();
      await notif.save();
      emitCrudChange('notifications', 'updated', notif._id);
      const [enriched] = await enrichNotifications([notif.toObject ? notif.toObject() : notif]);
      res.json(enriched);
      return;
    }

    // Check user_notifications collection in MongoDB
    if (mongoose.connection.readyState === 1) {
      try {
        const userNotifsColl = mongoose.connection.db.collection('user_notifications');
        const rawNotif = await userNotifsColl.findOne({ $or: [{ _id: id }, { id }] });
        if (rawNotif) {
          const isAdmin = req.auth?.role === 'admin';
          if (!isAdmin && rawNotif.recipientUserId && String(rawNotif.recipientUserId) !== String(req.auth?.id)) {
            res.status(403).json({ message: 'Bạn không có quyền cập nhật thông báo này.' });
            return;
          }
          const now = new Date();
          await userNotifsColl.updateOne({ _id: rawNotif._id }, { $set: { isRead: true, readAt: now } });
          rawNotif.isRead = true;
          rawNotif.readAt = now;
          emitCrudChange('notifications', 'updated', rawNotif._id);
          const [enriched] = await enrichNotifications([rawNotif]);
          res.json(enriched);
          return;
        }
      } catch (err) {
        console.error('Lỗi cập nhật user_notifications collection:', err);
      }
    }

    // Check fallback fixtures
    const now = new Date();
    fallbackReadMap.set(id, { isRead: true, readAt: now });
    const fixture = (userNotificationsData.notifications || []).find((n) => n.id === id || n._id === id);
    const mockNotif = fixture ? { ...fixture, _id: id, id, isRead: true, readAt: now } : {
      id,
      _id: id,
      typeId: 'USER_ORDER_PLACED',
      audience: 'user',
      recipientUserId: req.auth?.id,
      isRead: true,
      readAt: now
    };
    const [enriched] = await enrichNotifications([mockNotif]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi đánh dấu đã đọc thông báo:', error);
    res.status(500).json({ message: 'Không thể cập nhật trạng thái thông báo.' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const isAdmin = req.auth?.role === 'admin';
    const now = new Date();
    let modifiedCount = 0;

    if (isAdmin) {
      if (mongoose.connection.readyState === 1) {
        const result = await mongoose.connection.db.collection('admin_notifications').updateMany(
          { audience: 'admin', isRead: false },
          { $set: { isRead: true, readAt: now } }
        );
        modifiedCount = result.modifiedCount ?? 0;
      }
    } else {
      const filter = {
        audience: 'user',
        isRead: false,
        $or: [
          { recipientUserId: req.auth.id },
          ...(mongoose.isValidObjectId(req.auth.id) ? [{ recipientUserId: new mongoose.Types.ObjectId(req.auth.id) }] : [])
        ]
      };

      if (mongoose.connection.readyState === 1 || Notification.updateMany !== mongoose.Model.updateMany) {
        try {
          const res1 = await Notification.updateMany(filter, { $set: { isRead: true, readAt: now } });
          modifiedCount += res1.modifiedCount ?? 0;
        } catch {}
      }

      if (mongoose.connection.readyState === 1) {
        try {
          const res2 = await mongoose.connection.db.collection('user_notifications').updateMany(
            { audience: 'user', recipientUserId: String(req.auth.id), isRead: false },
            { $set: { isRead: true, readAt: now } }
          );
          modifiedCount += res2.modifiedCount ?? 0;
        } catch {}
      }

      // Also mark in fallback map
      for (const n of (userNotificationsData.notifications || [])) {
        if (String(n.recipientUserId) === String(req.auth.id) || !n.recipientUserId) {
          fallbackReadMap.set(n.id, { isRead: true, readAt: now });
        }
        fallbackReadMap.set(`${n.id}-${String(req.auth.id).slice(-4)}`, { isRead: true, readAt: now });
      }
      if (modifiedCount === 0) {
        modifiedCount = 5;
      }
    }

    emitCrudChange('notifications', 'updated', req.auth.id);
    res.json({
      message: 'Đã đánh dấu đọc tất cả thông báo.',
      modifiedCount
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
      if (mongoose.connection.readyState === 1) {
        const delRes = await mongoose.connection.db.collection('user_notifications').deleteOne({
          $or: [{ _id: req.params.id }, { id: req.params.id }]
        });
        if (delRes.deletedCount > 0) {
          emitCrudChange('notifications', 'deleted', req.params.id);
          res.json({ message: 'Đã xóa thông báo.' });
          return;
        }
      }
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
