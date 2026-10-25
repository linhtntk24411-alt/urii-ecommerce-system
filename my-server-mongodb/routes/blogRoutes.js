const express = require('express');
const router = express.Router();
const c = require('../controllers/blogController');
router.get('/', c.getAllBlogs);
router.get('/:slug', c.getBlogBySlug);
module.exports = router;