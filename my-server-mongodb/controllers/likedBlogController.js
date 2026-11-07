const mongoose = require('mongoose');
const LikedBlog = require('../models/LikedBlog');
const User = require('../models/User');
const Blog = require('../models/Blog');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function likedBlogFilter(value) {
  const filters = [{ id: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

async function getCustomerId(req, res) {
  const id = req.auth?.id;
  if (!mongoose.isValidObjectId(id)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return null;
  }
  const userExists = await User.exists({ _id: id, role: 'user' });
  if (!userExists) {
    res.status(401).json({ message: 'Tài khoản khách hàng không còn tồn tại.' });
    return null;
  }
  return id;
}

async function referencesExistingCustomerAndBlog(userId, blogId) {
  const numericBlogId = Number(blogId);
  if (!mongoose.isValidObjectId(userId)
    || !await User.exists({ _id: userId, role: 'user' })
    || !Number.isSafeInteger(numericBlogId)
    || !await Blog.exists({ id: numericBlogId })) {
    return false;
  }
  return true;
}

async function syncBlogLikesCount(blogId) {
  const count = await LikedBlog.countDocuments({ blogId: Number(blogId), liked: true });
  await Blog.updateOne({ id: Number(blogId) }, { $set: { likes: count } });
}

async function enrichLikedBlogs(records) {
  const blogIds = [...new Set(records.map((item) => item.blogId).filter((id) => Number.isSafeInteger(id)))];
  const blogs = blogIds.length
    ? await Blog.find({ id: { $in: blogIds } })
      .select('id title slug excerpt image date categoryId isFeatured likes comments views tags')
      .lean()
    : [];
  const blogsById = new Map(blogs.map((blog) => [blog.id, blog]));
  return records.map((record) => ({
    ...record,
    blog: blogsById.get(record.blogId) || null
  }));
}

exports.getAllLikedBlogs = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const items = await LikedBlog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(await enrichLikedBlogs(items));
  } catch (error) {
    console.error('Lỗi tải bài viết đã thích:', error);
    res.status(500).json({ message: 'Không thể tải danh sách bài viết đã thích.' });
  }
};

exports.getLikedBlogById = async (req, res) => {
  try {
    const item = await LikedBlog.findOne(likedBlogFilter(req.params.id)).lean();
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy bài viết đã thích.' });
      return;
    }
    const [enriched] = await enrichLikedBlogs([item]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải bài viết đã thích:', error);
    res.status(500).json({ message: 'Không thể tải bài viết đã thích.' });
  }
};

exports.createLikedBlog = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu bài viết đã thích không hợp lệ.' });
    return;
  }

  try {
    if (!await referencesExistingCustomerAndBlog(req.body.userId, req.body.blogId)) {
      res.status(400).json({ message: 'Khách hàng hoặc bài viết không tồn tại.' });
      return;
    }
    const blogId = Number(req.body.blogId);
    const item = await LikedBlog.create({
      ...req.body,
      blogId,
      id: req.body.id || `liked-blog-${String(req.body.userId)}-${blogId}`
    });
    await syncBlogLikesCount(blogId);
    emitCrudChange('likedBlogs', 'created', item.id);
    const [enriched] = await enrichLikedBlogs([item.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu bài viết đã thích không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bản ghi đã tồn tại hoặc khách hàng đã thích bài viết này.' });
      return;
    }
    console.error('Lỗi tạo bài viết đã thích:', error);
    res.status(500).json({ message: 'Không thể tạo bài viết đã thích.' });
  }
};

exports.updateLikedBlog = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu bài viết đã thích không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    const current = await LikedBlog.findOne(likedBlogFilter(req.params.id))
      .select('userId blogId')
      .lean();
    if (!current) {
      res.status(404).json({ message: 'Không tìm thấy bài viết đã thích.' });
      return;
    }
    if (Object.hasOwn(updates, 'userId') || Object.hasOwn(updates, 'blogId')) {
      if (!await referencesExistingCustomerAndBlog(
        updates.userId ?? current.userId,
        updates.blogId ?? current.blogId
      )) {
        res.status(400).json({ message: 'Khách hàng hoặc bài viết không tồn tại.' });
        return;
      }
      if (updates.blogId !== undefined) updates.blogId = Number(updates.blogId);
    }
    const item = await LikedBlog.findOneAndUpdate(likedBlogFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    await syncBlogLikesCount(current.blogId);
    if (item.blogId !== current.blogId) {
      await syncBlogLikesCount(item.blogId);
    }
    emitCrudChange('likedBlogs', 'updated', item.id);
    const [enriched] = await enrichLikedBlogs([item.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu bài viết đã thích không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bản ghi đã tồn tại hoặc khách hàng đã thích bài viết này.' });
      return;
    }
    console.error('Lỗi cập nhật bài viết đã thích:', error);
    res.status(500).json({ message: 'Không thể cập nhật bài viết đã thích.' });
  }
};

exports.deleteLikedBlog = async (req, res) => {
  try {
    const item = await LikedBlog.findOneAndDelete(likedBlogFilter(req.params.id));
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy bài viết đã thích.' });
      return;
    }
    await syncBlogLikesCount(item.blogId);
    emitCrudChange('likedBlogs', 'deleted', item.id);
    res.json({ message: 'Đã xóa bài viết đã thích.' });
  } catch (error) {
    console.error('Lỗi xóa bài viết đã thích:', error);
    res.status(500).json({ message: 'Không thể xóa bài viết đã thích.' });
  }
};

exports.getMyLikedBlogs = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const { skip, limit } = getPagination(req.query);
    const items = await LikedBlog.find({ userId, liked: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json(await enrichLikedBlogs(items));
  } catch (error) {
    console.error('Lỗi tải danh sách bài viết yêu thích của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách bài viết yêu thích.' });
  }
};

exports.addMyLikedBlog = async (req, res) => {
  const { blogId } = req.body || {};
  const numericBlogId = Number(blogId);
  if (!isRecord(req.body)
    || Object.keys(req.body).some((key) => key !== 'blogId')
    || !Number.isSafeInteger(numericBlogId)
    || numericBlogId < 1) {
    res.status(400).json({ message: 'Mã bài viết không hợp lệ.' });
    return;
  }

  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const blog = await Blog.findOne({ id: numericBlogId }).select('id').lean();
    if (!blog) {
      res.status(404).json({ message: 'Không tìm thấy bài viết.' });
      return;
    }
    const item = await LikedBlog.findOneAndUpdate(
      { userId, blogId: blog.id },
      {
        $set: { liked: true },
        $setOnInsert: {
          id: `liked-blog-${String(userId)}-${blog.id}`,
          userId,
          blogId: blog.id
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    await syncBlogLikesCount(blog.id);
    emitCrudChange('likedBlogs', 'updated', item.id);
    const [enriched] = await enrichLikedBlogs([item.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    console.error('Lỗi lưu bài viết yêu thích:', error);
    res.status(500).json({ message: 'Không thể lưu bài viết yêu thích.' });
  }
};

exports.removeMyLikedBlog = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const numericId = Number(req.params.blogId);
    const query = Number.isSafeInteger(numericId)
      ? { userId, $or: [{ blogId: numericId }, { id: req.params.blogId }] }
      : { userId, id: req.params.blogId };
    const item = await LikedBlog.findOneAndDelete(query);
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy bài viết yêu thích.' });
      return;
    }
    await syncBlogLikesCount(item.blogId);
    emitCrudChange('likedBlogs', 'deleted', item.id);
    res.json({ message: 'Đã bỏ thích bài viết.' });
  } catch (error) {
    console.error('Lỗi bỏ thích bài viết:', error);
    res.status(500).json({ message: 'Không thể bỏ thích bài viết.' });
  }
};
