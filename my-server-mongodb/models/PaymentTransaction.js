const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    default: null
  },
  sepayTransactionId: { type: String, required: true, trim: true },
  paymentCodeObserved: { type: String, trim: true, default: null },
  transferType: { type: String, enum: ['in', 'out'], required: true },
  transferAmount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  bankReference: { type: String, trim: true, default: null },
  transactionAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  classification: {
    type: String,
    enum: [
      'matched',
      'underpaid',
      'overpaid',
      'late_after_cancel',
      'late_after_expire',
      'duplicate_payment',
      'invalid_reservation',
      'unknown_payment_code',
      'outgoing'
    ],
    required: true
  },
  reviewStatus: {
    type: String,
    enum: ['pending', 'not_required', 'resolved'],
    default: 'pending'
  },
  reviewNote: { type: String, trim: true, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

paymentTransactionSchema.index({ sepayTransactionId: 1 }, { unique: true });
paymentTransactionSchema.index({ paymentId: 1, transactionAt: -1 });
paymentTransactionSchema.index({ reviewStatus: 1, transactionAt: 1 });
paymentTransactionSchema.index({ paymentCodeObserved: 1, transactionAt: -1 });

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
