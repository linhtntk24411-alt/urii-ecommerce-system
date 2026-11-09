const express = require('express');
const router = express.Router();
const c = require('../controllers/chatController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Public endpoints (dành cho Chatbot Client / Người dùng)
router.get('/faqs', c.getFaqs);
router.get('/faqs/:id', c.getFaqById);
router.post('/match', c.matchFaq);
router.post('/ai', c.askAi);
router.post('/request-agent', c.requestAgent);
router.post('/sessions/:id/request-agent', c.requestAgent);
router.post('/sessions/:id/cancel-agent', c.cancelAgent);
router.get('/sessions/:id', c.getSessionById);
router.post('/sessions', c.createOrUpdateSession);
router.post('/sessions/:id/messages', c.addMessage);

// Admin-only endpoints (dành cho SupportAdmin / Quản trị viên)
router.post('/faqs', authenticate, requireAdmin, c.createFaq);
router.put('/faqs/:id', authenticate, requireAdmin, c.updateFaq);
router.patch('/faqs/:id', authenticate, requireAdmin, c.updateFaq);
router.delete('/faqs/:id', authenticate, requireAdmin, c.deleteFaq);
router.get('/sessions', authenticate, requireAdmin, c.getAllSessions);
router.put('/sessions/:id', authenticate, requireAdmin, c.updateSession);
router.patch('/sessions/:id', authenticate, requireAdmin, c.updateSession);
router.put('/sessions/:id/status', authenticate, requireAdmin, c.updateStatus);
router.delete('/sessions/:id', authenticate, requireAdmin, c.deleteSession);

module.exports = router;
