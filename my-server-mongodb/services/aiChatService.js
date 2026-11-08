const fs = require('fs');
const path = require('path');

// Nạp dữ liệu sản phẩm và gallery để tra cứu thông minh
let galleryData = [];
let productsData = [];

try {
  const galleryPath = path.join(__dirname, '..', 'data', 'gallery.json');
  if (fs.existsSync(galleryPath)) {
    galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf8'));
  }
} catch (err) {
  console.warn('Không thể nạp gallery.json cho AI Chat:', err.message);
}

try {
  const prodPath = path.join(__dirname, '..', 'data', 'products.json');
  if (fs.existsSync(prodPath)) {
    const raw = JSON.parse(fs.readFileSync(prodPath, 'utf8'));
    productsData = Array.isArray(raw) ? raw : (raw.products || []);
  }
} catch (err) {
  console.warn('Không thể nạp products.json cho AI Chat:', err.message);
}

const SYSTEM_PROMPT = `
Bạn là "Trợ lý ảo thông minh Urii" của thương hiệu thủ công Urii (hạt cườm, hạt ủi Perler beads, bộ kit DIY, map mẫu miễn phí và nhận làm theo yêu cầu).

QUY TẮC CỐT LÕI (BẮT BUỘC TUÂN THỦ):
1. ĐÚNG TRỌNG TÂM, NGẮN GỌN & THÔNG MINH:
   - Trả lời thẳng vào câu hỏi của khách hàng trong 1-3 câu ngắn gọn, rõ ràng, thân thiện.
   - TUYỆT ĐỐI KHÔNG trả lời dài dòng lan man, KHÔNG lặp lại các đoạn văn giới thiệu rập khuôn.
   - TUYỆT ĐỐI KHÔNG chèn đoạn văn kiểu "Nếu bạn cần hỗ trợ thêm, hãy bấm nút Chat với Admin..." vào nội dung tin nhắn vì nút Chat với Admin đã nằm sẵn trong phần gợi ý nhanh (chips) bên dưới.

2. ĐƯỜNG DẪN ĐIỀU HƯỚNG CHÍNH XÁC (EXACT ROUTES):
   - Đặt làm theo yêu cầu (Custom Order): /custom-order
   - Chi tiết sản phẩm cụ thể: /product-detail/:slug (ví dụ: /product-detail/moc-khoa-hat-nhua-ui-we-bare-bears)
   - Chi tiết map mẫu cụ thể: /sample-maps-detail?id=:map_id (ví dụ: /sample-maps-detail?id=M26)
   - Danh mục hạt cườm & bảng màu: /products?category=BEADS
   - Bộ Kit DIY: /products?category=KIT
   - Bộ sưu tập: /products?category=BST
   - Dụng cụ chuyên dụng: /products?category=TOOLS
   - Thư viện map mẫu: /sample-maps
   - Giỏ hàng: /cart
   - Thanh toán: /checkout
   - Đơn hàng của tôi: /orders
   - Tiêu chuẩn cộng đồng: /support/community-standards

3. KIẾN THỨC SẢN PHẨM CỐT LÕI:
   - Số lượng màu của hạt ủi: Urii có hơn 72 mã màu phong phú (tone cơ bản, pastel, dạ quang, nhũ). Các bộ Kit DIY có set 24 màu, 48 màu và 72 màu. Hạt lẻ bổ sung theo gói 10g (~1000 hạt) có từ Bảng A đến Bảng H.
   - Kích thước hạt: Có 2 size chính là Mini 2.6mm (chi tiết nhỏ, sắc nét) và Midi 5mm (tiêu chuẩn, dễ cầm gắp).
   - Đặt làm theo yêu cầu (/custom-order): Nhận làm móc khóa theo mọi nhân vật hoạt hình/ảnh mẫu, không bắt buộc phải có ảnh.

Định dạng JSON trả về:
{
  "reply": "Nội dung câu trả lời ngắn gọn, súc tích",
  "targetUrl": "/duong-dan-chinh-xac",
  "targetLabel": "Tên nút chuyển trang",
  "chips": [
    { "label": "Gợi ý 1", "action": "..." },
    { "label": "Gợi ý 2", "action": "..." },
    { "label": "Chat với Admin", "action": "Chat với Admin" }
  ]
}
`;

/**
 * Loại bỏ dấu tiếng Việt để so khớp
 */
function removeVietnameseTones(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Chuẩn hóa văn bản
 */
function normalizeText(text) {
  return removeVietnameseTones(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kiểm tra vi phạm Tiêu chuẩn cộng đồng
 */
function checkCommunityStandardsViolation(rawText) {
  if (!rawText) return null;
  const rawLower = String(rawText).toLowerCase();
  const norm = normalizeText(rawText);
  if (!norm) return null;

  const accentedBadWords = [
    'đm', 'đcm', 'đmm', 'địt', 'đụ', 'đệt', 'cặc', 'lồn', 'buồi', 'chó chết',
    'súc vật', 'óc chó', 'mất dạy', 'ngu lồn', 'lừa đảo', 'khốn nạn', 'hãm lồn',
    'đụ má', 'đụ mẹ', 'thằng chó', 'con chó', 'đồ chó'
  ];

  for (const bad of accentedBadWords) {
    if (rawLower.includes(bad)) return buildViolationResponse();
  }

  const unaccentedBadPatterns = [
    'dm', 'dcm', 'clm', 'vcl', 'vl', 'vkl', 'dmm', 'dcmm', 'dkm',
    'con cac', 'an cac', 'cai cac', 'nhu cac',
    'cai lon', 'con lon', 'ngu lon', 'ham lon', 'mat lon', 'lon me', 'buon lon',
    'dau buoi', 'an buoi', 'nhu buoi',
    'me may', 'con me may', 'thang cho', 'con cho', 'do cho', 'cho chet',
    'suc vat', 'oc cho', 'mat day', 'ngu lol',
    'du ma', 'dit me', 'djt me', 'djt',
    'fuck', 'shit', 'bitch', 'asshole', 'motherfucker'
  ];

  const words = norm.split(' ');
  const wordSet = new Set(words);

  for (const bad of unaccentedBadPatterns) {
    if (bad.includes(' ')) {
      if (norm.includes(bad)) return buildViolationResponse();
    } else {
      if (wordSet.has(bad)) return buildViolationResponse();
    }
  }

  return null;
}

function buildViolationResponse() {
  return {
    reply: '⚠️ CẢNH BÁO TIÊU CHUẨN CỘNG ĐỒNG ⚠️\n\nHệ thống phát hiện tin nhắn của bạn có chứa từ ngữ vi phạm Tiêu chuẩn ứng xử của Urii. Vui lòng giữ thái độ lịch sự, tôn trọng để cuộc trò chuyện diễn ra hiệu quả và tránh bị hạn chế tài khoản bạn nhé!',
    targetUrl: '/support/community-standards',
    targetLabel: 'Xem Tiêu chuẩn cộng đồng',
    chips: [
      { label: 'Xem Tiêu chuẩn cộng đồng', action: '/support/community-standards' },
      { label: 'Chat với Admin', action: 'Chat với Admin' }
    ],
    isWarning: true
  };
}

/**
 * Tra cứu thông minh kho Gallery / Map mẫu
 */
function searchGallery(query) {
  if (!galleryData || galleryData.length === 0) return [];
  const normQuery = normalizeText(query);

  // Thêm stop words hạt, ủi, số lượng để tránh nhầm sang M49 (Sóc ăn hạt)
  const stopWords = new Set([
    'co', 'khong', 'ko', 'map', 'mau', 'hinh', 'chart', 'cho', 'minh', 'xem',
    'tim', 'hoi', 've', 'shop', 'ban', 'la', 'nhung', 'nao', 'o', 'dau', 'can',
    'muon', 'cai', 'gi', 'nay', 'do', 'dang', 'voi', 'duoc', 'di',
    'hat', 'ui', 'cuom', 'perler', 'beads', 'bead', 'nhua', 'so', 'luong', 'cua', 't', 'toi'
  ]);
  const tokens = normQuery.split(' ').filter(w => !stopWords.has(w) && w.length > 1);
  if (tokens.length === 0) return [];

  const fullKey = tokens.join(' ');
  const results = [];

  for (const item of galleryData) {
    const normName = normalizeText(item.map_name || '');
    const normDesc = normalizeText(item.description || '');
    const normCats = (item.categories || []).map(c => normalizeText(c)).join(' ');

    let score = 0;
    if (normName.includes(fullKey)) score += 25;
    else if (normDesc.includes(fullKey) || normCats.includes(fullKey)) score += 10;

    for (const token of tokens) {
      if (normName.includes(token)) score += 5;
      else if (normDesc.includes(token) || normCats.includes(token)) score += 2;
    }

    if ((fullKey.includes('doremon') || tokens.includes('doremon')) && normName.includes('doraemon')) score += 20;
    if ((fullKey.includes('kitty') || tokens.includes('kitty')) && normName.includes('kitty')) score += 20;

    if (score >= 5) {
      results.push({ item, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map(r => r.item);
}

/**
 * Tra cứu thông minh kho Sản phẩm
 */
function searchProducts(query) {
  if (!productsData || productsData.length === 0) return [];
  const normQuery = normalizeText(query);

  const stopWords = new Set([
    'co', 'khong', 'ko', 'cho', 'minh', 'xem', 'tim', 'hoi', 've', 'shop',
    'ban', 'la', 'nhung', 'nao', 'o', 'dau', 'can', 'muon', 'cai', 'gi', 'mua',
    'nay', 'do', 'dang', 'voi', 'duoc', 'di', 'san', 'pham', 'sp', 't', 'toi'
  ]);
  const tokens = normQuery.split(' ').filter(w => !stopWords.has(w) && w.length > 1);
  if (tokens.length === 0) return [];

  const fullKey = tokens.join(' ');
  const results = [];

  for (const item of productsData) {
    const normName = normalizeText(item.name || '');
    const normDesc = normalizeText(item.description || '');
    const normCat = normalizeText(item.category || '');

    let score = 0;
    if (normName.includes(fullKey)) score += 25;
    else if (normDesc.includes(fullKey) || normCat.includes(fullKey)) score += 10;

    for (const token of tokens) {
      if (normName.includes(token)) score += 4;
      else if (normDesc.includes(token) || normCat.includes(token)) score += 1;
    }

    if (score >= 6) {
      results.push({ item, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map(r => r.item);
}

/**
 * Fallback AI trả lời súc tích, thông minh, đúng trọng tâm và đúng đường dẫn
 */
function getFallbackReply(userMessage, context = {}) {
  // 1. Bộ lọc Tiêu chuẩn cộng đồng
  const violation = checkCommunityStandardsViolation(userMessage);
  if (violation) return violation;

  const rawLower = String(userMessage || '').toLowerCase();
  const norm = normalizeText(userMessage);
  const words = new Set(norm.split(' '));
  const currentUrl = String(context.currentUrl || '');

  // 2. Nhận diện tìm kiếm theo MÀU SẮC CỤ THỂ (Color Filter Search)
  const colorKeywords = [
    { key: 'hong', label: 'hồng', regex: /(?:^|\s)(hồng|mau hong|hong)(?:\s|$|[.,!?])/i },
    { key: 'do', label: 'đỏ', regex: /(?:^|\s)(đỏ|mau do|do)(?:\s|$|[.,!?])/i },
    { key: 'xanh', label: 'xanh', regex: /(?:^|\s)(xanh|mau xanh)(?:\s|$|[.,!?])/i },
    { key: 'vang', label: 'vàng', regex: /(?:^|\s)(vàng|mau vang|vang)(?:\s|$|[.,!?])/i },
    { key: 'tim', label: 'tím', regex: /(?:^|\s)(tím|mau tim|tim)(?:\s|$|[.,!?])/i },
    { key: 'cam', label: 'cam', regex: /(?:^|\s)(cam|mau cam)(?:\s|$|[.,!?])/i },
    { key: 'den', label: 'đen', regex: /(?:^|\s)(đen|mau den|den)(?:\s|$|[.,!?])/i },
    { key: 'trang', label: 'trắng', regex: /(?:^|\s)(trắng|mau trang|trang)(?:\s|$|[.,!?])/i },
    { key: 'pastel', label: 'pastel', regex: /(?:^|\s)(pastel|mau pastel)(?:\s|$|[.,!?])/i }
  ];

  let detectedColor = null;
  for (const c of colorKeywords) {
    if (c.regex.test(userMessage) || c.regex.test(norm)) {
      detectedColor = c;
      break;
    }
  }

  // 3. Phân biệt:
  // - Hỏi BẢNG MÃ MÀU / SỐ LƯỢNG MÀU của hạt ủi (Color Catalog)
  // - Hỏi TÌM KIẾM SẢN PHẨM / MAP MẪU CÓ MÀU CỤ THỂ (Color Filter)
  const isColorCatalogInquiry = !detectedColor && (
    norm.includes('so luong mau') || norm.includes('bang mau') || 
    norm.includes('bao nhieu mau') || norm.includes('ma mau') || 
    norm.includes('may mau') || norm.includes('co bao nhieu mau') ||
    (words.has('mau') && (norm.includes('tong cong') || norm.includes('tat ca')))
  );

  const isColorFilterSearch = Boolean(detectedColor) && (
    norm.includes('san pham') || norm.includes('map') || norm.includes('mau') || 
    norm.includes('moc khoa') || norm.includes('co mau') || words.has('co') || words.has('tim')
  );

  const isColorInquiry = Boolean(detectedColor) || isColorCatalogInquiry;

  // 3. Nhận diện câu hỏi về KÍCH THƯỚC (Size Inquiry)
  const isSizeInquiry = norm.includes('size') || norm.includes('kich thuoc') || 
                        norm.includes('kich co') || norm.includes('may mm') || 
                        norm.includes('2 6mm') || norm.includes('5mm') || norm.includes('co hat');

  // 4. Nhận diện Đặt làm theo yêu cầu (Custom Order)
  const isCustom = norm.includes('dat lam') || norm.includes('theo yeu cau') || 
                   norm.includes('nhan lam') || norm.includes('lam theo') || 
                   norm.includes('custom') || norm.includes('thiet ke rieng') || 
                   norm.includes('in theo anh') || norm.includes('lam theo anh') ||
                   norm.includes('nhan lam mau') || norm.includes('lam moc khoa') ||
                   norm.includes('lam theo yeu cau') || norm.includes('dat mau') ||
                   norm.includes('co nhan lam') || currentUrl.includes('custom-order');

  // 5. Cờ nhận diện câu hỏi giá cả
  const isAskingPrice = words.has('gia') || norm.includes('gia ca') || norm.includes('bao nhieu tien') || 
                        norm.includes('trung binh') || norm.includes('tam bao nhieu') || 
                        norm.includes('khoang bao nhieu') || words.has('tien') || norm.includes('chi phi') || norm.includes('dat khong');

  const isBst = norm.includes('bo suu tap') || norm.includes('suu tap') || words.has('bst') || 
                norm.includes('uom hoa') || norm.includes('world cup') || norm.includes('collection');

  const isKit = norm.includes('bo kit') || norm.includes('kit') || norm.includes('bo lam');

  const isTools = norm.includes('dung cu') || norm.includes('ban ui') || norm.includes('giay ui') || 
                  norm.includes('kep gap') || norm.includes('khay cam') || norm.includes('bang cam');

  // 6. Nhận diện câu hỏi Map mẫu (chỉ khi không phải hỏi màu và không phải custom)
  const isMapInquiry = !isCustom && !isColorInquiry && !isSizeInquiry && (
    norm.includes('map') || norm.includes('chart') || norm.includes('so do') ||
    norm.includes('hinh mau') || rawLower.includes('mẫu') ||
    (words.has('mau') && !norm.includes('moc khoa') && !isAskingPrice)
  );

  // --- TRƯỜNG HỢP 1A: TÌM KIẾM SẢN PHẨM HOẶC MAP MẪU CÓ MÀU CỤ THỂ (VD: MÀU HỒNG, MÀU XANH...) ---
  if (isColorFilterSearch && !isAskingPrice) {
    const colorLabel = detectedColor.label;

    const matchedProds = productsData.filter(p => {
      const text = (p.name + ' ' + (p.description || '')).toLowerCase();
      return text.includes(colorLabel);
    }).sort((a, b) => (b.name.toLowerCase().includes(colorLabel) ? 1 : 0) - (a.name.toLowerCase().includes(colorLabel) ? 1 : 0)).slice(0, 2);

    const matchedMaps = galleryData.filter(m => {
      const text = (m.map_name + ' ' + (m.description || '')).toLowerCase();
      return text.includes(colorLabel);
    }).sort((a, b) => (b.map_name.toLowerCase().includes(colorLabel) ? 1 : 0) - (a.map_name.toLowerCase().includes(colorLabel) ? 1 : 0)).slice(0, 2);

    let reply = `Dạ Urii CÓ rất nhiều mẫu sản phẩm và map mẫu mang tone **màu ${colorLabel}** xinh xắn bạn nhé! 🌸\n`;
    if (matchedProds.length > 0) {
      reply += `- **Sản phẩm:** ${matchedProds.map(p => `${p.name} (${p.currentPrice ? p.currentPrice.toLocaleString('vi-VN') + 'đ' : 'giá ưu đãi'})`).join(', ')}.\n`;
    }
    if (matchedMaps.length > 0) {
      reply += `- **Map mẫu:** ${matchedMaps.map(m => m.map_name.replace('Map mẫu: ', '')).join(', ')}.\n`;
    }
    reply += 'Bạn muốn xem chi tiết sản phẩm làm sẵn hay xem map mẫu để tự làm nè? ✨';

    const topTarget = matchedProds.length > 0 ? `/product-detail/${matchedProds[0].slug}` : '/sample-maps';
    const topLabel = matchedProds.length > 0 ? `Xem ${matchedProds[0].name}` : 'Xem thư viện map';

    return {
      reply,
      targetUrl: topTarget,
      targetLabel: topLabel,
      chips: [
        { label: 'Xem sản phẩm', action: '/products' },
        { label: 'Thư viện map mẫu', action: '/sample-maps' },
        { label: 'Đặt làm theo yêu cầu', action: '/custom-order' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 1B: HỎI VỀ SỐ LƯỢNG MÀU / BẢNG MÀU CỦA HẠT ỦI ---
  if (isColorCatalogInquiry && !isAskingPrice) {
    return {
      reply: 'Dạ bảng màu hạt ủi Perler beads tại Urii có hơn **72 mã màu** phong phú (gồm tone cơ bản, pastel, dạ quang và nhũ)! ✨\n- **Theo bộ Kit DIY:** Có sẵn các set **24 màu**, **48 màu** và **72 màu** (kèm đầy đủ khay cắm, nhíp, giấy ủi).\n- **Gói bổ sung hạt lẻ (10g ~ 1000 hạt):** Đầy đủ các mã màu từ Bảng A đến H với cả 2 kích thước 2.6mm và 5mm.\nBạn có thể ghé danh mục Hạt cườm để xem chi tiết từng mã màu nhé! 🌸',
      targetUrl: '/products?category=BEADS',
      targetLabel: 'Xem bảng màu hạt cườm',
      chips: [
        { label: 'Xem mã màu hạt lẻ', action: '/products?category=BEADS' },
        { label: 'Bộ Kit 24 - 72 màu', action: '/products?category=KIT' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 2: HỎI VỀ KÍCH THƯỚC (SIZE) HẠT ỦI ---
  if (isSizeInquiry && !isAskingPrice) {
    return {
      reply: 'Dạ Urii có 2 kích thước hạt ủi Perler chính bạn nhé:\n- **Hạt Mini 2.6mm**: Thích hợp làm các mẫu nhỏ, độ chi tiết cao, charm điện thoại hoặc móc khóa tinh xảo.\n- **Hạt Midi 5mm**: Kích thước tiêu chuẩn phổ biến, dễ gắp và dễ thao tác nhất cho mọi lứa tuổi.\nCả 2 loại đều có đầy đủ bảng màu và khay cắm tương ứng ạ! ✨',
      targetUrl: '/products?category=BEADS',
      targetLabel: 'Xem các loại hạt ủi',
      chips: [
        { label: 'Hạt lẻ 2.6mm & 5mm', action: '/products?category=BEADS' },
        { label: 'Khay cắm theo size', action: '/products?category=TOOLS' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 3: HỎI VỀ ẢNH KHI ĐẶT THIẾT KẾ RIÊNG ---
  const hasImageWord = norm.includes('anh') || norm.includes('hinh') || norm.includes('photo');
  const hasRequireWord = norm.includes('bat buoc') || norm.includes('phai') || norm.includes('can') || norm.includes('co can') || norm.includes('co bat buoc');

  if (
    (hasImageWord && hasRequireWord) ||
    norm.includes('khong co anh') ||
    norm.includes('khong gui anh') ||
    norm.includes('chua co anh') ||
    norm.includes('gui anh khong')
  ) {
    return {
      reply: 'Dạ hoàn toàn KHÔNG BẮT BUỘC phải gửi ảnh bạn nhé! ✨ Khi đặt làm riêng tại Urii, bạn chỉ cần nhập mô tả ý tưởng (kích thước, tone màu, nhân vật/chữ). Xưởng Urii sẽ lên bản vẽ map gửi bạn duyệt trước khi tiến hành làm ạ! 💖',
      targetUrl: '/custom-order',
      targetLabel: 'Tạo yêu cầu thiết kế ngay',
      chips: [
        { label: 'Gửi yêu cầu thiết kế', action: '/custom-order' },
        { label: 'Xem thư viện map mẫu', action: '/sample-maps' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 4: HỎI ĐẶT LÀM THEO YÊU CẦU (CUSTOM ORDER) ---
  if (isCustom && !isAskingPrice) {
    const isKeychain = norm.includes('moc khoa') || norm.includes('keychain');
    const isCharacter = norm.includes('nhan vat') || norm.includes('hoat hinh') || norm.includes('anime') || norm.includes('chibi') || norm.includes('game');

    let reply = '';
    let targetLabel = 'Đặt làm theo yêu cầu';

    if (isKeychain && isCharacter) {
      reply = 'Dạ Urii CÓ nhận làm móc khóa hạt cườm theo nhân vật hoạt hình (hoặc bất kỳ hình ảnh nào bạn thích) theo yêu cầu riêng bạn nhé! ✨\nBạn chỉ cần gửi mô tả nhân vật hoặc tải ảnh mẫu tại trang Đặt làm riêng, xưởng Urii sẽ lên mẫu thiết kế và báo giá chi tiết cho bạn duyệt trước khi làm ạ! 💖';
      targetLabel = 'Đặt làm móc khóa hoạt hình';
    } else if (isKeychain) {
      reply = 'Dạ Urii CÓ nhận làm móc khóa hạt cườm thiết kế riêng theo yêu cầu bạn nhé! ✨\nBạn có thể gửi mô tả kích thước, tone màu, nhân vật hoặc chữ muốn làm tại form Đặt làm riêng để xưởng lên mẫu và báo giá cho bạn duyệt trước khi làm ạ! 💖';
      targetLabel = 'Đặt làm móc khóa theo yêu cầu';
    } else {
      reply = 'Dạ Urii có nhận làm phụ kiện móc khóa, tranh hạt cườm thiết kế riêng theo yêu cầu của bạn! Bạn chỉ cần gửi ý tưởng mô tả hoặc ảnh (nếu có) tại form Đặt làm riêng để xưởng lên mẫu và báo giá cho bạn nhé ✨';
      targetLabel = 'Tạo yêu cầu thiết kế riêng';
    }

    return {
      reply,
      targetUrl: '/custom-order',
      targetLabel,
      chips: [
        { label: 'Tạo yêu cầu đặt làm', action: '/custom-order' },
        { label: 'Móc khóa có sẵn', action: '/products?category=BST' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 5: HỎI VỀ MAP MẪU CỤ THỂ HOẶC CHUNG CHUNG ---
  if (isMapInquiry) {
    const foundMaps = searchGallery(userMessage);

    // 5A. Tìm thấy map mẫu cụ thể khớp với tên (ví dụ: Hello Kitty, Capybara, Doraemon...)
    if (foundMaps.length > 0) {
      const topMap = foundMaps[0];
      const otherNames = foundMaps.slice(1).map(m => m.map_name.replace('Map mẫu: ', '')).join(', ');
      let replyText = `Dạ Urii CÓ map mẫu này bạn nhé! ✨\n- ${topMap.map_name} (Mã: ${topMap.map_id}, Độ khó: ${topMap.difficulty || 'Dễ'}, Hạt ${topMap.bead_type || 'Midi 5mm'}).`;
      if (otherNames) {
        replyText += `\nNgoài ra còn có thêm mẫu liên quan: ${otherNames}.`;
      }
      replyText += `\nBạn có thể bấm bên dưới để xem chi tiết và tải chart mẫu miễn phí nha!`;

      return {
        reply: replyText,
        targetUrl: `/sample-maps-detail?id=${topMap.map_id}`,
        targetLabel: `Xem chi tiết map ${topMap.map_name.replace('Map mẫu: ', '')}`,
        chips: [
          { label: `Xem map ${topMap.map_id}`, action: `/sample-maps-detail?id=${topMap.map_id}` },
          { label: 'Thư viện map mẫu', action: '/sample-maps' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }

    // 5B. Khách hỏi cụ thể một nhân vật nhưng thư viện chưa có
    const hasSpecificSubject = norm.includes('hinh') || words.has('co') || words.has('tim');
    if (hasSpecificSubject && (words.has('co') || words.has('tim')) && !norm.includes('cac map') && !norm.includes('co nhung')) {
      return {
        reply: 'Dạ hiện tại trên Thư viện mẫu sẵn chưa có mẫu này ạ. Tuy nhiên bạn hoàn toàn có thể gửi yêu cầu tại trang Đặt làm riêng để xưởng Urii vẽ map và thiết kế theo ý bạn nhé! ✨',
        targetUrl: '/custom-order',
        targetLabel: 'Đặt thiết kế map theo yêu cầu',
        chips: [
          { label: 'Đặt làm theo yêu cầu', action: '/custom-order' },
          { label: 'Xem kho map có sẵn', action: '/sample-maps' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }

    // 5C. Hỏi thư viện map mẫu chung chung
    return {
      reply: 'Dạ Thư viện Urii có hơn 60 map mẫu miễn phí từ cấp độ Dễ đến Nâng cao (Hello Kitty, Doraemon, Capybara, Shin, hoa lá, động vật...). Bạn có thể vào xem và tải chart bất cứ lúc nào nhé! 💖',
      targetUrl: '/sample-maps',
      targetLabel: 'Khám phá Thư viện map mẫu',
      chips: [
        { label: 'Xem thư viện map mẫu', action: '/sample-maps' },
        { label: 'Bộ Kit tự làm hạt ủi', action: '/products?category=KIT' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 6: HỎI VỀ GIÁ CẢ (PRICE INQUIRY) ---
  if (isAskingPrice) {
    // 6A. Hỏi giá BST
    if (isBst) {
      return {
        reply: 'Dạ các sản phẩm trong các Bộ Sưu Tập (như 🌸 BST Ươm Hoa, ⚽ BST World Cup...) có giá từ 65.000đ đến 67.000đ/sản phẩm (trung bình khoảng 65.000đ - 66.000đ/món). Tất cả đều được làm thủ công tinh xảo và có sẵn móc khóa kim loại bền đẹp bạn nhé! ✨',
        targetUrl: '/products?category=BST',
        targetLabel: 'Xem các mẫu BST',
        chips: [
          { label: 'Xem BST Ươm Hoa', action: '/products?category=BST' },
          { label: 'Đặt làm theo yêu cầu', action: '/custom-order' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }

    // 6B. Hỏi giá Kit DIY
    if (isKit) {
      return {
        reply: 'Dạ các Bộ Kit DIY tại Urii có giá từ 45.000đ đến 180.000đ tùy số lượng màu:\n- Kit mini 24 màu: 45.000đ - 68.000đ\n- Kit đầy đủ 48 màu: khoảng 115.000đ\n- Kit cao cấp 72 màu: khoảng 180.000đ (đã kèm sẵn khay cắm, nhíp, giấy ủi). 🌸',
        targetUrl: '/products?category=KIT',
        targetLabel: 'Xem danh sách Bộ Kit DIY',
        chips: [
          { label: 'Xem Bộ Kit DIY', action: '/products?category=KIT' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }

    // 6C. Hỏi giá Custom Order
    if (isCustom) {
      return {
        reply: 'Dạ giá đặt làm riêng thường từ 35.000đ đến 120.000đ tùy kích thước và độ chi tiết. Sau khi bạn gửi form mô tả, xưởng Urii sẽ lên mẫu và báo giá chính xác cho bạn duyệt trước khi làm nhé! ✨',
        targetUrl: '/custom-order',
        targetLabel: 'Gửi yêu cầu nhận báo giá',
        chips: [
          { label: 'Tạo yêu cầu thiết kế', action: '/custom-order' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }

    // 6D. Hỏi giá dụng cụ
    if (isTools) {
      return {
        reply: 'Dạ dụng cụ làm hạt cườm tại Urii có giá rất mềm: Bàn ủi nhiệt ~55k, Bảng cắm hạt từ 15k-25k, Nhíp gắp hạt inox ~15k và Giấy ủi chuyên dụng từ 8k-15k ạ! ✨',
        targetUrl: '/products?category=TOOLS',
        targetLabel: 'Xem danh mục Dụng cụ',
        chips: [
          { label: 'Xem dụng cụ làm hạt', action: '/products?category=TOOLS' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }

    // 6E. Giá chung chung
    return {
      reply: 'Dạ các sản phẩm tại Urii có giá từ 15.000đ (dụng cụ, hạt lẻ) đến 65.000đ - 180.000đ (móc khóa BST thủ công, bộ Kit DIY đầy đủ). Bạn muốn tham khảo giá dòng sản phẩm nào nè? 💖',
      targetUrl: '/products',
      targetLabel: 'Xem tất cả sản phẩm',
      chips: [
        { label: 'Xem giá BST', action: '/products?category=BST' },
        { label: 'Xem giá Bộ Kit', action: '/products?category=KIT' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 7: DANH SÁCH BỘ SƯU TẬP (BST) ---
  if (isBst) {
    return {
      reply: 'Dạ hiện tại Urii có dòng sản phẩm nổi bật là 🌸 BST Ươm Hoa (Hoa Bạch Tuyết, Hoa Cẩm Tú Cầu, Hoa Hồng Đỏ, Hoa Lài...) đồng giá 65.000đ/sản phẩm và BST World Cup thể thao. Bạn ghé xem các mẫu nhé! ✨',
      targetUrl: '/products?category=BST',
      targetLabel: 'Khám phá BST Ươm Hoa',
      chips: [
        { label: 'Xem BST Ươm Hoa', action: '/products?category=BST' },
        { label: 'Đặt làm theo yêu cầu', action: '/custom-order' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 8: TRA CỨU SẢN PHẨM CỤ THỂ ---
  const foundProducts = searchProducts(userMessage);
  if (foundProducts.length > 0 && (words.has('co') || words.has('tim') || words.has('mua') || words.has('ban'))) {
    const topProd = foundProducts[0];
    const priceStr = topProd.currentPrice ? (topProd.currentPrice.toLocaleString('vi-VN') + 'đ') : 'giá ưu đãi';
    return {
      reply: `Dạ Urii CÓ sản phẩm này bạn nhé! ✨\n- **${topProd.name}** (Giá: ${priceStr}).\nBạn có thể bấm bên dưới để xem chi tiết hoặc đặt mua sản phẩm nha!`,
      targetUrl: `/product-detail/${topProd.slug}`,
      targetLabel: `Xem chi tiết ${topProd.name}`,
      chips: [
        { label: 'Xem chi tiết sản phẩm', action: `/product-detail/${topProd.slug}` },
        { label: 'Đến giỏ hàng', action: '/cart' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 9: GẶP ADMIN / TƯ VẤN VIÊN ---
  if (norm.includes('nhan vien') || norm.includes('tu van vien') || norm.includes('gap nguoi') || norm.includes('admin') || norm.includes('cham soc') || norm.includes('khieu nai') || norm.includes('chat voi admin')) {
    return {
      reply: 'Dạ mình đã ghi nhận yêu cầu kết nối với Quản trị viên Urii! 🔔 Bạn vui lòng bấm nút [Chat với Admin] bên dưới, hệ thống sẽ gửi thông báo để admin phản hồi trực tiếp cho bạn ngay nhé! ✨',
      targetUrl: '/support',
      targetLabel: 'Đến Trung tâm hỗ trợ',
      chips: [
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Gửi câu hỏi khác', action: 'Xin chào' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 10: ĐƠN HÀNG / VẬN CHUYỂN ---
  if (norm.includes('don hang') || norm.includes('van chuyen') || norm.includes('giao hang') || norm.includes('ship') || norm.includes('hoa toc') || norm.includes('bao lau') || norm.includes('kiem tra don') || norm.includes('ma don') || norm.includes('giao toi') || norm.includes('khi nao nhan')) {
    return {
      reply: 'Dạ chính sách giao hàng của Urii:\n🚚 Freeship toàn quốc cho đơn từ 200.000đ (nhận hàng 2-4 ngày).\n⚡ Hỏa tốc nội thành TP.HCM trong 1-2 tiếng qua Grab/Ahamove.\nBạn có thể vào mục Đơn hàng của tôi để tra cứu tiến độ nhé! ✨',
      targetUrl: '/orders',
      targetLabel: 'Xem đơn hàng của tôi',
      chips: [
        { label: 'Đơn hàng của tôi', action: '/orders' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 11: MÃ GIẢM GIÁ / VOUCHER ---
  if (norm.includes('voucher') || norm.includes('giam gia') || norm.includes('khuyen mai') || norm.includes('ma giam') || norm.includes('freeship') || norm.includes('ma uu dai') || norm.includes('don dau')) {
    return {
      reply: 'Các mã ưu đãi siêu hời tại Urii:\n✨ WELCOME10: Giảm 10% đơn từ 100k cho khách mới.\n🚚 FREESHIP: Miễn phí vận chuyển toàn quốc đơn từ 200k.\n🎁 URII50K: Giảm 50.000đ đơn từ 500k.\nNhập mã tại bước thanh toán bạn nha! 🎀',
      targetUrl: '/checkout',
      targetLabel: 'Đến trang thanh toán',
      chips: [
        { label: 'Khám phá sản phẩm', action: '/products' },
        { label: 'Đến giỏ hàng', action: '/cart' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 12: DỤNG CỤ ---
  if (isTools) {
    return {
      reply: 'Dạ Urii có đủ phụ kiện hạt ủi Perler: Bàn ủi nhiệt mini, giấy ủi nhiệt, nhíp gắp hạt inox và khay cắm hạt vuông/tròn đa năng. Bạn ghé danh mục dụng cụ xem nhé! ✨',
      targetUrl: '/products?category=TOOLS',
      targetLabel: 'Xem dụng cụ làm hạt',
      chips: [
        { label: 'Xem dụng cụ', action: '/products?category=TOOLS' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 13: BỘ KIT DIY ---
  if (isKit) {
    return {
      reply: 'Dạ Urii có sẵn rất nhiều bộ Kit DIY từ 24 đến 72 màu (kèm khay cắm, nhíp, giấy ủi và chart mẫu), rất phù hợp cho người mới bắt đầu. Bạn ghé xem các bộ Kit nha! 🌸',
      targetUrl: '/products?category=KIT',
      targetLabel: 'Xem bộ sưu tập Kit DIY',
      chips: [
        { label: 'Bộ Kit DIY', action: '/products?category=KIT' },
        { label: 'Hạt lẻ nhiều màu', action: '/products?category=BEADS' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 14: BLOG / HƯỚNG DẪN ---
  if (norm.includes('blog') || norm.includes('huong dan') || norm.includes('cach lam') || norm.includes('cach ui') || norm.includes('meo') || norm.includes('chia se')) {
    return {
      reply: 'Góc Blog Urii có rất nhiều bài viết hướng dẫn chi tiết cách ủi hạt phẳng đều nhiệt, phối màu pastel và mẹo gắn móc khóa handmade bền đẹp. Bạn ghé đọc nhé! 🧸',
      targetUrl: '/blog-list',
      targetLabel: 'Đọc blog cộng đồng',
      chips: [
        { label: 'Đọc Blog Urii', action: '/blog-list' },
        { label: 'Xem thư viện map mẫu', action: '/sample-maps' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- TRƯỜNG HỢP 15: CHÀO HỎI ---
  const isGreeting = words.has('chao') || words.has('hello') || words.has('hi') || words.has('alo') || norm === 'chao' || norm === 'xin chao' || norm === 'chao shop' || norm === 'hi shop' || norm === 'hello shop' || norm === 'bat dau';
  if (isGreeting) {
    return {
      reply: 'Xin chào bạn! Mình là Trợ lý AI của Urii ✨ Bạn cần Urii tư vấn về bảng màu hạt cườm, bộ Kit DIY, tìm map mẫu hay đặt làm móc khóa theo yêu cầu nè? 💖',
      targetUrl: '/products',
      targetLabel: 'Khám phá sản phẩm Urii',
      chips: [
        { label: 'Bảng màu hạt ủi', action: '/products?category=BEADS' },
        { label: 'Thư viện map mẫu', action: '/sample-maps' },
        { label: 'Đặt làm theo yêu cầu', action: '/custom-order' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // --- MẶC ĐỊNH: NGẮN GỌN, TRỰC DIỆN ---
  return {
    reply: 'Dạ Urii đã ghi nhận câu hỏi của bạn. Bạn có thể chọn các gợi ý bên dưới hoặc bấm [Chat với Admin] để được nhân viên hỗ trợ trực tiếp 1-1 nhé! 💖',
    targetUrl: '/products',
    targetLabel: 'Khám phá sản phẩm Urii',
    chips: [
      { label: 'Bảng màu hạt ủi', action: '/products?category=BEADS' },
      { label: 'Thư viện map mẫu', action: '/sample-maps' },
      { label: 'Đặt làm theo yêu cầu', action: '/custom-order' },
      { label: 'Chat với Admin', action: 'Chat với Admin' }
    ]
  };
}

/**
 * Trả lời câu hỏi thông qua Google Gemini API
 */
async function generateAiReply({ message, history = [], context = {}, apiKey }) {
  const violation = checkCommunityStandardsViolation(message);
  if (violation) {
    return violation;
  }

  if (!apiKey) {
    return getFallbackReply(message, context);
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const formattedHistory = [];
    const recentHistory = Array.isArray(history) ? history.slice(-6) : [];

    for (const h of recentHistory) {
      if (!h || !h.text) continue;
      formattedHistory.push({
        role: h.sender === 'user' ? 'user' : 'model',
        parts: [{ text: String(h.text) }]
      });
    }

    const contextPrefix = context && context.currentUrl
      ? `[NGỮ CẢNH TRANG HIỆN TẠI: Khách đang đứng ở trang "${context.currentUrl}"${context.isLoggedIn ? ', Đã đăng nhập' : ', Chưa đăng nhập'}]\n`
      : '';

    formattedHistory.push({
      role: 'user',
      parts: [{ text: `${contextPrefix}${String(message)}` }]
    });

    const requestBody = {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: formattedHistory,
      generationConfig: {
        temperature: 0.5,
        topP: 0.85,
        maxOutputTokens: 600,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.warn(`Gemini API lỗi ${response.status}, chuyển sang fallback`);
      return getFallbackReply(message, context);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return getFallbackReply(message, context);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return getFallbackReply(message, context);
    }

    if (!parsed.reply) {
      return getFallbackReply(message, context);
    }

    const chips = Array.isArray(parsed.chips) ? parsed.chips : [];
    if (!chips.some(c => c && c.action === 'Chat với Admin')) {
      chips.push({ label: 'Chat với Admin', action: 'Chat với Admin' });
    }

    return {
      reply: parsed.reply,
      targetUrl: parsed.targetUrl || undefined,
      targetLabel: parsed.targetLabel || undefined,
      chips
    };
  } catch (err) {
    console.warn('Lỗi kết nối Gemini API:', err.message);
    return getFallbackReply(message, context);
  }
}

module.exports = {
  generateAiReply,
  getFallbackReply
};
