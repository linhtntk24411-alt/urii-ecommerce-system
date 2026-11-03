const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const SavedMap = require('../models/SavedMap');
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
      res.status(409).json({ message: 'Mã map đã lưu đã tồn tại.' });
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
      res.status(409).json({ message: 'Mã map đã lưu đã tồn tại.' });
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
