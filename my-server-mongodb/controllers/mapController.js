const SampleMap = require('../models/SampleMap');
const { getPagination } = require('../utils/pagination');

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
    const map = await SampleMap.findOne({ map_id: req.params.mapId }).lean();
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
