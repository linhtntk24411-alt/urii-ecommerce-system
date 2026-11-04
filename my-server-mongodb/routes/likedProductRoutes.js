const express = require('express');
const controller = require('../controllers/likedProductController');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', authenticate, requireCustomer, controller.getMyLikedProducts);
router.post('/mine', authenticate, requireCustomer, controller.addMyLikedProduct);
router.delete('/mine/:productId', authenticate, requireCustomer, controller.removeMyLikedProduct);

router.use(authenticate, requireAdmin);
router.get('/', controller.getAllLikedProducts);
router.get('/:id', controller.getLikedProductById);
router.post('/', controller.createLikedProduct);
router.put('/:id', controller.updateLikedProduct);
router.patch('/:id', controller.updateLikedProduct);
router.delete('/:id', controller.deleteLikedProduct);

module.exports = router;
