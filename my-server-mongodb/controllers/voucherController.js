const Voucher = require('../models/Voucher');
const { getPagination } = require('../utils/pagination');

function parseVoucherDate(value, endOfDay = false) {
  if (!value) {
    return null;
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  if (date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[1])) {
    return null;
  }
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function isVoucherAvailable(voucher, now = new Date()) {
  if (!voucher.isActive) {
    return false;
  }
  const startDate = parseVoucherDate(voucher.startDate);
  const endDate = parseVoucherDate(voucher.endDate, true);
  if ((voucher.startDate && !startDate) || (voucher.endDate && !endDate)) {
    return false;
  }
  return (!startDate || startDate <= now)
    && (!endDate || now <= endDate)
    && (voucher.quantity === undefined || voucher.used < voucher.quantity);
}

exports.getActiveVouchers = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const vouchers = await Voucher.find({ isActive: true }).sort({ code: 1 }).lean();
    res.json(vouchers.filter((voucher) => isVoucherAvailable(voucher)).slice(skip, skip + limit));
  } catch (error) {
    console.error('Lỗi tải voucher:', error);
    res.status(500).json({ message: 'Không thể tải danh sách voucher.' });
  }
};

exports.isVoucherAvailable = isVoucherAvailable;
