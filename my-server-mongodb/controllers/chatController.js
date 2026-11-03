const ChatSession = require('../models/ChatSession');
const ChatbotFaq = require('../models/ChatbotFaq');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function faqFilter(value) {
  const filters = [{ id: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

// Lấy danh sách tất cả các phiên chat (hỗ trợ lọc status & tìm kiếm)
exports.getAllSessions = async (req, res) => {
  try {
    const { status, q } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (q) {
      filter.$or = [
        { userName: { $regex: q, $options: 'i' } },
        { userEmail: { $regex: q, $options: 'i' } },
        { 'messages.text': { $regex: q, $options: 'i' } }
      ];
    }

    const sessions = await ChatSession.find(filter).sort({ lastMessageTime: -1 }).lean();

    // Map dạng object { [sessionId]: session } tương thích cho SupportAdmin & client
    const sessionMap = {};
    for (const s of sessions) {
      sessionMap[s.sessionId] = s;
    }

    res.json({
      success: true,
      count: sessions.length,
      sessions,
      sessionMap
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách chat sessions:', error);
    res.status(500).json({ message: 'Không thể tải danh sách phiên chat.' });
  }
};

// Lấy chi tiết một phiên chat theo sessionId
exports.getSessionById = async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id }).lean();
    if (!session) {
      return res.status(404).json({ message: 'Không tìm thấy phiên trò chuyện.' });
    }
    res.json(session);
  } catch (error) {
    console.error('Lỗi lấy phiên chat:', error);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
};

exports.updateSession = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu phiên chat không hợp lệ.' });
    return;
  }

  const allowedFields = [
    'userName',
    'userEmail',
    'avatar',
    'status',
    'unreadCount',
    'lastMessageTime',
    'messages'
  ];
  const updates = Object.fromEntries(
    allowedFields
      .filter((field) => Object.hasOwn(req.body, field))
      .map((field) => [field, req.body[field]])
  );
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: 'Không có trường phiên chat hợp lệ để cập nhật.' });
    return;
  }

  try {
    const session = await ChatSession.findOneAndUpdate(
      { sessionId: req.params.id },
      updates,
      { new: true, runValidators: true }
    );
    if (!session) {
      res.status(404).json({ message: 'Không tìm thấy phiên chat.' });
      return;
    }
    emitCrudChange('chat', 'update', session.sessionId);
    res.json(session);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu phiên chat không hợp lệ.' });
      return;
    }
    console.error('Lỗi cập nhật phiên chat:', error);
    res.status(500).json({ message: 'Không thể cập nhật phiên chat.' });
  }
};

// Tạo mới hoặc cập nhật một phiên chat
exports.createOrUpdateSession = async (req, res) => {
  try {
    const { sessionId, userName, userEmail, avatar, status, message } = req.body;
    const id = sessionId || `cs_${Date.now()}`;

    let session = await ChatSession.findOne({ sessionId: id });

    if (!session) {
      session = new ChatSession({
        sessionId: id,
        userName: userName || 'Khách vãng lai',
        userEmail: userEmail || '',
        avatar: avatar || 'images/avatar_user.jpeg',
        status: status || 'ai',
        unreadCount: 1,
        lastMessageTime: Date.now(),
        messages: []
      });
    }

    if (message) {
      session.messages.push({
        text: message.text,
        sender: message.sender || 'user',
        timestamp: message.timestamp || Date.now(),
        isSystemLog: Boolean(message.isSystemLog)
      });
      session.lastMessageTime = Date.now();
      if (message.sender === 'user') {
        session.unreadCount += 1;
      }
    }

    await session.save();
    emitCrudChange('chat', 'update', session.sessionId);
    res.status(200).json(session);
  } catch (error) {
    console.error('Lỗi tạo/cập nhật phiên chat:', error);
    res.status(500).json({ message: 'Không thể lưu phiên chat.' });
  }
};

// Gửi tin nhắn vào phiên chat
exports.addMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, sender, isSystemLog } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Nội dung tin nhắn không được để trống.' });
    }

    const session = await ChatSession.findOne({ sessionId: id });
    if (!session) {
      return res.status(404).json({ message: 'Không tìm thấy phiên chat.' });
    }

    const msgSender = sender || 'user';
    session.messages.push({
      text: text.trim(),
      sender: msgSender,
      timestamp: Date.now(),
      isSystemLog: Boolean(isSystemLog)
    });

    session.lastMessageTime = Date.now();

    // Nếu admin gửi tin nhắn, reset unread và chuyển trạng thái sang 'active'
    if (msgSender === 'admin') {
      session.unreadCount = 0;
      session.status = 'active';
    } else if (msgSender === 'user') {
      session.unreadCount += 1;
    }

    await session.save();
    emitCrudChange('chat', 'message', session.sessionId);
    res.json(session);
  } catch (error) {
    console.error('Lỗi gửi tin nhắn:', error);
    res.status(500).json({ message: 'Không thể gửi tin nhắn.' });
  }
};

// Cập nhật trạng thái phiên chat (Takeover / Handback AI)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, systemLog } = req.body;

    if (!['ai', 'waiting', 'active'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ (ai, waiting, active).' });
    }

    const session = await ChatSession.findOne({ sessionId: id });
    if (!session) {
      return res.status(404).json({ message: 'Không tìm thấy phiên chat.' });
    }

    session.status = status;

    if (systemLog) {
      session.messages.push({
        text: systemLog,
        sender: status === 'ai' ? 'bot' : 'admin',
        timestamp: Date.now(),
        isSystemLog: true
      });
    }

    if (status === 'active') {
      session.unreadCount = 0;
    }

    session.lastMessageTime = Date.now();
    await session.save();

    emitCrudChange('chat', 'status', session.sessionId);
    res.json(session);
  } catch (error) {
    console.error('Lỗi cập nhật trạng thái chat:', error);
    res.status(500).json({ message: 'Không thể cập nhật trạng thái.' });
  }
};

// Xóa một phiên chat
exports.deleteSession = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ChatSession.findOneAndDelete({ sessionId: id });
    if (!deleted) {
      return res.status(404).json({ message: 'Không tìm thấy phiên chat để xóa.' });
    }
    emitCrudChange('chat', 'delete', id);
    res.json({ success: true, message: 'Đã xóa phiên chat.' });
  } catch (error) {
    console.error('Lỗi xóa phiên chat:', error);
    res.status(500).json({ message: 'Không thể xóa phiên chat.' });
  }
};

// Lấy danh sách FAQ / Kịch bản phản hồi tự động của Bot
exports.getFaqs = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const faqs = await ChatbotFaq.find().sort({ id: 1 }).skip(skip).limit(limit).lean();
    res.json(faqs);
  } catch (error) {
    console.error('Lỗi lấy danh sách FAQ:', error);
    res.status(500).json({ message: 'Không thể tải kịch bản chatbot.' });
  }
};

exports.getFaqById = async (req, res) => {
  try {
    const faq = await ChatbotFaq.findOne(faqFilter(req.params.id)).lean();
    if (!faq) {
      res.status(404).json({ message: 'Không tìm thấy FAQ.' });
      return;
    }
    res.json(faq);
  } catch (error) {
    console.error('Lỗi tải FAQ:', error);
    res.status(500).json({ message: 'Không thể tải FAQ.' });
  }
};

exports.createFaq = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
    return;
  }

  try {
    const faq = await ChatbotFaq.create({
      ...req.body,
      id: req.body.id || `faq-${randomUUID()}`
    });
    emitCrudChange('chatbotFaqs', 'created', faq.id);
    res.status(201).json(faq);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã FAQ đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo FAQ:', error);
    res.status(500).json({ message: 'Không thể tạo FAQ.' });
  }
};

exports.updateFaq = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    const faq = await ChatbotFaq.findOneAndUpdate(faqFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!faq) {
      res.status(404).json({ message: 'Không tìm thấy FAQ.' });
      return;
    }
    emitCrudChange('chatbotFaqs', 'updated', faq.id);
    res.json(faq);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã FAQ đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật FAQ:', error);
    res.status(500).json({ message: 'Không thể cập nhật FAQ.' });
  }
};

exports.deleteFaq = async (req, res) => {
  try {
    const faq = await ChatbotFaq.findOneAndDelete(faqFilter(req.params.id));
    if (!faq) {
      res.status(404).json({ message: 'Không tìm thấy FAQ.' });
      return;
    }
    emitCrudChange('chatbotFaqs', 'deleted', faq.id);
    res.json({ message: 'Đã xóa FAQ.' });
  } catch (error) {
    console.error('Lỗi xóa FAQ:', error);
    res.status(500).json({ message: 'Không thể xóa FAQ.' });
  }
};

// Khớp câu hỏi của người dùng với kịch bản trả lời tự động (FAQ Matching)
exports.matchFaq = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ message: 'Vui lòng cung cấp nội dung truy vấn.' });
    }

    const q = query.toLowerCase().trim();
    const faqs = await ChatbotFaq.find().lean();

    // Tìm FAQ có keyword trùng khớp cao nhất
    let matchedFaq = null;
    let maxMatch = 0;

    for (const faq of faqs) {
      let matches = 0;
      for (const kw of faq.keywords || []) {
        if (q.includes(kw.toLowerCase())) {
          matches++;
        }
      }
      if (matches > maxMatch) {
        maxMatch = matches;
        matchedFaq = faq;
      }
    }

    if (matchedFaq && maxMatch > 0) {
      return res.json({
        matched: true,
        intent: matchedFaq.intent,
        response: matchedFaq.response,
        quickReplies: matchedFaq.quickReplies || []
      });
    }

    // Câu trả lời mặc định khi không khớp keyword
    res.json({
      matched: false,
      intent: 'fallback',
      response: 'Dạ Urii đã ghi nhận câu hỏi của bạn. Bạn muốn tra cứu sản phẩm, đơn hàng hay cần gặp chuyên viên tư vấn trực tiếp ạ?',
      quickReplies: ['Tra cứu đơn hàng', 'Hướng dẫn làm hạt ủi', 'Mã giảm giá', 'Gặp tư vấn viên']
    });
  } catch (error) {
    console.error('Lỗi xử lý câu hỏi chatbot:', error);
    res.status(500).json({ message: 'Lỗi xử lý phản hồi tự động.' });
  }
};
