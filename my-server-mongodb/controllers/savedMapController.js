const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const SavedMap = require('../models/SavedMap');
const User = require('../models/User');
const Gallery = require('../models/Gallery');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function savedMapFilter(value) {
  const filters = [{ id: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function referencesExistingCustomerAndMap(userId, mapId) {
  if (!mongoose.isValidObjectId(userId)
    || !await User.exists({ _id: userId, role: { $in: ['user', 'admin'] } })
    || typeof mapId !== 'string') {
    return false;
  }
  const mapRegex = new RegExp('^' + escapeRegex(mapId) + '$', 'i');
  const filters = [{ map_id: mapId }, { map_id: mapRegex }, { slug: mapId }, { slug: mapRegex }];
  if (mongoose.isValidObjectId(mapId)) {
    filters.push({ _id: mapId });
  }
  return Gallery.exists({ $or: filters });
}

exports.getAllSavedMaps = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const maps = await SavedMap.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(maps);
  } catch (error) {
    console.error('Lỗi tải map đã lưu:', error);
    res.status(500).json({ message: 'Không thể tải danh sách map đã lưu.' });
  }
};

exports.getMySavedMaps = async (req, res) => {
  try {
    const userId = req.auth?.id;
    const userValid = mongoose.isValidObjectId(userId)
      && (await User.exists({ _id: userId, role: 'user' }) || await User.exists({ _id: userId, role: 'admin' }));
    if (!userValid) {
      res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
      return;
    }

    const { skip, limit } = getPagination(req.query);
    const maps = await SavedMap.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(maps);
  } catch (error) {
    console.error('Lỗi tải kho map của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải kho map đã lưu.' });
  }
};

exports.saveMyMap = async (req, res) => {
  const userId = req.auth?.id;
  const mapId = isRecord(req.body) && typeof req.body.mapId === 'string'
    ? req.body.mapId.trim()
    : '';
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    return;
  }
  if (!mapId) {
    res.status(400).json({ message: 'Thiếu mã map cần lưu.' });
    return;
  }

  try {
    const userValid = await User.exists({ _id: userId, role: 'user' }) || await User.exists({ _id: userId, role: 'admin' });
    if (!userValid) {
      res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
      return;
    }

    let map = await Gallery.findOne({ map_id: mapId }).select('map_id map_name author main_image').lean();
    if (!map) {
      const mapRegex = new RegExp('^' + escapeRegex(mapId) + '$', 'i');
      const filters = [{ map_id: mapRegex }, { slug: mapId }, { slug: mapRegex }];
      if (mongoose.isValidObjectId(mapId)) {
        filters.push({ _id: mapId });
      }
      map = await Gallery.findOne({ $or: filters }).select('map_id map_name author main_image').lean();
    }
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map cần lưu.' });
      return;
    }

    const actualMapId = map.map_id || map.id || String(map._id);

    const savedMap = await SavedMap.create({
      id: `saved-map-${randomUUID()}`,
      mapId: actualMapId,
      userId,
      title: map.map_name || 'Map mẫu',
      author: map.author || '',
      image: map.main_image || ''
    });
    emitCrudChange('savedMaps', 'created', savedMap.id);
    res.status(201).json(savedMap);
  } catch (error) {
    if (error.code === 11000) {
      res.status(409).json({ message: 'Bạn đã lưu map này.' });
      return;
    }
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map đã lưu không hợp lệ.' });
      return;
    }
    console.error('Lỗi lưu map của khách hàng:', error);
    res.status(500).json({ message: 'Không thể lưu map.' });
  }
};

exports.updateMySavedMap = async (req, res) => {
  const userId = req.auth?.id;
  const title = isRecord(req.body) && typeof req.body.title === 'string'
    ? req.body.title.trim()
    : '';
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    return;
  }
  if (!title || title.length > 120) {
    res.status(400).json({ message: 'Tên map phải có từ 1 đến 120 ký tự.' });
    return;
  }

  try {
    if (!await User.exists({ _id: userId, role: { $in: ['user', 'admin'] } })) {
      res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
      return;
    }
    const mapRegex = new RegExp('^' + escapeRegex(req.params.mapId) + '$', 'i');
    const map = await SavedMap.findOneAndUpdate(
      { userId, $or: [{ mapId: req.params.mapId }, { mapId: mapRegex }, { id: req.params.mapId }] },
      { title },
      { new: true, runValidators: true }
    );
    if (!map) {
      res.status(404).json({ message: 'Map này chưa được lưu.' });
      return;
    }
    emitCrudChange('savedMaps', 'updated', map.id);
    res.json(map);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Tên map không hợp lệ.' });
      return;
    }
    console.error('Lỗi cập nhật map đã lưu của khách hàng:', error);
    res.status(500).json({ message: 'Không thể cập nhật map đã lưu.' });
  }
};

exports.removeMySavedMap = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    return;
  }

  try {
    const userValid = await User.exists({ _id: userId, role: 'user' }) || await User.exists({ _id: userId, role: 'admin' });
    if (!userValid) {
      res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
      return;
    }

    let map = await SavedMap.findOneAndDelete({
      userId,
      mapId: req.params.mapId
    });
    if (!map) {
      const mapRegex = new RegExp('^' + escapeRegex(req.params.mapId) + '$', 'i');
      map = await SavedMap.findOneAndDelete({
        userId,
        $or: [{ mapId: mapRegex }, { id: req.params.mapId }]
      });
    }
    if (!map) {
      const galleryItem = await Gallery.findOne({
        $or: [
          { slug: req.params.mapId },
          ...(mongoose.isValidObjectId(req.params.mapId) ? [{ _id: req.params.mapId }] : [])
        ]
      }).select('map_id').lean();
      if (galleryItem && galleryItem.map_id) {
        map = await SavedMap.findOneAndDelete({
          userId,
          mapId: galleryItem.map_id
        });
      }
    }
    if (!map) {
      res.status(404).json({ message: 'Map này chưa được lưu.' });
      return;
    }
    emitCrudChange('savedMaps', 'deleted', map.id);
    res.json({ message: 'Đã bỏ lưu map.' });
  } catch (error) {
    console.error('Lỗi bỏ lưu map của khách hàng:', error);
    res.status(500).json({ message: 'Không thể bỏ lưu map.' });
  }
};

exports.getSavedMapById = async (req, res) => {
  try {
    const map = await SavedMap.findOne(savedMapFilter(req.params.id)).lean();
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map đã lưu.' });
      return;
    }
    res.json(map);
  } catch (error) {
    console.error('Lỗi tải map đã lưu:', error);
    res.status(500).json({ message: 'Không thể tải map đã lưu.' });
  }
};

exports.createSavedMap = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu map đã lưu không hợp lệ.' });
    return;
  }

  try {
    if (!await referencesExistingCustomerAndMap(req.body.userId, req.body.mapId)) {
      res.status(400).json({ message: 'Khách hàng hoặc map không tồn tại.' });
      return;
    }
    const map = await SavedMap.create({
      ...req.body,
      id: req.body.id || `saved-map-${randomUUID()}`
    });
    emitCrudChange('savedMaps', 'created', map.id);
    res.status(201).json(map);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map đã lưu không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bản ghi đã tồn tại hoặc khách hàng đã lưu map này.' });
      return;
    }
    console.error('Lỗi tạo map đã lưu:', error);
    res.status(500).json({ message: 'Không thể tạo map đã lưu.' });
  }
};

exports.updateSavedMap = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu map đã lưu không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    if (Object.hasOwn(updates, 'userId') || Object.hasOwn(updates, 'mapId')) {
      const current = await SavedMap.findOne(savedMapFilter(req.params.id)).select('userId mapId').lean();
      if (current && !await referencesExistingCustomerAndMap(
        updates.userId ?? current.userId,
        updates.mapId ?? current.mapId
      )) {
        res.status(400).json({ message: 'Khách hàng hoặc map không tồn tại.' });
        return;
      }
    }
    const map = await SavedMap.findOneAndUpdate(savedMapFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map đã lưu.' });
      return;
    }
    emitCrudChange('savedMaps', 'updated', map.id);
    res.json(map);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map đã lưu không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bản ghi đã tồn tại hoặc khách hàng đã lưu map này.' });
      return;
    }
    console.error('Lỗi cập nhật map đã lưu:', error);
    res.status(500).json({ message: 'Không thể cập nhật map đã lưu.' });
  }
};

exports.deleteSavedMap = async (req, res) => {
  try {
    const map = await SavedMap.findOneAndDelete(savedMapFilter(req.params.id));
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map đã lưu.' });
      return;
    }
    emitCrudChange('savedMaps', 'deleted', map.id);
    res.json({ message: 'Đã xóa map đã lưu.' });
  } catch (error) {
    console.error('Lỗi xóa map đã lưu:', error);
    res.status(500).json({ message: 'Không thể xóa map đã lưu.' });
  }
};
