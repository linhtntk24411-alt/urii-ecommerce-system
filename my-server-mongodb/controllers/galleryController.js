const Gallery = require('../models/Gallery');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapFilter(value) {
  return { $or: [{ map_id: value }, { slug: value }] };
}

exports.getAllGallery = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const maps = await Gallery.find().sort({ map_id: 1 }).skip(skip).limit(limit).lean();
    res.json(maps);
  } catch (error) {
    console.error('Lỗi tải gallery:', error);
    res.status(500).json({ message: 'Không thể tải gallery.' });
  }
};

exports.getGalleryById = async (req, res) => {
  try {
    const map = await Gallery.findOne(mapFilter(req.params.mapId)).lean();
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy mẫu gallery.' });
      return;
    }
    res.json(map);
  } catch (error) {
    console.error('Lỗi tải mẫu gallery:', error);
    res.status(500).json({ message: 'Không thể tải mẫu gallery.' });
  }
};

exports.createGallery = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
    return;
  }

  try {
    const galleryItem = await Gallery.create({
      ...req.body,
      map_id: req.body.map_id || `map-${randomUUID()}`
    });
    emitCrudChange('gallery', 'created', galleryItem.map_id);
    res.status(201).json(galleryItem);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã mẫu gallery đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo mẫu gallery:', error);
    res.status(500).json({ message: 'Không thể tạo mẫu gallery.' });
  }
};

exports.updateGallery = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.map_id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    const galleryItem = await Gallery.findOneAndUpdate(mapFilter(req.params.mapId), updates, {
      new: true,
      runValidators: true
    });
    if (!galleryItem) {
      res.status(404).json({ message: 'Không tìm thấy mẫu gallery.' });
      return;
    }
    emitCrudChange('gallery', 'updated', galleryItem.map_id);
    res.json(galleryItem);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã mẫu gallery đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật mẫu gallery:', error);
    res.status(500).json({ message: 'Không thể cập nhật mẫu gallery.' });
  }
};

exports.deleteGallery = async (req, res) => {
  try {
    const galleryItem = await Gallery.findOneAndDelete(mapFilter(req.params.mapId));
    if (!galleryItem) {
      res.status(404).json({ message: 'Không tìm thấy mẫu gallery.' });
      return;
    }
    emitCrudChange('gallery', 'deleted', galleryItem.map_id);
    res.json({ message: 'Đã xóa mẫu gallery.' });
  } catch (error) {
    console.error('Lỗi xóa mẫu gallery:', error);
    res.status(500).json({ message: 'Không thể xóa mẫu gallery.' });
  }
};
