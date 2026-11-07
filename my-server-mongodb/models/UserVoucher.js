const mongoose = require('mongoose');

const userVoucherSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  voucherId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  code: {
    type: String,
    required: true,
    trim: true
  },
  source: {
    type: String,
    enum: ['promotion', 'birthday'],
    default: 'promotion'
  },
  claimedAt: {
    type: Date,
    default: Date.now
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  usedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// Chuẩn hóa theo id user và id voucher (mỗi user chỉ nhận 1 voucher 1 lần)
userVoucherSchema.index({ userId: 1, voucherId: 1 }, { unique: true });

module.exports = mongoose.model('UserVoucher', userVoucherSchema, 'user_vouchers');
