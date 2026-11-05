const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const CustomOrder = require('../models/CustomOrder');
const User = require('../models/User');
const Gallery = require('../models/Gallery');
const { getPagination } = require('../utils/pagination');
const { isValidImageUrl } = require('../utils/imageUrl');
const { isDataImageUrl, saveDataUrlImage } = require('../utils/imageUpload');
const { emitCrudChange } = require('../realtime');

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
  return customOrders.map((order) => {
    const user = order.userId ? usersById.get(String(order.userId)) : null;
    const map = order.mapId ? mapsById.get(order.mapId) : null;
    const mainImage = map?.main_image
      ? (map.main_image.startsWith('/') ? map.main_image : `/${map.main_image}`)
      : null;
    return {
      ...order,
      fullName: order.fullName || user?.name || '',
      phone: order.phone || user?.phone || '',
      email: order.email || user?.email || '',
      imageUrl: order.imageUrl || mainImage || ''
    };
  });
}

exports.createCustomOrder = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
    return;
  }

  const tokenUserId = typeof req.auth?.id === 'string' && mongoose.isValidObjectId(req.auth.id)
    ? req.auth.id
    : undefined;
  const bodyUserId = typeof req.body.userId === 'string' && mongoose.isValidObjectId(req.body.userId)
    ? req.body.userId
    : undefined;
  const resolvedUserId = req.auth?.role === 'admin'
    ? (bodyUserId || tokenUserId)
    : (tokenUserId || bodyUserId);

  let normalizedImageUrl;
  try {
    normalizedImageUrl = normalizeImageInput(req.body.imageUrl ?? req.body.image);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Ảnh tải lên không hợp lệ.' });
    return;
  }

  const candidateBody = {
    ...req.body,
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
      id: `custom-order-${randomUUID()}`,
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

    const customOrder = await CustomOrder.create(payload);
    emitCrudChange('customOrders', 'created', customOrder.id);
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
    const customOrders = await CustomOrder.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json(await enrichCustomOrders(customOrders));
  } catch (error) {
    console.error('Lỗi tải yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách yêu cầu đặt hàng.' });
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

exports.updateCustomOrder = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
    return;
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
    const customOrder = await CustomOrder.findOneAndUpdate(
      customOrderFilter(req.params.id),
      updates,
      { new: true, runValidators: true }
    );
    if (!customOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    emitCrudChange('customOrders', 'updated', customOrder.id);
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
