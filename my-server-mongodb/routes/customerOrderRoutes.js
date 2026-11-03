const express = require('express');
const controller = require('../controllers/customerOrderController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/', controller.createCustomerOrder);
router.get('/', authenticate, requireAdmin, controller.getAllCustomerOrders);
router.get('/:id', authenticate, requireAdmin, controller.getCustomerOrderById);
router.put('/:id', authenticate, requireAdmin, controller.updateCustomerOrder);
router.patch('/:id', authenticate, requireAdmin, controller.updateCustomerOrder);
router.delete('/:id', authenticate, requireAdmin, controller.deleteCustomerOrder);

module.exports = router;
