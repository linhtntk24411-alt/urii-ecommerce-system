const Comment = require('../models/Comment');
const Blog = require('../models/Blog');
const User = require('../models/User');
const mongoose = require('mongoose');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function commentFilter(value) {
  const filters = [];
  const numericId = Number(value);
  if (Number.isSafeInteger(numericId)) {
    filters.push({ id: numericId });
  }
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  if (filters.length === 0) {
    return { id: value };
  }
  return { $or: filters };
}

async function enrichComments(comments) {
  const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name avatar').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  return comments.map((comment) => {
    const user = comment.userId ? usersById.get(String(comment.userId)) : null;
    return {
      ...comment,
      author: comment.author || user?.name || 'Khách hàng',
      avatar: comment.avatar || user?.avatar || 'images/avatar-non.jpg'
    };
  });
}

exports.getAllComments = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const comments = await Comment.find().sort({ id: 1 }).skip(skip).limit(limit).lean();
    res.json(await enrichComments(comments));
  } catch (error) {
    console.error('Lỗi tải bình luận:', error);
    res.status(500).json({ message: 'Không thể tải danh sách bình luận.' });
  }
};

exports.getCommentById = async (req, res) => {
  try {
    const comment = await Comment.findOne(commentFilter(req.params.id)).lean();
    if (!comment) {
      res.status(404).json({ message: 'Không tìm thấy bình luận.' });
      return;
    }
    const [enriched] = await enrichComments([comment]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải bình luận:', error);
    res.status(500).json({ message: 'Không thể tải bình luận.' });
  }
};

exports.createComment = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu bình luận không hợp lệ.' });
    return;
  }

  const { userId, author, blogId, content } = req.body;
  const hasValidUser = typeof userId === 'string' && mongoose.isValidObjectId(userId);
  const hasValidAuthor = typeof author === 'string' && Boolean(author.trim());
  if ((!hasValidUser && !hasValidAuthor)
    || !Number.isSafeInteger(Number(blogId)) || Number(blogId) < 1
    || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ message: 'Mã bài viết, tác giả (userId hoặc author) và nội dung bình luận là bắt buộc.' });
    return;
  }

  try {
    if (!await Blog.exists({ id: Number(blogId) })) {
      res.status(400).json({ message: 'Bài viết được bình luận không tồn tại.' });
      return;
    }
    let id = req.body.id;
    if (id === undefined) {
      const latestComment = await Comment.findOne().sort({ id: -1 }).select('id').lean();
      id = (latestComment?.id || 0) + 1;
    }
    const comment = await Comment.create({
      ...req.body,
      id,
      blogId: Number(blogId),
      ...(hasValidAuthor ? { author: author.trim() } : {}),
      content: content.trim()
    });
    emitCrudChange('comments', 'created', comment._id);
    const [enriched] = await enrichComments([comment.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu bình luận không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bình luận đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo bình luận:', error);
    res.status(500).json({ message: 'Không thể tạo bình luận.' });
  }
};

exports.updateComment = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu bình luận không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;
  if (updates.blogId !== undefined) {
    if (!Number.isSafeInteger(Number(updates.blogId)) || Number(updates.blogId) < 1) {
      res.status(400).json({ message: 'Mã bài viết không hợp lệ.' });
      return;
    }
    updates.blogId = Number(updates.blogId);
  }

  try {
    if (updates.blogId !== undefined && !await Blog.exists({ id: updates.blogId })) {
      res.status(400).json({ message: 'Bài viết được bình luận không tồn tại.' });
      return;
    }
    const comment = await Comment.findOneAndUpdate(commentFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!comment) {
      res.status(404).json({ message: 'Không tìm thấy bình luận.' });
      return;
    }
    emitCrudChange('comments', 'updated', comment._id);
    const [enriched] = await enrichComments([comment.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu bình luận không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bình luận đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật bình luận:', error);
    res.status(500).json({ message: 'Không thể cập nhật bình luận.' });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findOneAndDelete(commentFilter(req.params.id));
    if (!comment) {
      res.status(404).json({ message: 'Không tìm thấy bình luận.' });
      return;
    }
    emitCrudChange('comments', 'deleted', comment._id);
    res.json({ message: 'Đã xóa bình luận.' });
  } catch (error) {
    console.error('Lỗi xóa bình luận:', error);
    res.status(500).json({ message: 'Không thể xóa bình luận.' });
  }
};
