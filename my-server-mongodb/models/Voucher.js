const mongoose = require('mongoose');
const voucherSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: String,
  type: { type: String, required: true, enum: ['shipping', 'percent', 'fixed'] },
  discountValue: { type: Number, required: true, min: 0 },
  minOrder: { type: Number, default: 0, min: 0 },
  maxDiscount: { type: Number, min: 0 },
  startDate: String,
  endDate: String,
  quantity: { type: Number, min: 0 },
  used: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('Voucher', voucherSchema);