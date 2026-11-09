function prepareSavedVouchers(savedVoucherData, users, vouchers) {
  if (!savedVoucherData || !Array.isArray(users) || !Array.isArray(vouchers)) {
    throw new TypeError('Saved voucher data, customers, and vouchers must be provided.');
  }

  const usersById = new Map(
    users.filter((user) => user.role === 'user' && user._id).map((user) => [String(user._id), user])
  );

  const vouchersById = new Map();
  for (const v of vouchers) {
    if (v.id) vouchersById.set(String(v.id), v);
    if (v._id) vouchersById.set(String(v._id), v);
    if (v.code) vouchersById.set(String(v.code).toUpperCase(), v);
  }

  const savedVouchers = [];
  const seenUserVouchers = new Set();

  // TH1: Dữ liệu chuẩn hóa theo users: [{ userId, voucherIds: [...] }]
  if (Array.isArray(savedVoucherData.users)) {
    for (const customer of savedVoucherData.users) {
      const user = usersById.get(String(customer.userId));
      if (!user) {
        throw new Error(`Saved vouchers do not reference an existing customer "${customer.userId}".`);
      }
      if (!Array.isArray(customer.voucherIds)) {
        throw new Error(`Customer "${user._id}" must have a voucherIds array.`);
      }

      for (const voucherId of customer.voucherIds) {
        const voucher = vouchersById.get(String(voucherId));
        if (!voucher) {
          throw new Error(`Saved voucher "${voucherId}" does not exist in vouchers.`);
        }

        const standardVoucherId = String(voucher.id || voucher._id);
        const pairKey = `${String(user._id)}:${standardVoucherId}`;
        if (seenUserVouchers.has(pairKey)) {
          throw new Error(`Customer "${user._id}" has duplicate saved voucher "${standardVoucherId}".`);
        }
        seenUserVouchers.add(pairKey);

        savedVouchers.push({
          id: `saved-${String(user._id)}-${standardVoucherId}`,
          userId: user._id,
          voucherId: standardVoucherId,
          code: voucher.code,
          source: 'promotion',
          claimedAt: new Date(),
          isUsed: false
        });
      }
    }
  } else {
    // TH2: Dữ liệu dạng danh sách records { userId, voucherId, ... }
    const records = Array.isArray(savedVoucherData.savedVouchers)
      ? savedVoucherData.savedVouchers
      : (Array.isArray(savedVoucherData) ? savedVoucherData : []);

    for (const record of records) {
      const user = usersById.get(String(record.userId));
      if (!user) {
        throw new Error(`Saved voucher does not reference an existing customer "${record.userId}".`);
      }
      const voucher = vouchersById.get(String(record.voucherId)) || vouchersById.get(String(record.code || '').toUpperCase());
      if (!voucher) {
        throw new Error(`Saved voucher "${record.voucherId || record.code}" does not exist in vouchers.`);
      }

      const standardVoucherId = String(voucher.id || voucher._id);
      const pairKey = `${String(user._id)}:${standardVoucherId}`;
      if (seenUserVouchers.has(pairKey)) {
        throw new Error(`Customer "${user._id}" has duplicate saved voucher "${standardVoucherId}".`);
      }
      seenUserVouchers.add(pairKey);

      savedVouchers.push({
        id: record.id || `saved-${String(user._id)}-${standardVoucherId}`,
        userId: user._id,
        voucherId: standardVoucherId,
        code: voucher.code,
        source: record.source || 'promotion',
        claimedAt: record.claimedAt ? new Date(record.claimedAt) : new Date(),
        isUsed: Boolean(record.isUsed),
        ...(record.usedAt ? { usedAt: new Date(record.usedAt) } : {})
      });
    }
  }

  return savedVouchers;
}

module.exports = { prepareSavedVouchers };
