const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const CustomOrder = require('../models/CustomOrder');
const User = require('../models/User');
const Gallery = require('../models/Gallery');
const { getPagination } = require('../utils/pagination');
const { isValidImageUrl } = require('../utils/imageUrl');
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

  if (!partial) {
    const hasMapId = typeof body.mapId === 'string' && Boolean(body.mapId.trim());
    const hasImageUrl = typeof body.imageUrl === 'string' && Boolean(body.imageUrl.trim());
    if (!hasMapId && !hasImageUrl) {
      return 'Trường imageUrl là bắt buộc.';
    }
  }

  for (const field of ['fullName', 'phone', 'email', 'mapId', 'imageUrl']) {
    if (partial && Object.hasOwn(body, field) && (typeof body[field] !== 'string' || !body[field].trim())) {
      return `Trường ${field} là bắt buộc.`;
    }
  }

  if (body.email !== undefined
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return 'Email không hợp lệ.';
  }
  if (body.phone !== undefined && !/^\+?[0-9\s()-]{8,20}$/.test(body.phone.trim())) {
    return 'Số điện thoại không hợp lệ.';
  }
  if (body.imageUrl !== undefined && !isValidImageUrl(body.imageUrl)) {
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
  const validationError = validateCustomOrder(req.body);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  try {
    const payload = {
      ...req.body,
      id: `custom-order-${randomUUID()}`,
      requestName: req.body.requestName.trim(),
      size: req.body.size.trim(),
      beadType: req.body.beadType.trim(),
      description: typeof req.body.description === 'string' ? req.body.description.trim() : '',
      imageNote: typeof req.body.imageNote === 'string' ? req.body.imageNote.trim() : '',
      status: 'pending'
    };
    if (typeof req.body.fullName === 'string') payload.fullName = req.body.fullName.trim();
    if (typeof req.body.phone === 'string') payload.phone = req.body.phone.trim();
    if (typeof req.body.email === 'string') payload.email = req.body.email.trim().toLowerCase();
    if (typeof req.body.mapId === 'string') payload.mapId = req.body.mapId.trim();
    if (typeof req.body.imageUrl === 'string') payload.imageUrl = req.body.imageUrl.trim();

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
