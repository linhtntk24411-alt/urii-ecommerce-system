const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/verify-otp', authController.verifyOtp);
router.post('/resend-otp', authController.resendOtp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.get('/me', authenticate, authController.getMe);
router.patch('/me', authenticate, authController.updateMe);
router.put('/me', authenticate, authController.updateMe);
router.get('/oauth/:provider', authController.oauthStart);
router.get('/oauth/:provider/callback', authController.oauthCallback);

module.exports = router;
