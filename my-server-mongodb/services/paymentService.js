const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const { getProductPrice } = require('../utils/commerceFixtures');
const { isVoucherAvailable } = require('../controllers/voucherController');

const FREE_SHIPPING_THRESHOLD = 200000;
const STANDARD_SHIPPING_FEE = 30000;
const BIRTHDAY_VOUCHER_ID = 'voucher-bd50';
const BIRTHDAY_VOUCHER_CODE = 'URIIBD50';
const PAYMENT_CODE_EXACT_REGEX = /^URII[0-9A-F]{16}$/;
const PAYMENT_CODE_CANDIDATE_REGEX = /(?<![A-Z0-9])(URII[A-Z0-9]*)(?![A-Z0-9])/gi;
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

class PaymentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

class PaymentConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentConfigurationError';
  }
}

class PaymentWebhookAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentWebhookAuthError';
  }
}

class PaymentWebhookPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentWebhookPayloadError';
  }
}

function paymentCode() {
  return `URII${randomBytes(8).toString('hex').toUpperCase()}`;
}

function safeCompareStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getHeader(req, headerName) {
  const lower = headerName.toLowerCase();
  if (req?.headers && typeof req.headers === 'object') {
    const direct = req.headers[lower] ?? req.headers[headerName];
    if (typeof direct === 'string') return direct.trim();
  }
  if (typeof req?.get === 'function') {
    const val = req.get(headerName);
    if (typeof val === 'string') return val.trim();
  }
  return '';
}

function sepayWebhookConfiguration(env = process.env) {
  const apiKey = env.SEPAY_WEBHOOK_API_KEY?.trim() || '';
  const hmacSecret = env.SEPAY_WEBHOOK_SECRET?.trim() || '';
  const rawTolerance = env.SEPAY_WEBHOOK_TOLERANCE_SECONDS?.trim();

  if (!apiKey && !hmacSecret) {
    return null;
  }

  let toleranceSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (rawTolerance !== undefined && rawTolerance !== '') {
    const parsed = Number(rawTolerance);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 86400) {
      throw new PaymentConfigurationError('Cấu hình SEPAY_WEBHOOK_TOLERANCE_SECONDS không hợp lệ.');
    }
    toleranceSeconds = parsed;
  }

  return {
    apiKey: apiKey || null,
    hmacSecret: hmacSecret || null,
    toleranceSeconds
  };
}

function verifySepayWebhookRequest(req, env = process.env, now = new Date()) {
  const config = sepayWebhookConfiguration(env);
  if (!config) {
    throw new PaymentConfigurationError('Máy chủ chưa cấu hình xác thực SePay webhook.');
  }

  const authHeader = getHeader(req, 'authorization');
  const signatureHeader = getHeader(req, 'x-sepay-signature');
  const timestampHeader = getHeader(req, 'x-sepay-timestamp');

  if (config.apiKey && !authHeader) {
    throw new PaymentWebhookAuthError('Thiếu header xác thực Authorization cho SePay webhook.');
  }
  if (config.hmacSecret && !signatureHeader) {
    throw new PaymentWebhookAuthError('Thiếu header chữ ký X-SePay-Signature cho SePay webhook.');
  }

  if (config.apiKey || authHeader) {
    const match = /^Apikey\s+([^\s]+)$/i.exec(authHeader);
    if (!match) {
      throw new PaymentWebhookAuthError('Header Authorization không hợp lệ. Yêu cầu định dạng: Apikey <API_KEY>.');
    }
    const providedApiKey = match[1].trim();
    const expectedApiKey = config.apiKey || config.hmacSecret;
    if (!safeCompareStrings(providedApiKey, expectedApiKey)) {
      throw new PaymentWebhookAuthError('API Key xác thực SePay webhook không hợp lệ.');
    }
  }

  if (config.hmacSecret || signatureHeader) {
    const secret = config.hmacSecret || config.apiKey;
    const rawBody = Buffer.isBuffer(req?.rawBody)
      ? req.rawBody
      : (typeof req?.rawBody === 'string' ? Buffer.from(req.rawBody, 'utf8') : null);
    if (!rawBody || rawBody.length === 0) {
      throw new PaymentWebhookAuthError('Không có dữ liệu raw body để xác thực chữ ký webhook.');
    }

    const sigMatch = /^(?:sha256=)?([a-fA-F0-9]{64})$/.exec(signatureHeader);
    if (!sigMatch) {
      throw new PaymentWebhookAuthError('Chữ ký X-SePay-Signature không đúng định dạng.');
    }
    const providedSignatureHex = sigMatch[1].toLowerCase();

    let expectedSignatureHex;
    if (timestampHeader) {
      if (!/^\d{9,15}$/.test(timestampHeader)) {
        throw new PaymentWebhookAuthError('Header X-SePay-Timestamp không hợp lệ.');
      }
      const rawTs = Number(timestampHeader);
      const timestampSeconds = rawTs >= 1e12 ? Math.floor(rawTs / 1000) : rawTs;
      const nowSeconds = Math.floor(now.getTime() / 1000);
      if (Math.abs(nowSeconds - timestampSeconds) > config.toleranceSeconds) {
        throw new PaymentWebhookAuthError('Timestamp của chữ ký webhook đã quá hạn hoặc không hợp lệ.');
      }
      const signingInput = `${timestampHeader}.${rawBody.toString('utf8')}`;
      expectedSignatureHex = createHmac('sha256', secret)
        .update(signingInput, 'utf8')
        .digest('hex')
        .toLowerCase();
    } else {
      expectedSignatureHex = createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex')
        .toLowerCase();
    }

    if (!safeCompareStrings(providedSignatureHex, expectedSignatureHex)) {
      throw new PaymentWebhookAuthError('Chữ ký X-SePay-Signature không hợp lệ.');
    }
  }

  return true;
}

function parseTransactionDate(rawDate, now = new Date()) {
  if (rawDate === undefined || rawDate === null || rawDate === '') {
    return now;
  }
  if (typeof rawDate !== 'string') {
    throw new PaymentWebhookPayloadError('Thời gian giao dịch (transactionDate) không hợp lệ.');
  }
  const trimmed = rawDate.trim();
  if (!trimmed) {
    return now;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+07:00`
    : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new PaymentWebhookPayloadError('Thời gian giao dịch (transactionDate) không hợp lệ.');
  }
  return parsed;
}

function parseSepayWebhookPayload(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PaymentWebhookPayloadError('Payload webhook phải là đối tượng JSON hợp lệ.');
  }

  const isTestWebhook = typeof body.code === 'string'
    && body.code.trim().toUpperCase() === 'SEPAYTEST';
  const rawId = body.id;
  const isValidNumericId = Number.isSafeInteger(rawId)
    && (isTestWebhook ? rawId >= 0 : rawId > 0);
  const isValidStringId = typeof rawId === 'string'
    && rawId.trim().length > 0
    && rawId.trim().length <= 128
    && (isTestWebhook || rawId.trim() !== '0');
  if (!isValidNumericId && !isValidStringId) {
    throw new PaymentWebhookPayloadError('Mã giao dịch SePay (id) không hợp lệ.');
  }
  const sepayTransactionId = String(rawId).trim();

  if (body.transferType !== 'in' && body.transferType !== 'out') {
    throw new PaymentWebhookPayloadError('Loại giao dịch (transferType) phải là "in" hoặc "out".');
  }

  if (!Number.isSafeInteger(body.transferAmount) || body.transferAmount < 1) {
    throw new PaymentWebhookPayloadError('Số tiền giao dịch (transferAmount) phải là số nguyên dương.');
  }

  const optionalStringFields = [
    'code',
    'content',
    'description',
    'referenceCode',
    'gateway',
    'accountNumber',
    'subAccount'
  ];
  for (const field of optionalStringFields) {
    const val = body[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'string' || val.length > 2000) {
        throw new PaymentWebhookPayloadError(`Trường "${field}" trong payload không hợp lệ.`);
      }
    }
  }

  if (body.transferType === 'in'
    && body.code === undefined
    && body.content === undefined
    && body.description === undefined) {
    throw new PaymentWebhookPayloadError('Payload thiếu thông tin nội dung hoặc mã thanh toán.');
  }

  const transactionAt = parseTransactionDate(body.transactionDate, now);
  const bankReference = typeof body.referenceCode === 'string' && body.referenceCode.trim()
    ? body.referenceCode.trim()
    : null;

  return {
    sepayTransactionId,
    isTestWebhook,
    transferType: body.transferType,
    transferAmount: body.transferAmount,
    code: typeof body.code === 'string' ? body.code : null,
    content: typeof body.content === 'string' ? body.content : null,
    description: typeof body.description === 'string' ? body.description : null,
    gateway: typeof body.gateway === 'string' ? body.gateway.trim() : null,
    accountNumber: typeof body.accountNumber === 'string' ? body.accountNumber.trim() : null,
    subAccount: typeof body.subAccount === 'string' ? body.subAccount.trim() : null,
    bankReference,
    transactionAt
  };
}

function findCandidateTokens(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }
  const upper = text.toUpperCase();
  const tokens = [];
  for (const match of upper.matchAll(PAYMENT_CODE_CANDIDATE_REGEX)) {
    tokens.push(match[1]);
  }
  return [...new Set(tokens)];
}

function extractPaymentCode(payload = {}) {
  const rawCode = typeof payload.code === 'string' && payload.code.trim()
    ? payload.code.trim().toUpperCase()
    : null;

  const contentTokens = findCandidateTokens(payload.content);
  const descriptionTokens = contentTokens.length === 0
    ? findCandidateTokens(payload.description)
    : [];
  const textTokens = contentTokens.length > 0 ? contentTokens : descriptionTokens;

  if (textTokens.length > 1) {
    return {
      paymentCode: null,
      paymentCodeObserved: textTokens[0].slice(0, 64),
      reason: 'ambiguous_payment_code'
    };
  }

  if (rawCode && !PAYMENT_CODE_EXACT_REGEX.test(rawCode)) {
    return {
      paymentCode: null,
      paymentCodeObserved: rawCode.slice(0, 64),
      reason: 'invalid_payment_code'
    };
  }

  if (textTokens.length === 1) {
    const token = textTokens[0];
    if (!PAYMENT_CODE_EXACT_REGEX.test(token)) {
      return {
        paymentCode: null,
        paymentCodeObserved: token.slice(0, 64),
        reason: 'invalid_payment_code'
      };
    }
    if (rawCode && rawCode !== token) {
      return {
        paymentCode: null,
        paymentCodeObserved: rawCode.slice(0, 64),
        reason: 'ambiguous_payment_code'
      };
    }
    return {
      paymentCode: token,
      paymentCodeObserved: token,
      reason: null
    };
  }

  if (rawCode && PAYMENT_CODE_EXACT_REGEX.test(rawCode)) {
    return {
      paymentCode: rawCode,
      paymentCodeObserved: rawCode,
      reason: null
    };
  }

  return {
    paymentCode: null,
    paymentCodeObserved: null,
    reason: 'missing_payment_code'
  };
}

function paymentQrConfiguration(env = process.env) {
  const bankCode = env.PAYMENT_QR_BANK_CODE?.trim();
  const accountNumber = env.PAYMENT_QR_ACCOUNT_NUMBER?.trim();
  const accountName = env.PAYMENT_QR_ACCOUNT_NAME?.trim();
  const template = env.PAYMENT_QR_TEMPLATE?.trim();

  if (!bankCode || !accountNumber || !accountName || !template) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(bankCode)
    || !/^\d{6,20}$/.test(accountNumber)
    || !/^[A-Za-z0-9_-]+$/.test(template)) {
    throw new PaymentConfigurationError('Cấu hình tài khoản nhận thanh toán QR không hợp lệ.');
  }

  return { bankCode, accountNumber, accountName, template };
}

function createQrUrl(payment, config) {
  const imagePath = [
    config.bankCode,
    config.accountNumber,
    config.template
  ].map(encodeURIComponent).join('-');
  const url = new URL(`https://img.vietqr.io/image/${imagePath}.png`);
  url.searchParams.set('amount', String(payment.amountDue));
  url.searchParams.set('addInfo', payment.paymentCode);
  url.searchParams.set('accountName', config.accountName);
  return url.toString();
}

function assertBankTransferOrder(order) {
  const method = order.payment?.methodId || order.payment?.method;
  if (method !== 'bank_transfer' && method !== 'Chuyển khoản ngân hàng') {
    throw new PaymentValidationError('Đơn hàng không sử dụng phương thức chuyển khoản ngân hàng.');
  }
  if ((order.orderType || 'normal') !== 'normal') {
    throw new PaymentValidationError('Thanh toán QR hiện chỉ hỗ trợ đơn hàng sản phẩm thông thường.');
  }
  if (['cancelled', 'cancel_requested'].includes(order.statusId)) {
    throw new PaymentValidationError('Đơn hàng đã bị hủy, không thể tạo mã thanh toán.');
  }
  if (order.payment?.statusId === 'paid') {
    throw new PaymentValidationError('Đơn hàng đã được thanh toán.');
  }
}

function resolveVariantIndex(item, product) {
  if (item.variantIndex !== undefined && item.variantIndex !== null) {
    return item.variantIndex;
  }
  if (item.variantName) {
    const index = product.variants?.findIndex((variant) => variant.name === item.variantName);
    if (index >= 0) return index;
  }
  if (Array.isArray(product.variants) && product.variants.length > 1) {
    throw new PaymentValidationError(
      `Không xác định được phân loại của sản phẩm "${product.name}". Vui lòng đặt lại đơn hàng.`
    );
  }
  return null;
}

async function findOwnedVoucher(voucherId, userId, session) {
  const ownershipQuery = UserVoucher.findOne({
    userId,
    voucherId: String(voucherId),
    isUsed: false,
    reservedByPaymentId: null
  });
  const ownership = await ownershipQuery.session(session).lean();
  if (!ownership) {
    throw new PaymentValidationError('Voucher không còn khả dụng cho tài khoản này.');
  }

  const voucherFilter = [{ id: String(voucherId) }];
  if (mongoose.isValidObjectId(voucherId)) {
    voucherFilter.push({ _id: voucherId });
  }
  const voucherQuery = Voucher.findOne({ $or: voucherFilter });
  const voucher = await voucherQuery.session(session).lean();
  if (!voucher || !isVoucherAvailable(voucher)) {
    throw new PaymentValidationError('Voucher đã hết hạn hoặc không còn khả dụng.');
  }

  const isBirthdayVoucher = voucher.id === BIRTHDAY_VOUCHER_ID
    || String(voucher.code || '').toUpperCase() === BIRTHDAY_VOUCHER_CODE;
  if (isBirthdayVoucher) {
    const userQuery = User.findById(userId).select('birth');
    const user = await userQuery.session(session).lean();
    if (!user?.birth || ownership.source !== 'birthday') {
      throw new PaymentValidationError('Voucher sinh nhật không hợp lệ cho tài khoản này.');
    }
  }

  return { voucher, ownership };
}

async function calculateOrderQuote(order, userId, session, now = new Date()) {
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new PaymentValidationError('Đơn hàng không có sản phẩm hợp lệ để thanh toán.');
  }

  const productIds = [...new Set(order.items.map((item) => item.productId))];
  if (productIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new PaymentValidationError('Sản phẩm trong đơn hàng không hợp lệ.');
  }

  const productsQuery = Product.find({ id: { $in: productIds } });
  const products = await productsQuery.session(session).lean();
  const productsById = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  const items = order.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) {
      throw new PaymentValidationError(`Sản phẩm "${item.productId}" không còn khả dụng.`);
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new PaymentValidationError(`Số lượng sản phẩm "${product.name}" không hợp lệ.`);
    }

    const variantIndex = resolveVariantIndex(item, product);
    let pricing;
    try {
      pricing = getProductPrice(product, variantIndex);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        throw new PaymentValidationError(error.message);
      }
      throw error;
    }
    if (item.quantity > pricing.stock) {
      throw new PaymentValidationError(`Sản phẩm "${product.name}" không đủ tồn kho.`);
    }

    subtotal += pricing.price * item.quantity;
    return {
      productId: product.id,
      name: product.name,
      price: pricing.price,
      unitPrice: pricing.price,
      quantity: item.quantity,
      image: pricing.image || '',
      variantIndex: pricing.variantIndex,
      variantName: pricing.variantName || undefined
    };
  });

  if (!Number.isSafeInteger(subtotal)) {
    throw new PaymentValidationError('Tổng tiền sản phẩm không hợp lệ.');
  }

  const shippingFee = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD
    ? 0
    : STANDARD_SHIPPING_FEE;
  let discountAmount = 0;
  let voucherReservation = null;
  if (order.voucher && !order.voucher.voucherId
    && Number.isFinite(order.voucher.discountAmount)) {
    throw new PaymentValidationError('Thông tin voucher trong đơn hàng không hợp lệ.');
  }
  if (order.voucher?.voucherId) {
    const { voucher, ownership } = await findOwnedVoucher(order.voucher.voucherId, userId, session);
    voucherReservation = {
      voucherId: voucher.id,
      userVoucherId: ownership._id
    };
    if (subtotal < (voucher.minOrder || 0)) {
      throw new PaymentValidationError('Đơn hàng chưa đạt giá trị tối thiểu để áp dụng voucher.');
    }
    if (voucher.type === 'shipping') {
      if (shippingFee === 0) {
        throw new PaymentValidationError('Đơn hàng đã được miễn phí vận chuyển.');
      }
      discountAmount = shippingFee;
    } else if (voucher.type === 'percent') {
      const percentDiscount = subtotal * voucher.discountValue / 100;
      discountAmount = Math.min(
        subtotal,
        voucher.maxDiscount === undefined ? percentDiscount : Math.min(percentDiscount, voucher.maxDiscount)
      );
    } else if (voucher.type === 'fixed') {
      discountAmount = Math.min(subtotal, voucher.discountValue);
    } else {
      throw new PaymentValidationError('Loại voucher không được hỗ trợ.');
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      throw new PaymentValidationError('Giá trị giảm giá của voucher không hợp lệ.');
    }
  }

  const amountDue = Math.round(Math.max(0, subtotal + shippingFee - discountAmount));
  if (!Number.isSafeInteger(amountDue) || amountDue < 1) {
    throw new PaymentValidationError('Tổng tiền thanh toán phải lớn hơn 0.');
  }

  return {
    items,
    subtotal,
    shippingFee,
    discountAmount: Math.round(discountAmount),
    voucherReservation,
    amountDue,
    now
  };
}

module.exports = {
  PaymentValidationError,
  PaymentConfigurationError,
  PaymentWebhookAuthError,
  PaymentWebhookPayloadError,
  assertBankTransferOrder,
  calculateOrderQuote,
  createQrUrl,
  extractPaymentCode,
  parseSepayWebhookPayload,
  paymentCode,
  paymentQrConfiguration,
  sepayWebhookConfiguration,
  verifySepayWebhookRequest
};
