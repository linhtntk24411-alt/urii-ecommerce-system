const Comment = require('../models/Comment');
const { getPagination } = require('../utils/pagination');

exports.getAllComments = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await Comment.find().sort({ id: 1 }).skip(skip).limit(limit).lean());
  } catch (error) {
    console.error('Lỗi tải bình luận:', error);
    res.status(500).json({ message: 'Không thể tải danh sách bình luận.' });
  }
};