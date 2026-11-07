const express = require('express');
const router = express.Router();
const c = require('../controllers/commentController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', c.getAllComments);
router.get('/:id', c.getCommentById);
router.post('/', authenticate, c.createComment);
router.put('/:id', authenticate, requireAdmin, c.updateComment);
router.patch('/:id', authenticate, requireAdmin, c.updateComment);
router.delete('/:id', authenticate, requireAdmin, c.deleteComment);

module.exports = router;