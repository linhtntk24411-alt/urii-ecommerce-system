const mongoose = require('mongoose');
const { randomInt } = require('node:crypto');
const CustomOrder = require('../models/CustomOrder');
const User = require('../models/User');
const Gallery = require('../models/Gallery');
const { getPagination } = require('../utils/pagination');
const { isValidImageUrl } = require('../utils/imageUrl');
const { isDataImageUrl, saveDataUrlImage } = require('../utils/imageUpload');
const { emitCrudChange } = require('../realtime');
const { createAdminNotification } = require('./notificationController');
const { createUserNotification } = require('../utils/userNotificationHelper');

const CUSTOM_ORDER_STATUSES = ['pending', 'quoted', 'processing', 'completed', 'cancelled'];
const ACTIVE_CUSTOM_ORDER_STATUSES = ['pending', 'quoted', 'processing'];

const customerFields = [
  'userId',
  'mapId',
  'fullName',
  'phone',
  'email',
  'requestName',
  'size',
  'beadType',
  'description',
  'imageNote',
  'imageUrl'
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeImageInput(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }
  if (typeof rawValue !== 'string') {
    return rawValue;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }
  if (isDataImageUrl(trimmed)) {
    return saveDataUrlImage(trimmed);
  }
  if (trimmed.startsWith('images/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function validateCustomOrder(body, partial = false) {
  if (!isRecord(body)) {
    return 'Dữ liệu yêu cầu đặt hàng không hợp lệ.';
  }

  if (!partial) {
    const hasUserId = typeof body.userId === 'string' && mongoose.isValidObjectId(body.userId);
    if (!hasUserId) {
      for (const field of ['fullName', 'phone', 'email']) {
        if (typeof body[field] !== 'string' || !body[field].trim()) {
          return `Trường ${field} là bắt buộc.`;
        }
      }
    }
  } else if (body.userId !== undefined && !mongoose.isValidObjectId(body.userId)) {
    return 'userId không hợp lệ.';
  }

  for (const field of ['requestName', 'size', 'beadType']) {
    if ((!partial || Object.hasOwn(body, field))
      && (typeof body[field] !== 'string' || !body[field].trim())) {
      return `Trường ${field} là bắt buộc.`;
    }
  }

  for (const field of ['fullName', 'phone', 'email']) {
    if (partial && Object.hasOwn(body, field) && (typeof body[field] !== 'string' || !body[field].trim())) {
      return `Trường ${field} là bắt buộc.`;
    }
  }

  if (typeof body.email === 'string' && body.email.trim()
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return 'Email không hợp lệ.';
  }
  if (typeof body.phone === 'string' && body.phone.trim()
    && !/^\+?[0-9\s()-]{8,20}$/.test(body.phone.trim())) {
    return 'Số điện thoại không hợp lệ.';
  }
  if (body.imageUrl !== undefined && body.imageUrl !== '' && !isValidImageUrl(body.imageUrl)) {
    return 'imageUrl phải là đường dẫn /images/... hoặc URL http/https hợp lệ.';
  }
  if (body.status !== undefined
    && !['pending', 'quoted', 'processing', 'completed', 'cancelled'].includes(body.status)) {
    return 'Trạng thái không hợp lệ.';
  }

  return null;
}

function generateCustomOrderId() {
  return `customer-order-URII-${randomInt(1000, 10000)}`;
}

function normalizeLegacyUuidCustomOrderId(rawId) {
  if (typeof rawId !== 'string') return rawId;
  const match = rawId.match(/^(?:custom|customer)-order-([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  if (!match) return rawId;
  const num = (parseInt(match[1], 16) % 9000) + 1000;
  return `customer-order-URII-${num}`;
}

function customOrderFilter(value) {
  const filters = [{ id: value }];
  if (typeof value === 'string') {
    if (value.startsWith('custom-order-')) {
      filters.push({ id: value.replace('custom-order-', 'customer-order-') });
    } else if (value.startsWith('customer-order-')) {
      filters.push({ id: value.replace('customer-order-', 'custom-order-') });
    } else {
      filters.push({ id: `customer-order-${value}` }, { id: `custom-order-${value}` });
    }
  }
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

async function enrichCustomOrders(customOrders) {
  const userIds = [...new Set(customOrders.map((item) => item.userId).filter(Boolean).map(String))];
  const mapIds = [...new Set(customOrders.map((item) => item.mapId).filter(Boolean))];
  const [users, maps] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select('name phone email').lean() : [],
    mapIds.length ? Gallery.find({ map_id: { $in: mapIds } }).select('map_id main_image').lean() : []
  ]);
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const mapsById = new Map(maps.map((map) => [map.map_id, map]));
  const migrations = [];
  const enriched = customOrders.map((order) => {
    const user = order.userId ? usersById.get(String(order.userId)) : null;
    const map = order.mapId ? mapsById.get(order.mapId) : null;
    const mainImage = map?.main_image
      ? (map.main_image.startsWith('/') ? map.main_image : `/${map.main_image}`)
      : null;
    const normalizedId = normalizeLegacyUuidCustomOrderId(order.id);
    if (normalizedId !== order.id && order._id && typeof CustomOrder.updateOne === 'function') {
      migrations.push(
        Promise.resolve(CustomOrder.updateOne({ _id: order._id }, { $set: { id: normalizedId } })).catch(() => {})
      );
    }
    return {
      ...order,
      id: normalizedId,
      fullName: order.fullName || user?.name || '',
      phone: order.phone || user?.phone || '',
      email: order.email || user?.email || '',
      imageUrl: order.imageUrl || mainImage || ''
    };
  });
  if (migrations.length) {
    await Promise.all(migrations);
  }
  return enriched;
}

exports.createCustomOrder = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
    return;
  }

  const tokenUserId = typeof req.auth?.id === 'string' && mongoose.isValidObjectId(req.auth.id)
    ? req.auth.id
    : undefined;
  const resolvedUserId = tokenUserId;

  let normalizedImageUrl;
  try {
    normalizedImageUrl = normalizeImageInput(req.body.imageUrl ?? req.body.image);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Ảnh tải lên không hợp lệ.' });
    return;
  }

  const candidateBody = {
    ...Object.fromEntries(customerFields.filter(field => field !== 'userId' && Object.hasOwn(req.body, field))
      .map(field => [field, req.body[field]])),
    ...(resolvedUserId ? { userId: resolvedUserId } : {}),
    ...(normalizedImageUrl !== undefined ? { imageUrl: normalizedImageUrl } : {})
  };

  const validationError = validateCustomOrder(candidateBody);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  try {
    const payload = {
      ...candidateBody,
      id: generateCustomOrderId(),
      requestName: candidateBody.requestName.trim(),
      size: candidateBody.size.trim(),
      beadType: candidateBody.beadType.trim(),
      description: typeof candidateBody.description === 'string' ? candidateBody.description.trim() : '',
      imageNote: typeof candidateBody.imageNote === 'string' ? candidateBody.imageNote.trim() : '',
      status: 'pending'
    };
    if (typeof candidateBody.fullName === 'string' && candidateBody.fullName.trim()) {
      payload.fullName = candidateBody.fullName.trim();
    } else {
      delete payload.fullName;
    }
    if (typeof candidateBody.phone === 'string' && candidateBody.phone.trim()) {
      payload.phone = candidateBody.phone.trim();
    } else {
      delete payload.phone;
    }
    if (typeof candidateBody.email === 'string' && candidateBody.email.trim()) {
      payload.email = candidateBody.email.trim().toLowerCase();
    } else {
      delete payload.email;
    }
    if (typeof candidateBody.mapId === 'string' && candidateBody.mapId.trim()) {
      payload.mapId = candidateBody.mapId.trim();
    } else {
      delete payload.mapId;
    }
    if (typeof candidateBody.imageUrl === 'string') {
      payload.imageUrl = candidateBody.imageUrl.trim();
    }

    let customOrder = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        customOrder = await CustomOrder.create({
          ...payload,
          id: attempt === 1 ? payload.id : generateCustomOrderId()
        });
        break;
      } catch (createError) {
        if (createError?.code === 11000 && attempt < 5) {
          continue;
        }
        throw createError;
      }
    }
    await createAdminNotification({ typeId: 'ADMIN_CUSTOM_ORDER_NEW', eventId: String(customOrder._id || customOrder.id),
      reference: { customOrderId: String(customOrder.id) },
      title: 'Yêu cầu Custom mới', message: 'Có yêu cầu thiết kế Custom mới từ khách hàng.' });
    if (customOrder.userId || customOrder.email) {
      await createUserNotification({
        userId: customOrder.userId,
        userEmail: customOrder.email,
        typeId: 'USER_CUSTOM_ORDER_CREATED',
        reference: { customOrderId: String(customOrder.id) },
        title: `Đã gửi yêu cầu thiết kế #${customOrder.id}`,
        message: `Yêu cầu thiết kế "${customOrder.requestName || customOrder.id}" đã được gửi tới xưởng Urii để báo giá.`,
        actionUrl: '/custom-order-list/' + encodeURIComponent(customOrder.id)
      });
    }
    emitCrudChange('customOrders', 'created', customOrder.id, { userId: customOrder.userId, status: customOrder.status });
    const [enriched] = await enrichCustomOrders([customOrder.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã yêu cầu đặt hàng đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tạo yêu cầu đặt hàng.' });
  }
};

exports.getAllCustomOrders = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const list = CustomOrder.find().sort({ createdAt: -1, _id: -1 });
    const customOrders = await (req.query.view === 'admin-list' ? list : list.skip(skip).limit(limit)).lean();
    res.json(await enrichCustomOrders(customOrders));
  } catch (error) {
    console.error('Lỗi tải yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách yêu cầu đặt hàng.' });
  }
};

exports.getMyCustomOrders = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && !CUSTOM_ORDER_STATUSES.includes(status)) {
    res.status(400).json({ message: 'Trạng thái yêu cầu thiết kế không hợp lệ.' });
    return;
  }

  try {
    const { skip, limit } = getPagination(req.query);
    const filter = { userId };
    if (status) filter.status = status;

    const [customOrders, total, activeCount] = await Promise.all([
      CustomOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomOrder.countDocuments({ userId }),
      CustomOrder.countDocuments({ userId, status: { $in: ACTIVE_CUSTOM_ORDER_STATUSES } })
    ]);

    res.json({
      orders: await enrichCustomOrders(customOrders),
      total,
      activeCount,
      page: Math.floor(skip / limit) + 1,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Lỗi tải yêu cầu thiết kế của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách yêu cầu thiết kế.' });
  }
};

exports.getMyCustomOrderById = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  try {
    const customOrder = await CustomOrder.findOne({
      userId,
      id: req.params.id
    }).lean();
    if (!customOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu thiết kế.' });
      return;
    }

    const [enriched] = await enrichCustomOrders([customOrder]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải chi tiết yêu cầu thiết kế của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải chi tiết yêu cầu thiết kế.' });
  }
};

exports.getCustomOrderById = async (req, res) => {
  try {
    const customOrder = await CustomOrder.findOne(customOrderFilter(req.params.id)).lean();
    if (!customOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    const [enriched] = await enrichCustomOrders([customOrder]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tải yêu cầu đặt hàng.' });
  }
};

async function notifyUserOnCustomOrderStatusChange(customOrder, newStatus) {
  if (!customOrder || (!customOrder.userId && !customOrder.email) || !newStatus) return;
  const requestCode = String(customOrder.id || customOrder._id).slice(-8);

  if (newStatus === 'processing') {
    await createUserNotification({
      userId: customOrder.userId,
      userEmail: customOrder.email,
      typeId: 'USER_CUSTOM_ORDER_PROCESSING',
      reference: { customOrderId: String(customOrder.id || customOrder._id) },
      title: `Đơn custom #${requestCode} đang được chế tác`,
      message: `Xưởng Urii đang tiến hành xếp hạt và chế tác mẫu custom #${requestCode} của bạn.`,
      actionUrl: '/custom-order-list/' + encodeURIComponent(customOrder.id)
    });
  } else if (newStatus === 'completed') {
    await createUserNotification({
      userId: customOrder.userId,
      userEmail: customOrder.email,
      typeId: 'USER_CUSTOM_ORDER_COMPLETED',
      reference: { customOrderId: String(customOrder.id || customOrder._id) },
      title: `Hoàn thiện đơn custom #${requestCode}`,
      message: `Bộ sản phẩm custom #${requestCode} đã hoàn tất chế tác và sẵn sàng giao đến bạn!`,
      actionUrl: '/custom-order-list/' + encodeURIComponent(customOrder.id)
    });
  }
}

const QUOTE_NOTE_LIMIT = 1000;
const positivePrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validVersion = value => Number.isSafeInteger(value) && value > 0;
const validQuoteDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validQuoteNote = value => value === undefined || (typeof value === 'string' && value.length <= QUOTE_NOTE_LIMIT);

function quoteConflict(res) {
  return res.status(409).json({ message: 'Báo giá hoặc trạng thái yêu cầu đã thay đổi. Vui lòng kiểm tra dữ liệu mới nhất.' });
}

function publishQuoteUpdate(order) {
  emitCrudChange('customOrders', 'updated', order.id, { userId: order.userId, status: order.status });
}

function quoteFailure(res, error) {
  console.error('Lỗi xử lý báo giá Custom Order:', error);
  if (error.name === 'ValidationError') return res.status(400).json({ message: 'Dữ liệu báo giá không hợp lệ.' });
  return res.status(500).json({ message: 'Không thể xử lý báo giá. Vui lòng thử lại.' });
}

async function sendQuote(req, res) {
  const { quoteAction, quoteVersion, quotedPrice, quoteDate, quoteNote } = req.body;
  const first = quoteAction === 'send';
  if (!['send', 'correct', 'requote'].includes(quoteAction)
    || (first ? quoteVersion !== 0 : !validVersion(quoteVersion) || quoteVersion === Number.MAX_SAFE_INTEGER)
    || !positivePrice(quotedPrice) || !validQuoteDate(quoteDate) || !validQuoteNote(quoteNote)) {
    return res.status(400).json({ message: 'Giá phải lớn hơn 0, ngày phải hợp lệ và ghi chú tối đa 1.000 ký tự.' });
  }

  try {
    const current = await CustomOrder.findOne(customOrderFilter(req.params.id)).lean();
    if (!current) return res.status(404).json({ message: 'Không tìm thấy yêu cầu thiết kế.' });
    const filter = { _id: current._id };
    const update = { $set: {
      status: 'quoted', quotedPrice, quoteDate, quoteNote: (quoteNote || '').trim(),
      quoteVersion: quoteVersion + 1, quoteDecision: 'pending', quoteSentAt: new Date()
    } };

    if (first) {
      const legacyQuote = current.status === 'quoted' && !positivePrice(current.quotedPrice);
      if ((current.status !== 'pending' && !legacyQuote) || current.quoteVersion != null || current.quoteDecision != null) {
        return quoteConflict(res);
      }
      Object.assign(filter, { status: current.status, quoteVersion: null, quoteDecision: null });
    } else {
      const negotiating = quoteAction === 'requote';
      const expectedDecision = negotiating ? 'negotiating' : 'pending';
      if (current.status !== 'quoted' || current.quoteVersion !== quoteVersion || current.quoteDecision !== expectedDecision
        || !positivePrice(current.quotedPrice) || (negotiating && (current.quoteNegotiation?.quoteVersion !== quoteVersion
          || !positivePrice(current.quoteNegotiation.proposedPrice) || current.quoteNegotiation.respondedAt))) {
        return quoteConflict(res);
      }
      if (!negotiating && current.quotedPrice === quotedPrice && current.quoteDate === quoteDate
        && (current.quoteNote || '') === update.$set.quoteNote) {
        return res.json(current);
      }
      Object.assign(filter, { status: 'quoted', quoteVersion, quoteDecision: expectedDecision });
      const archived = {
        quotedPrice: current.quotedPrice, quoteDate: current.quoteDate, quoteNote: current.quoteNote,
        quoteVersion, quoteDecision: current.quoteDecision, quoteSentAt: current.quoteSentAt,
        quoteRespondedAt: current.quoteRespondedAt, supersededAt: update.$set.quoteSentAt
      };
      if (negotiating) archived.quoteNegotiation = { ...current.quoteNegotiation, respondedAt: update.$set.quoteSentAt };
      update.$push = { quoteHistory: archived };
      update.$unset = { quoteRespondedAt: 1, quoteNegotiation: 1 };
    }

    const saved = await CustomOrder.findOneAndUpdate(filter, update, { new: true, runValidators: true }).lean();
    if (!saved) return quoteConflict(res);
    publishQuoteUpdate(saved);
    await createUserNotification({
      userId: saved.userId, userEmail: saved.email, typeId: 'USER_CUSTOM_ORDER_QUOTED',
      reference: { customOrderId: saved.id },
      title: 'Đã có báo giá thiết kế · Phiên bản ' + saved.quoteVersion,
      message: 'Cửa hàng đã gửi báo giá cho yêu cầu ' + saved.id + '.',
      actionUrl: '/custom-order-list/' + encodeURIComponent(saved.id)
    });
    return res.json(saved);
  } catch (error) {
    return quoteFailure(res, error);
  }
}

exports.respondToQuote = async (req, res) => {
  const { decision, quoteVersion, proposedPrice, note } = req.body || {};
  const negotiating = decision === 'negotiating';
  if (!['accepted', 'rejected', 'negotiating'].includes(decision) || !validVersion(quoteVersion)
    || (negotiating && (!positivePrice(proposedPrice) || !validQuoteNote(note)))) {
    return res.status(400).json({ message: 'Phản hồi không hợp lệ. Giá đề xuất phải lớn hơn 0 và ghi chú tối đa 1.000 ký tự.' });
  }

  const owner = { id: req.params.id, userId: req.auth.id };
  const now = new Date();
  const changes = { quoteDecision: decision, quoteRespondedAt: now };
  if (decision === 'rejected') changes.status = 'cancelled';
  if (negotiating) changes.quoteNegotiation = { quoteVersion, proposedPrice, note: (note || '').trim(), requestedAt: now };

  try {
    const saved = await CustomOrder.findOneAndUpdate({
      ...owner, status: 'quoted', quoteVersion, quoteDecision: 'pending', quotedPrice: { $gt: 0, $lt: Infinity }
    }, { $set: changes }, { new: true, runValidators: true }).lean();
    if (!saved) {
      if (!await CustomOrder.exists(owner)) return res.status(404).json({ message: 'Không tìm thấy yêu cầu thiết kế.' });
      return quoteConflict(res);
    }
    const title = { accepted: 'Khách đã đồng ý báo giá', rejected: 'Khách đã từ chối báo giá',
      negotiating: 'Khách yêu cầu thương lượng' }[decision];
    publishQuoteUpdate(saved);
    await createAdminNotification({
      typeId: 'ADMIN_CUSTOM_ORDER_QUOTE_RESPONSE', eventId: String(saved._id) + ':' + quoteVersion,
      reference: { customOrderId: saved.id }, actorUserId: req.auth.id,
      title, message: title + ' cho yêu cầu ' + saved.id + '.'
    });
    return res.json(saved);
  } catch (error) {
    return quoteFailure(res, error);
  }
};

exports.updateCustomOrder = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
    return;
  }

  if (Object.hasOwn(req.body, 'quoteAction')) return sendQuote(req, res);
  if (req.body.status === 'quoted' || Object.keys(req.body).some(field => field.startsWith('quote'))) {
    return res.status(400).json({ message: 'Vui lòng gửi báo giá qua thao tác báo giá hợp lệ.' });
  }

  const updates = Object.fromEntries(
    [...customerFields, 'status']
      .filter((field) => Object.hasOwn(req.body, field))
      .map((field) => [field, req.body[field]])
  );
  if (updates.imageUrl !== undefined) {
    try {
      updates.imageUrl = normalizeImageInput(updates.imageUrl);
    } catch (error) {
      res.status(400).json({ message: error.message || 'Ảnh tải lên không hợp lệ.' });
      return;
    }
  }
  const validationError = validateCustomOrder(updates, true);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }
  if (typeof updates.email === 'string') {
    updates.email = updates.email.trim().toLowerCase();
  }

  try {
    const filter = customOrderFilter(req.params.id);
    const conditions = [];
    if (updates.status || updates.userId !== undefined) conditions.push({ quoteDecision: { $ne: 'rejected' } });
    if (updates.userId !== undefined) conditions.push({ quoteVersion: { $exists: false } });
    if (updates.status === 'processing') conditions.push({ status: 'quoted', quoteDecision: 'accepted' });
    if (updates.status === 'completed') conditions.push({ status: 'processing' });
    if (updates.status === 'pending') conditions.push({ status: 'pending', quoteVersion: { $exists: false } });
    if (updates.status === 'cancelled') conditions.push({ status: { $in: ['pending', 'quoted', 'processing'] } });
    const customOrder = await CustomOrder.findOneAndUpdate(
      conditions.length ? { $and: [filter, ...conditions] } : filter,
      updates,
      { new: true, runValidators: true }
    );
    if (!customOrder) {
      if (conditions.length && await CustomOrder.exists(filter)) return quoteConflict(res);
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    if (updates.status) {
      notifyUserOnCustomOrderStatusChange(customOrder, updates.status).catch(console.error);
    }
    emitCrudChange('customOrders', 'updated', customOrder.id, {
      userId: customOrder.userId,
      status: customOrder.status,
      quotedPrice: customOrder.quotedPrice
    });
    const [enriched] = await enrichCustomOrders([customOrder.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
      return;
    }
    console.error('Lỗi cập nhật yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể cập nhật yêu cầu đặt hàng.' });
  }
};

exports.deleteCustomOrder = async (req, res) => {
  try {
    const customOrder = await CustomOrder.findOneAndDelete(customOrderFilter(req.params.id));
    if (!customOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    emitCrudChange('customOrders', 'deleted', customOrder.id);
    res.json({ message: 'Đã xóa yêu cầu đặt hàng.' });
  } catch (error) {
    console.error('Lỗi xóa yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể xóa yêu cầu đặt hàng.' });
  }
};
