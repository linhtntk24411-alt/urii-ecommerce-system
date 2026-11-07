const Comment = require('../models/Comment');
const Blog = require('../models/Blog');
const User = require('../models/User');
const mongoose = require('mongoose');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');
const { formatRelativeTime } = require('../utils/time');

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

async function syncBlogCommentsCount(blogId) {
  const count = await Comment.countDocuments({ blogId: Number(blogId) });
  await Blog.updateOne({ id: Number(blogId) }, { $set: { comments: count } });
}

async function enrichComments(comments) {
  const allUserIds = [
    ...new Set(
      comments.flatMap((c) => [c.userId, ...(c.replies || []).map((r) => r.userId)])
        .filter(Boolean)
        .map(String)
    )
  ];
  const users = allUserIds.length
    ? await User.find({ _id: { $in: allUserIds } }).select('name avatar role').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  return comments.map((comment) => {
    const user = comment.userId ? usersById.get(String(comment.userId)) : null;
    const createdAt = comment.createdAt || comment._id?.getTimestamp?.() || new Date();
    const dynamicTime = formatRelativeTime(createdAt);

    const enrichedReplies = (comment.replies || []).map((reply) => {
      const replyUser = reply.userId ? usersById.get(String(reply.userId)) : null;
      const replyCreatedAt = reply.createdAt || new Date();
      return {
        ...reply,
        author: reply.author || replyUser?.name || (reply.role === 'admin' ? 'Urii Admin' : 'Khách hàng'),
        avatar: reply.avatar || replyUser?.avatar || 'images/avatar-non.jpg',
        createdAt: replyCreatedAt,
        time: formatRelativeTime(replyCreatedAt),
        replyTo: reply.replyTo,
        replyToAuthor: reply.replyToAuthor
      };
    });

    return {
      ...comment,
      author: comment.author || user?.name || 'Khách hàng',
      avatar: comment.avatar || user?.avatar || 'images/avatar-non.jpg',
      createdAt,
      time: dynamicTime,
      replies: enrichedReplies
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
  const tokenUserId = typeof req.auth?.id === 'string' && mongoose.isValidObjectId(req.auth.id)
    ? req.auth.id
    : undefined;
  const bodyUserId = typeof userId === 'string' && mongoose.isValidObjectId(userId)
    ? userId
    : undefined;
  const resolvedUserId = req.auth?.role === 'admin'
    ? (bodyUserId || tokenUserId)
    : (tokenUserId || bodyUserId);
  const hasValidUser = Boolean(resolvedUserId);
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
    let id = req.auth?.role === 'admin' ? req.body.id : undefined;
    if (id === undefined) {
      const latestComment = await Comment.findOne().sort({ id: -1 }).select('id').lean();
      id = (latestComment?.id || 0) + 1;
    }
    const createdAt = req.body.createdAt ? new Date(req.body.createdAt) : new Date();
    const comment = await Comment.create({
      ...req.body,
      id,
      blogId: Number(blogId),
      ...(resolvedUserId ? { userId: resolvedUserId } : {}),
      ...(hasValidAuthor ? { author: author.trim() } : {}),
      content: content.trim(),
      createdAt,
      time: formatRelativeTime(createdAt),
      replies: []
    });
    await syncBlogCommentsCount(blogId);
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

exports.createCommentReply = async (req, res) => {
  if (!isRecord(req.body) || typeof req.body.content !== 'string' || !req.body.content.trim()) {
    res.status(400).json({ message: 'Nội dung phản hồi không hợp lệ.' });
    return;
  }

  try {
    const comment = await Comment.findOne(commentFilter(req.params.id));
    if (!comment) {
      res.status(404).json({ message: 'Không tìm thấy bình luận.' });
      return;
    }

    const tokenUserId = typeof req.auth?.id === 'string' && mongoose.isValidObjectId(req.auth.id)
      ? req.auth.id
      : undefined;
    const bodyUserId = typeof req.body.userId === 'string' && mongoose.isValidObjectId(req.body.userId)
      ? req.body.userId
      : undefined;
    const resolvedUserId = req.auth?.role === 'admin'
      ? (bodyUserId || tokenUserId)
      : (tokenUserId || bodyUserId);

    const blog = await Blog.findOne({ id: comment.blogId }).select('userId').lean();
    let role = 'user';
    if (req.auth?.role === 'admin') {
      role = 'admin';
    } else if (resolvedUserId && blog?.userId && String(resolvedUserId) === String(blog.userId)) {
      role = 'author';
    }

    const replyCount = (comment.replies?.length || 0) + 1;
    const replyId = `c${comment.id}-r${replyCount}`;
    const createdAt = req.body.createdAt ? new Date(req.body.createdAt) : new Date();

    const newReply = {
      id: replyId,
      ...(resolvedUserId ? { userId: resolvedUserId } : {}),
      ...(typeof req.body.author === 'string' && req.body.author.trim() ? { author: req.body.author.trim() } : {}),
      ...(typeof req.body.replyTo === 'string' && req.body.replyTo.trim() ? { replyTo: req.body.replyTo.trim() } : {}),
      ...(typeof req.body.replyToAuthor === 'string' && req.body.replyToAuthor.trim() ? { replyToAuthor: req.body.replyToAuthor.trim() } : {}),
      content: req.body.content.trim(),
      createdAt,
      time: formatRelativeTime(createdAt),
      role
    };

    comment.replies = comment.replies || [];
    comment.replies.push(newReply);
    await comment.save();

    emitCrudChange('comments', 'updated', comment._id);
    const [enriched] = await enrichComments([comment.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    console.error('Lỗi phản hồi bình luận:', error);
    res.status(500).json({ message: 'Không thể phản hồi bình luận.' });
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
    await syncBlogCommentsCount(comment.blogId);
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
    await syncBlogCommentsCount(comment.blogId);
    emitCrudChange('comments', 'deleted', comment._id);
    res.json({ message: 'Đã xóa bình luận.' });
  } catch (error) {
    console.error('Lỗi xóa bình luận:', error);
    res.status(500).json({ message: 'Không thể xóa bình luận.' });
  }
};
