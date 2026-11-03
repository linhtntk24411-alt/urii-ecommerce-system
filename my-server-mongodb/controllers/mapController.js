const SampleMap = require('../models/SampleMap');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapFilter(value) {
  return { $or: [{ map_id: value }, { slug: value }] };
}

exports.getAllMaps = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const maps = await SampleMap.find().sort({ map_id: 1 }).skip(skip).limit(limit).lean();
    res.json(maps);
  } catch (error) {
    console.error('Lỗi tải thư viện map:', error);
    res.status(500).json({ message: 'Không thể tải thư viện map.' });
  }
};

exports.getMapById = async (req, res) => {
  try {
    const map = await SampleMap.findOne(mapFilter(req.params.mapId)).lean();
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map.' });
      return;
    }
    res.json(map);
  } catch (error) {
    console.error('Lỗi tải map:', error);
    res.status(500).json({ message: 'Không thể tải map.' });
  }
};

exports.createMap = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
    return;
  }

  try {
    const map = await SampleMap.create({
      ...req.body,
      map_id: req.body.map_id || `map-${randomUUID()}`
    });
    emitCrudChange('maps', 'created', map.map_id);
    res.status(201).json(map);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã map đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo map:', error);
    res.status(500).json({ message: 'Không thể tạo map.' });
  }
};

exports.updateMap = async (req, res) => {
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
    const map = await SampleMap.findOneAndUpdate(mapFilter(req.params.mapId), updates, {
      new: true,
      runValidators: true
    });
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map.' });
      return;
    }
    emitCrudChange('maps', 'updated', map.map_id);
    res.json(map);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu map không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã map đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật map:', error);
    res.status(500).json({ message: 'Không thể cập nhật map.' });
  }
};

exports.deleteMap = async (req, res) => {
  try {
    const map = await SampleMap.findOneAndDelete(mapFilter(req.params.mapId));
    if (!map) {
      res.status(404).json({ message: 'Không tìm thấy map.' });
      return;
    }
    emitCrudChange('maps', 'deleted', map.map_id);
    res.json({ message: 'Đã xóa map.' });
  } catch (error) {
    console.error('Lỗi xóa map:', error);
    res.status(500).json({ message: 'Không thể xóa map.' });
  }
};
