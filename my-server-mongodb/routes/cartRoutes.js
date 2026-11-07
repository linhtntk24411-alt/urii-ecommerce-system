const express = require('express');
const controller = require('../controllers/cartController');
const { authenticate, requireCustomer } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireCustomer);
router.get('/', controller.getCart);
router.post('/items', controller.addItem);
router.patch('/items/:itemId', controller.updateItem);
router.delete('/items/:itemId', controller.removeItem);
router.delete('/', controller.clearCart);

module.exports = router;
