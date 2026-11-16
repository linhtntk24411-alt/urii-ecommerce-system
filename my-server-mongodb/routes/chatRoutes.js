const express = require('express');
const router = express.Router();
const c = require('../controllers/chatController');
const { authenticate, requireAdmin, optionalAuthenticate } = require('../middleware/auth');

router.post('/sessions/:id/attachments', optionalAuthenticate, c.chatIdentity, c.requireChatOwner,
  c.attachmentSlot, express.raw({ type: 'application/octet-stream', limit: 10 * 1024 * 1024 }), c.uploadAttachment);
router.get('/sessions/:id/messages/:messageId/attachment', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.getAttachment);

router.post('/sessions/:id/reaction-identity', optionalAuthenticate, c.chatIdentity, c.prepareReactionSession);
router.get('/sessions/:id/reactions', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.getReactions);
router.put('/sessions/:id/messages/:messageId/reaction', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.setReaction);
router.post('/sessions/:id/messages/:messageId/recall', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.recallMessage);
router.post('/sessions/:id/messages/:messageId/forward', authenticate, requireAdmin, c.chatIdentity, c.requireChatOwner, c.forwardMessage);

// Public endpoints (dành cho Chatbot Client / Người dùng)
router.get('/faqs', c.getFaqs);
router.get('/faqs/:id', c.getFaqById);
router.post('/match', c.matchFaq);
router.post('/ai', c.askAi);
router.post('/request-agent', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.requestAgent);
router.post('/sessions/:id/request-agent', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.requestAgent);
router.get('/sessions/:id', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.getSessionById);
router.post('/sessions', optionalAuthenticate, c.chatIdentity, c.createOrUpdateSession);
router.post('/sessions/:id/messages', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.addMessage);
router.post('/sessions/:id/cancel-agent', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.cancelAgent);
router.delete('/sessions/:id/messages', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.clearSessionMessages);
router.delete('/sessions/:id', optionalAuthenticate, c.chatIdentity, c.requireChatOwner, c.deleteSession);

// Admin-only endpoints (dành cho SupportAdmin / Quản trị viên)
router.post('/faqs', authenticate, requireAdmin, c.createFaq);
router.put('/faqs/:id', authenticate, requireAdmin, c.updateFaq);
router.patch('/faqs/:id', authenticate, requireAdmin, c.updateFaq);
router.delete('/faqs/:id', authenticate, requireAdmin, c.deleteFaq);
router.get('/sessions', authenticate, requireAdmin, c.getAllSessions);
router.put('/sessions/:id', authenticate, requireAdmin, c.updateSession);
router.patch('/sessions/:id', authenticate, requireAdmin, c.updateSession);
router.put('/sessions/:id/status', authenticate, requireAdmin, c.updateStatus);

module.exports = router;
