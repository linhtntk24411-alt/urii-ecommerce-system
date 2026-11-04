const Blog = require('../models/Blog');
const User = require('../models/User');
const blogData = require('../data/blogs.json');
const mongoose = require('mongoose');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

const blogCategoriesById = new Map(
  (blogData.categories || []).map((category) => [category.id, category])
);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function blogFilter(value) {
  const filters = [{ slug: value }];
  const numericId = Number(value);
  if (Number.isSafeInteger(numericId)) {
    filters.push({ id: numericId });
  }
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

async function enrichBlogs(blogs) {
  const userIds = [...new Set(blogs.map((b) => b.userId).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name avatar').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  return blogs.map((blog) => {
    const user = blog.userId ? usersById.get(String(blog.userId)) : null;
    const category = blog.categoryId ? blogCategoriesById.get(blog.categoryId) : null;
    return {
      ...blog,
      author: blog.author || user?.name || 'Urii',
      avatar: blog.avatar || user?.avatar || 'images/avatar-non.jpg',
      category: blog.category || category?.name || '',
      categorySlug: blog.categorySlug || category?.slug || ''
    };
  });
}

exports.getAllBlogs = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const blogs = await Blog.find().sort({ id: 1 }).skip(skip).limit(limit).lean();
    res.json(await enrichBlogs(blogs));
  } catch (error) {
    console.error('Lỗi tải bài viết:', error);
    res.status(500).json({ message: 'Không thể tải danh sách bài viết.' });
  }
};

exports.getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne(blogFilter(req.params.slug)).lean();
    if (!blog) {
      res.status(404).json({ message: 'Không tìm thấy bài viết.' });
      return;
    }
    const [enriched] = await enrichBlogs([blog]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải bài viết:', error);
    res.status(500).json({ message: 'Không thể tải bài viết.' });
  }
};

exports.createBlog = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu bài viết không hợp lệ.' });
    return;
  }

  try {
    let id = req.body.id;
    if (id === undefined) {
      const latestBlog = await Blog.findOne().sort({ id: -1 }).select('id').lean();
      id = (latestBlog?.id || 0) + 1;
    }
    const blog = await Blog.create({ ...req.body, id });
    emitCrudChange('blogs', 'created', blog._id);
    const [enriched] = await enrichBlogs([blog.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu bài viết không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã hoặc slug bài viết đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo bài viết:', error);
    res.status(500).json({ message: 'Không thể tạo bài viết.' });
  }
};

exports.updateBlog = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu bài viết không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    const blog = await Blog.findOneAndUpdate(blogFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!blog) {
      res.status(404).json({ message: 'Không tìm thấy bài viết.' });
      return;
    }
    emitCrudChange('blogs', 'updated', blog._id);
    const [enriched] = await enrichBlogs([blog.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu bài viết không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã hoặc slug bài viết đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật bài viết:', error);
    res.status(500).json({ message: 'Không thể cập nhật bài viết.' });
  }
};

exports.deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findOneAndDelete(blogFilter(req.params.id));
    if (!blog) {
      res.status(404).json({ message: 'Không tìm thấy bài viết.' });
      return;
    }
    emitCrudChange('blogs', 'deleted', blog._id);
    res.json({ message: 'Đã xóa bài viết.' });
  } catch (error) {
    console.error('Lỗi xóa bài viết:', error);
    res.status(500).json({ message: 'Không thể xóa bài viết.' });
  }
};
