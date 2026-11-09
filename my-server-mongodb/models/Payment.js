const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  paymentCode: { type: String, required: true, trim: true, uppercase: true },
  amountDue: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, enum: ['VND'], default: 'VND' },
  methodId: { type: String, enum: ['bank_transfer'], default: 'bank_transfer' },
  provider: { type: String, enum: ['sepay'], default: 'sepay' },
  statusId: {
    type: String,
    enum: ['awaiting_payment', 'paid', 'cancelled', 'expired'],
    default: 'awaiting_payment'
  },
  expiresAt: { type: Date, required: true },
  paidAt: { type: Date, default: null },
  inventoryReservations: [{
    productId: { type: String, required: true },
    productObjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    variantIndex: { type: Number, default: null },
    trackProductTotal: { type: Boolean, default: false },
    quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    status: { type: String, enum: ['reserved', 'released', 'consumed'], default: 'reserved' }
  }],
  voucherReservation: {
    voucherId: { type: String, default: null },
    userVoucherId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['reserved', 'released', 'consumed'], default: undefined }
  }
}, { timestamps: true });

paymentSchema.index({ orderId: 1 }, { unique: true });
paymentSchema.index({ paymentCode: 1 }, { unique: true });
paymentSchema.index({ statusId: 1, expiresAt: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
