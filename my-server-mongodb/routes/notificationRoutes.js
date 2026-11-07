const express = require('express');
const router = express.Router();
const c = require('../controllers/notificationController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/metadata', c.getNotificationMetadata);
router.get('/mine', authenticate, c.getMyNotifications);
router.patch('/read-all', authenticate, c.markAllAsRead);
router.patch('/:id/read', authenticate, c.markAsRead);

router.use(authenticate, requireAdmin);
router.get('/', c.getAdminNotifications);
router.get('/admin', c.getAdminNotifications);
router.post('/', c.createNotification);
router.delete('/:id', c.deleteNotification);

module.exports = router;
