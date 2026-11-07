const mongoose = require('mongoose');
const Voucher = require('../models/Voucher');
const UserVoucher = require('../models/UserVoucher');
const User = require('../models/User');
const { isVoucherAvailable } = require('./voucherController');

function isBirthdayVoucher(voucher) {
  return String(voucher?.id || '') === 'voucher-bd50'
    || String(voucher?.code || '').toUpperCase() === 'URIIBD50';
}

// Lấy danh sách voucher mà người dùng CHƯA CÓ
exports.getUnclaimedVouchers = async (req, res) => {
  try {
    const userId = req.auth?.id;

    // Lấy tất cả voucher đang kích hoạt
    const allActiveVouchers = (await Voucher.find({ isActive: true }).lean())
      .filter((voucher) => !isBirthdayVoucher(voucher));

    if (!userId) {
      // Chưa đăng nhập -> hiển thị toàn bộ voucher
      return res.json({
        isLoggedIn: false,
        vouchers: allActiveVouchers
      });
    }

    // Đã đăng nhập -> tìm các voucherId mà user đã nhận
    const claimedList = await UserVoucher.find({ userId }).select('voucherId').lean();
    const claimedVoucherIds = new Set(claimedList.map(item => String(item.voucherId)));

    // Lọc ra các voucher chưa có
    const unclaimedVouchers = allActiveVouchers.filter(v => {
      const vid = String(v.id || v._id);
      return !claimedVoucherIds.has(vid);
    });

    return res.json({
      isLoggedIn: true,
      totalActive: allActiveVouchers.length,
      claimedCount: claimedVoucherIds.size,
      vouchers: unclaimedVouchers
    });
  } catch (error) {
    console.error('Lỗi lấy voucher chưa nhận:', error);
    return res.status(500).json({ message: 'Không thể tải danh sách voucher.' });
  }
};

// Nhận 1 voucher
exports.claimVoucher = async (req, res) => {
  const userId = req.auth?.id;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập để nhận voucher.' });
  }

  const { voucherId } = req.body || {};
  if (!voucherId) {
    return res.status(400).json({ message: 'Thiếu mã voucher.' });
  }

  try {
    const voucher = await Voucher.findOne({
      $or: [
        { id: String(voucherId) },
        { code: String(voucherId).toUpperCase() },
        ...(mongoose.isValidObjectId(voucherId) ? [{ _id: voucherId }] : [])
      ]
    }).lean();

    if (!voucher) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin khuyến mãi.' });
    }
    if (isBirthdayVoucher(voucher)) {
      return res.status(403).json({ message: 'Voucher sinh nhật chỉ được nhận qua biểu mẫu sinh nhật.' });
    }

    const standardVoucherId = String(voucher.id || voucher._id);

    // Kiểm tra đã nhận chưa
    const existing = await UserVoucher.findOne({
      userId,
      voucherId: standardVoucherId
    });

    if (existing) {
      return res.status(409).json({ message: 'Bạn đã sở hữu voucher này trong kho rồi.' });
    }

    // Tạo bản ghi lưu voucher
    const userVoucher = await UserVoucher.create({
      userId,
      voucherId: standardVoucherId,
      code: voucher.code,
      source: 'promotion',
      claimedAt: new Date()
    });

    return res.status(201).json({
      message: `Nhận voucher "${voucher.name || voucher.code}" thành công!`,
      userVoucher
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Bạn đã nhận voucher này rồi.' });
    }
    console.error('Lỗi nhận voucher:', error);
    return res.status(500).json({ message: 'Không thể nhận voucher lúc này.' });
  }
};

// Nhận TẤT CẢ các voucher chưa có
exports.claimAllVouchers = async (req, res) => {
  const userId = req.auth?.id;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập để nhận voucher.' });
  }

  try {
    const allActiveVouchers = (await Voucher.find({ isActive: true }).lean())
      .filter((voucher) => !isBirthdayVoucher(voucher));
    if (!allActiveVouchers.length) {
      return res.status(400).json({ message: 'Hiện tại chưa có voucher nào khả dụng.' });
    }

    const claimedList = await UserVoucher.find({ userId }).select('voucherId').lean();
    const claimedVoucherIds = new Set(claimedList.map(item => String(item.voucherId)));

    const toClaim = allActiveVouchers.filter(v => {
      const vid = String(v.id || v._id);
      return !claimedVoucherIds.has(vid);
    });

    if (toClaim.length === 0) {
      return res.status(400).json({ message: 'Bạn đã nhận tất cả voucher hiện có rồi!' });
    }

    const records = toClaim.map(v => ({
      userId,
      voucherId: String(v.id || v._id),
      code: v.code,
      source: 'promotion',
      claimedAt: new Date()
    }));

    await UserVoucher.insertMany(records, { ordered: false });

    return res.json({
      message: `Chúc mừng bạn đã nhận thành công ${records.length} voucher!`,
      claimedCount: records.length
    });
  } catch (error) {
    console.error('Lỗi nhận tất cả voucher:', error);
    return res.status(500).json({ message: 'Không thể nhận tất cả voucher lúc này.' });
  }
};

// Lấy danh sách voucher người dùng đang sở hữu
exports.getMyVouchers = async (req, res) => {
  const userId = req.auth?.id;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
  }

  try {
    const userVouchers = await UserVoucher.find({ userId }).sort({ claimedAt: -1 }).lean();
    const voucherIds = userVouchers.map(uv => uv.voucherId);

    const voucherDetails = await Voucher.find({
      $or: [
        { id: { $in: voucherIds } },
        { _id: { $in: voucherIds.filter(id => mongoose.isValidObjectId(id)) } }
      ]
    }).lean();

    const voucherMap = new Map();
    voucherDetails.forEach(v => {
      voucherMap.set(String(v.id), v);
      voucherMap.set(String(v._id), v);
    });

    const results = userVouchers.map(uv => ({
      ...uv,
      voucher: voucherMap.get(String(uv.voucherId)) || null
    }));

    return res.json(results);
  } catch (error) {
    console.error('Lỗi lấy voucher cá nhân:', error);
    return res.status(500).json({ message: 'Không thể tải voucher của bạn.' });
  }
};

exports.getMyAvailableVouchers = async (req, res) => {
  const userId = req.auth?.id;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
  }

  try {
    const user = await User.findById(userId).select('birth').lean();
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản người dùng.' });
    }

    const userVouchers = await UserVoucher.find({ userId, isUsed: false })
      .sort({ claimedAt: -1 })
      .lean();
    const voucherIds = userVouchers.map((userVoucher) => userVoucher.voucherId);
    if (voucherIds.length === 0) return res.json([]);

    const voucherDetails = await Voucher.find({
      $or: [
        { id: { $in: voucherIds } },
        { _id: { $in: voucherIds.filter((id) => mongoose.isValidObjectId(id)) } },
      ],
    }).lean();
    const voucherMap = new Map();
    for (const voucher of voucherDetails) {
      voucherMap.set(String(voucher.id), voucher);
      voucherMap.set(String(voucher._id), voucher);
    }

    return res.json(userVouchers.flatMap((userVoucher) => {
      const voucher = voucherMap.get(String(userVoucher.voucherId));
      if (!voucher || !isVoucherAvailable(voucher)) return [];
      if (isBirthdayVoucher(voucher)
        && (!user.birth || (userVoucher.source && userVoucher.source !== 'birthday'))) {
        return [];
      }
      return [{ ...userVoucher, voucher }];
    }));
  } catch (error) {
    console.error('Lỗi tải voucher khả dụng của tài khoản:', error);
    return res.status(500).json({ message: 'Không thể tải voucher khả dụng của bạn.' });
  }
};

// Nhận voucher sinh nhật 50% kèm cập nhật ngày sinh (chỉ cho phép nhập 1 lần)
exports.claimBirthdayVoucher = async (req, res) => {
  const userId = req.auth?.id;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập để nhận voucher sinh nhật.' });
  }

  const { name, birth, phone } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Vui lòng nhập họ và tên.' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản người dùng.' });
    }

    user.name = name.trim();
    if (phone && typeof phone === 'string') {
      user.phone = phone.trim();
    }

    // Quy tắc: Mỗi tài khoản chỉ được nhập ngày sinh 1 lần duy nhất
    if (!user.birth && birth && typeof birth === 'string' && birth.trim()) {
      user.birth = birth.trim();
    }

    await user.save();

    // Only the dedicated birthday voucher can be issued by this form.
    let voucher = await Voucher.findOne({
      $or: [
        { code: 'URIIBD50' },
        { id: 'voucher-bd50' }
      ]
    });

    if (!voucher) {
      voucher = await Voucher.create({
        id: 'voucher-bd50',
        code: 'URIIBD50',
        name: 'Giảm 50% Tháng Sinh Nhật',
        description: 'Ưu đãi sinh nhật giảm 50% tối đa 100.000đ cho đơn hàng từ 150.000đ',
        type: 'percent',
        discountValue: 50,
        minOrder: 150000,
        maxDiscount: 100000,
        startDate: '01/01/2026',
        endDate: '31/12/2026',
        quantity: 10000,
        used: 0,
        isActive: true
      });
    }

    const standardVoucherId = String(voucher.id || voucher._id);

    const existing = await UserVoucher.findOne({
      userId,
      $or: [
        { voucherId: standardVoucherId },
        { code: voucher.code }
      ]
    });
    if (existing) {
      return res.status(400).json({
        message: 'Bạn đã nhận voucher sinh nhật này rồi. Mỗi tài khoản chỉ được nhận 1 lần duy nhất.'
      });
    }

    await UserVoucher.create({
      userId,
      voucherId: standardVoucherId,
      code: voucher.code,
      source: 'birthday',
      claimedAt: new Date()
    });

    return res.json({
      success: true,
      message: 'Nhận voucher thành công',
      user: {
        name: user.name,
        birth: user.birth,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Lỗi nhận voucher sinh nhật:', error);
    return res.status(500).json({ message: 'Không thể nhận voucher sinh nhật lúc này.' });
  }
};
