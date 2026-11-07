const express = require('express');
const router = express.Router();
const c = require('../controllers/userController');
const authController = require('../controllers/authController');
const { authenticate, requireAdmin } = require('../middleware/auth');

function isDevPublicReadEnabled(req) {
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  return process.env.NODE_ENV === 'development'
    && process.env.ALLOW_PUBLIC_USER_READS === 'true'
    && isLoopback;
}

function authorizeUserListRead(req, res, next) {
  if (isDevPublicReadEnabled(req)) {
    next();
    return;
  }
  authenticate(req, res, () => requireAdmin(req, res, next));
}

function authorizeSelfOrAdminRead(req, res, next) {
  if (isDevPublicReadEnabled(req)) {
    next();
    return;
  }
  authenticate(req, res, () => {
    if (req.auth?.role === 'admin' || String(req.auth?.id) === String(req.params.id)) {
      next();
      return;
    }
    res.status(403).json({ message: 'Bạn không có quyền truy cập hồ sơ người dùng khác.' });
  });
}

router.get('/me', authenticate, authController.getMe);
router.patch('/me', authenticate, authController.updateMe);
router.put('/me', authenticate, authController.updateMe);

router.get('/', authorizeUserListRead, c.getAllUsers);
router.get('/:id', authorizeSelfOrAdminRead, c.getUserById);

router.use(authenticate, requireAdmin);
router.post('/', c.createUser);
router.put('/:id', c.updateUser);
router.patch('/:id', c.updateUser);
router.delete('/:id', c.deleteUser);

module.exports = router;
