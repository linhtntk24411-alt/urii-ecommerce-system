const express = require('express');
const router = express.Router();
const c = require('../controllers/blogController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', c.getAllBlogs);
router.get('/:slug', c.getBlogBySlug);
router.post('/', authenticate, c.createBlog);
router.put('/:id', authenticate, requireAdmin, c.updateBlog);
router.patch('/:id', authenticate, requireAdmin, c.updateBlog);
router.delete('/:id', authenticate, requireAdmin, c.deleteBlog);

module.exports = router;