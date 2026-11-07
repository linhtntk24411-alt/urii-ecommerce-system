const mongoose = require('mongoose');
const { isValidImageUrl } = require('../utils/imageUrl');

const customOrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  mapId: { type: String, trim: true },
  fullName: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  requestName: { type: String, required: true, trim: true },
  size: { type: String, required: true, trim: true },
  beadType: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  imageNote: { type: String, default: '' },
  imageUrl: {
    type: String,
    default: '',
    validate: {
      validator: (value) => !value || isValidImageUrl(value),
      message: 'imageUrl phải là đường dẫn /images/... hoặc URL http/https hợp lệ.'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'quoted', 'processing', 'completed', 'cancelled'],
    default: 'pending'
  }
}, { timestamps: true });

customOrderSchema.pre('validate', function () {
  const hasCustomerRef = Boolean(this.userId);
  const hasCustomerInfo = Boolean(this.fullName && this.phone && this.email);
  if (!hasCustomerRef && !hasCustomerInfo) {
    this.invalidate('userId', 'Phải có userId hoặc đầy đủ fullName, phone, email.');
  }
});

module.exports = mongoose.model('CustomOrder', customOrderSchema, 'custom_orders');
