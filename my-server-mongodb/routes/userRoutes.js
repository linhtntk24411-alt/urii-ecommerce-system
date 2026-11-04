const express = require('express');
const router = express.Router();
const c = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

function authorizeUserRead(req, res, next) {
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  if (process.env.NODE_ENV === 'development'
    && process.env.ALLOW_PUBLIC_USER_READS === 'true'
    && isLoopback) {
    next();
    return;
  }
  authenticate(req, res, () => requireAdmin(req, res, next));
}

router.get('/', authorizeUserRead, c.getAllUsers);
router.get('/:id', authorizeUserRead, c.getUserById);
router.use(authenticate, requireAdmin);
router.post('/', c.createUser);
router.put('/:id', c.updateUser);
router.patch('/:id', c.updateUser);
router.delete('/:id', c.deleteUser);
module.exports = router;