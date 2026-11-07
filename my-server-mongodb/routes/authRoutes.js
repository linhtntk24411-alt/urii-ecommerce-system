const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.get('/me', authenticate, authController.getMe);
router.patch('/me', authenticate, authController.updateMe);
router.put('/me', authenticate, authController.updateMe);
router.get('/oauth/:provider', authController.oauthStart);
router.get('/oauth/:provider/callback', authController.oauthCallback);

module.exports = router;
