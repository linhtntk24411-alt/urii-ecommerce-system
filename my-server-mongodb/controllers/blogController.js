const Blog = require('../models/Blog');
const { getPagination } = require('../utils/pagination');

exports.getAllBlogs = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await Blog.find().sort({ id: 1 }).skip(skip).limit(limit).lean());
  } catch (error) {
    console.error('Lỗi tải bài viết:', error);
    res.status(500).json({ message: 'Không thể tải danh sách bài viết.' });
  }
};

exports.getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug }).lean();
    if (!blog) {
      res.status(404).json({ message: 'Không tìm thấy bài viết.' });
      return;
    }
    res.json(blog);
  } catch (error) {
    console.error('Lỗi tải bài viết:', error);
    res.status(500).json({ message: 'Không thể tải bài viết.' });
  }
};