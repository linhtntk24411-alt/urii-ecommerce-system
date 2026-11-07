const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get('/', dashboardController.getDashboardStats);

module.exports = router;
