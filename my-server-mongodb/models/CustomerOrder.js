const mongoose = require('mongoose');
const { isValidImageUrl } = require('../utils/imageUrl');

const customerOrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  requestName: { type: String, required: true, trim: true },
  size: { type: String, required: true, trim: true },
  beadType: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  imageNote: { type: String, default: '' },
  imageUrl: {
    type: String,
    required: true,
    validate: {
      validator: isValidImageUrl,
      message: 'imageUrl phải là đường dẫn /images/... hoặc URL http/https hợp lệ.'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'quoted', 'processing', 'completed', 'cancelled'],
    default: 'pending'
  }
}, { timestamps: true });

module.exports = mongoose.model('CustomerOrder', customerOrderSchema);
