const Voucher = require('../models/Voucher');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');

function voucherFilter(value) {
  const filters = [{ id: value }, { code: String(value).toUpperCase() }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

function parseVoucherDate(value, endOfDay = false) {
  if (!value) {
    return null;
  }
  const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dayFirst && !iso) {
    return null;
  }
  const year = Number(dayFirst?.[3] || iso?.[1]);
  const month = Number(dayFirst?.[2] || iso?.[2]);
  const day = Number(dayFirst?.[1] || iso?.[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
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
    && (voucher.quantity === undefined
      || (voucher.used || 0) + (voucher.reservedCount || 0) < voucher.quantity);
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

exports.getAllVouchers = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await Voucher.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean());
  } catch (error) {
    console.error('Lỗi tải chương trình khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể tải danh sách khuyến mãi.' });
  }
};

exports.checkVoucher = async (req, res) => {
  try {
    const rawCode = String(req.params.code || req.body?.code || req.query?.code || '').trim();
    if (!rawCode) {
      return res.status(400).json({
        valid: false,
        message: 'Vui lòng cung cấp mã voucher cần kiểm tra.'
      });
    }

    const upperCode = rawCode.toUpperCase();

    // Đối chiếu trực tiếp với database MongoDB
    const voucher = await Voucher.findOne({
      $or: [
        { code: upperCode },
        { id: rawCode },
        ...(mongoose.isValidObjectId(rawCode) ? [{ _id: rawCode }] : [])
      ]
    }).lean();

    if (!voucher) {
      return res.json({
        valid: false,
        code: upperCode,
        reason: 'NOT_FOUND',
        message: 'Tiếc quá, chúng tớ không tìm thấy, cậu hãy nhập lại nữa nhé'
      });
    }

    const code = voucher.code || upperCode;

    if (voucher.isActive === false) {
      return res.json({
        valid: false,
        code,
        reason: 'INACTIVE',
        message: `Mã voucher "${code}" hiện đang bị tạm khóa hoặc chưa được kích hoạt.`,
        voucher
      });
    }

    const now = new Date();
    const startDate = parseVoucherDate(voucher.startDate);
    if (startDate && startDate > now) {
      return res.json({
        valid: false,
        code,
        reason: 'NOT_STARTED',
        message: `Mã voucher "${code}" chưa có hiệu lực (bắt đầu áp dụng từ ngày ${voucher.startDate}).`,
        voucher
      });
    }

    const endDate = parseVoucherDate(voucher.endDate, true);
    if (endDate && now > endDate) {
      return res.json({
        valid: false,
        code,
        reason: 'EXPIRED',
        message: `Mã voucher "${code}" đã hết hạn sử dụng (hạn chót: ${voucher.endDate}).`,
        voucher
      });
    }

    if (voucher.quantity !== undefined && voucher.quantity !== null) {
      const usedCount = (voucher.used || 0) + (voucher.reservedCount || 0);
      if (usedCount >= voucher.quantity) {
        return res.json({
          valid: false,
          code,
          reason: 'OUT_OF_STOCK',
          message: `Mã voucher "${code}" đã hết lượt sử dụng (${usedCount}/${voucher.quantity}).`,
          voucher
        });
      }
    }

    return res.json({
      valid: true,
      code,
      message: `Mã voucher "${code}" hoàn toàn hợp lệ và sẵn sàng sử dụng!`,
      voucher
    });
  } catch (error) {
    console.error('Lỗi kiểm tra voucher:', error);
    return res.status(500).json({
      valid: false,
      message: 'Tiếc quá, chúng tớ không tìm thấy, cậu hãy nhập lại nữa nhé'
    });
  }
};

exports.getVoucherById = async (req, res) => {
  try {
    const voucher = await Voucher.findOne(voucherFilter(req.params.id)).lean();


    if (!voucher) {
      res.status(404).json({ message: 'Không tìm thấy khuyến mãi.' });
      return;
    }
    res.json(voucher);
  } catch (error) {
    console.error('Lỗi tải khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể tải khuyến mãi.' });
  }
};

exports.createVoucher = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
    return;
  }
  try {
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const voucher = await Voucher.create({
      ...req.body,
      id: req.body.id || `promotion-${randomUUID()}`,
      reservedCount: 0,
      code
    });
    res.status(201).json(voucher);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã khuyến mãi đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể tạo khuyến mãi.' });
  }
};

exports.updateVoucher = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
    return;
  }
  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;
  delete updates.reservedCount;
  delete updates.used;
  for (const [operator, fields] of Object.entries(updates)) {
    if (!operator.startsWith('$') || !fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    delete fields.reservedCount;
    delete fields.used;
  }
  if (typeof updates.code === 'string') {
    updates.code = updates.code.trim().toUpperCase();
  }

  try {
    const filter = voucherFilter(req.params.id);
    const currentVoucher = await Voucher.findOne(filter).lean();
    if (!currentVoucher) {
      res.status(404).json({ message: 'Không tìm thấy khuyến mãi.' });
      return;
    }
    if (updates.quantity !== undefined
      && updates.quantity < (currentVoucher.used || 0) + (currentVoucher.reservedCount || 0)) {
      res.status(409).json({ message: 'Số lượng voucher không thể nhỏ hơn số đã dùng và đang được giữ.' });
      return;
    }

    const guardedFilter = updates.quantity === undefined
      ? filter
      : {
          ...filter,
          $expr: {
            $and: [
              { $eq: [{ $ifNull: ['$used', 0] }, currentVoucher.used || 0] },
              { $eq: [{ $ifNull: ['$reservedCount', 0] }, currentVoucher.reservedCount || 0] }
            ]
          }
        };
    const voucher = await Voucher.findOneAndUpdate(guardedFilter, updates, {
      new: true,
      runValidators: true
    });
    if (!voucher) {
      res.status(updates.quantity === undefined ? 404 : 409).json({
        message: updates.quantity === undefined
          ? 'Không tìm thấy khuyến mãi.'
          : 'Quota voucher vừa được thay đổi; vui lòng tải lại và thử lại.'
      });
      return;
    }
    res.json(voucher);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã khuyến mãi đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể cập nhật khuyến mãi.' });
  }
};

exports.deleteVoucher = async (req, res) => {
  try {
    const filter = {
      ...voucherFilter(req.params.id),
      reservedCount: { $in: [null, 0] }
    };
    const voucher = await Voucher.findOneAndDelete(filter);
    if (!voucher) {
      const exists = await Voucher.exists(voucherFilter(req.params.id));
      res.status(exists ? 409 : 404).json({
        message: exists
          ? 'Không thể xóa voucher đang được giữ cho Payment.'
          : 'Không tìm thấy khuyến mãi.'
      });
      return;
    }
    res.json({ message: 'Đã xóa khuyến mãi.' });
  } catch (error) {
    console.error('Lỗi xóa khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể xóa khuyến mãi.' });
  }
};

exports.isVoucherAvailable = isVoucherAvailable;
