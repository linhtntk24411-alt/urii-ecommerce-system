const express = require('express');
const router = express.Router();
const c = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);
router.get('/', c.getAllUsers);
router.get('/:id', c.getUserById);
router.post('/', c.createUser);
router.put('/:id', c.updateUser);
router.patch('/:id', c.updateUser);
router.delete('/:id', c.deleteUser);
module.exports = router;