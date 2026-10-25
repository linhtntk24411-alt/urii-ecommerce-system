const express = require('express');
const router = express.Router();
const c = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);
router.get('/', c.getAllUsers);
module.exports = router;