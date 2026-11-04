const express = require('express');
const controller = require('../controllers/likedBlogController');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', authenticate, requireCustomer, controller.getMyLikedBlogs);
router.post('/mine', authenticate, requireCustomer, controller.addMyLikedBlog);
router.delete('/mine/:blogId', authenticate, requireCustomer, controller.removeMyLikedBlog);

router.use(authenticate, requireAdmin);
router.get('/', controller.getAllLikedBlogs);
router.get('/:id', controller.getLikedBlogById);
router.post('/', controller.createLikedBlog);
router.put('/:id', controller.updateLikedBlog);
router.patch('/:id', controller.updateLikedBlog);
router.delete('/:id', controller.deleteLikedBlog);

module.exports = router;
