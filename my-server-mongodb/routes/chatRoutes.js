const express = require('express');
const router = express.Router();
const c = require('../controllers/chatController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Public endpoints (dành cho Chatbot Client / Người dùng)
router.get('/faqs', c.getFaqs);
router.post('/match', c.matchFaq);
router.get('/sessions/:id', c.getSessionById);
router.post('/sessions', c.createOrUpdateSession);
router.post('/sessions/:id/messages', c.addMessage);

// Admin-only endpoints (dành cho SupportAdmin / Quản trị viên)
router.get('/sessions', authenticate, requireAdmin, c.getAllSessions);
router.put('/sessions/:id/status', authenticate, requireAdmin, c.updateStatus);
router.delete('/sessions/:id', authenticate, requireAdmin, c.deleteSession);

module.exports = router;
