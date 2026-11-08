/**
 * AI Chatbot Service for Urii eCommerce System
 * Supports Google Gemini API (gemini-1.5-flash / gemini-2.0-flash) with structured output & deep-linking navigation.
 * Includes intelligent heuristic fallback when API key is not configured or offline.
 */

const SYSTEM_PROMPT = `
Bạn là "Trợ lý ảo thông minh Urii" đại diện cho thương hiệu Urii - chuyên về hạt cườm, hạt ủi Perler Beads, bộ Kit DIY thủ công, thư viện map đính hạt và nhận thiết kế theo yêu cầu (Custom Order).

Tính cách & Phong cách:
- Thân thiện, chu đáo, dễ thương, lịch sự, xưng "Urii" và gọi khách hàng là "bạn".
- Điểm xuyết nhẹ nhàng 1-2 emoji đáng yêu (✨, 💖, 🌸, 🎀, 🧸).
- Câu trả lời súc tích, đi thẳng vào vấn đề, tự nhiên như nhân viên tư vấn thật.

NGUYÊN TẮC NHẬN THỨC NGỮ CẢNH TRANG (PAGE CONTEXT):
Khi câu hỏi của khách có gắn tiền tố [NGỮ CẢNH: Khách đang đứng ở trang "..."]:
- Hãy ưu tiên hiểu rằng câu hỏi của khách đang đề cập trực tiếp đến hành động, form nhập liệu hoặc tính năng của trang đó!
- Ví dụ nếu khách đang ở trang "/custom-order-request" mà hỏi "nó có bắt buộc gửi ảnh không" hay "làm cái này bao lâu" -> Hiểu ngay là khách đang hỏi về việc Đặt làm theo yêu cầu.
- Nếu khách đang ở trang "/check-out" mà hỏi "sao không tiếp tục được" hay "có mã giảm không" -> Hướng dẫn các bước hoàn tất thanh toán hoặc cách điền mã voucher.
- Nếu khách đang ở trang "/sample-maps" mà hỏi "cần mua gì để làm" -> Hướng dẫn các bộ kit hoặc dụng cụ cần thiết để làm theo map mẫu.

BẢN ĐỒ CÁC LUỒNG HÀNH TRÌNH CHÍNH (USER FLOWS):
1. Luồng Đặt thiết kế riêng (/custom-order-request -> /account/custom-orders):
   - Quy tắc vàng: HOÀN TOÀN KHÔNG BẮT BUỘC PHẢI CÓ ẢNH. Khách có thể gửi ảnh nếu có, hoặc chỉ cần điền mô tả (kích thước, tone màu, nhân vật/chữ muốn xỏ). Xưởng Urii sẽ lên map thiết kế mẫu gửi khách duyệt trước khi làm. Sau khi gửi, khách theo dõi tiến độ tại /account/custom-orders.
2. Luồng Mua Kit tự làm hạt ủi (/sample-maps -> /products?category=KIT):
   - Khách xem map mẫu miễn phí tại /sample-maps -> Bấm "Lưu mẫu" -> Mua bộ Kit DIY đầy đủ phụ kiện hoặc mua dụng cụ chuyên dụng (bàn ủi nhiệt, giấy ủi, kẹp).
3. Luồng Giỏ hàng & Thanh toán (/cart -> /check-out):
   - Mã khuyến mãi: WELCOME10 (giảm 10%), FREESHIP (đơn từ 200k), URII50K (giảm 50k từ 500k). Hỗ trợ thanh toán COD và chuyển khoản ngân hàng.
4. Luồng Cộng đồng & Hướng dẫn (/blog-list -> /blog-create):
   - Đọc mẹo ủi hạt phẳng, cách phối màu, ý tưởng handmade và tự viết bài chia sẻ.
5. Luồng Hỗ trợ Admin:
   - Cuối mỗi câu trả lời, hãy gợi ý nhẹ nhàng: "Nếu bạn cần hỗ trợ thêm, hãy bấm nút [Chat với Admin] bên dưới nhé. Hệ thống sẽ lập tức gửi thông báo cho quản trị viên và admin sẽ phản hồi lại ngay cho bạn!".
   - Trong mảng "chips": Luôn luôn kèm thêm 1 chip: { "label": "Chat với Admin", "action": "Chat với Admin" }.

CÁC VÍ DỤ MẪU (FEW-SHOT EXAMPLES):
- Khách ở /custom-order-request hỏi: "nó có bắt buộc phải gửi ảnh không"
  -> Trả lời: "Dạ hoàn toàn KHÔNG BẮT BUỘC phải gửi ảnh bạn nhé! ✨ Khi tạo yêu cầu tại trang Đặt làm riêng này, nếu có ảnh mẫu sẵn thì bạn tải lên, còn nếu chưa có ảnh thì bạn chỉ cần nhập mô tả chi tiết (kích thước, tone màu, nhân vật hoặc chữ bạn muốn làm). Xưởng Urii sẽ lên map thiết kế mẫu gửi bạn duyệt trước khi tiến hành làm đó ạ! 💖\n\n💬 Nếu bạn cần hỗ trợ thêm, hãy bấm nút [Chat với Admin] bên dưới nhé. Hệ thống sẽ lập tức gửi thông báo cho quản trị viên và admin sẽ phản hồi lại ngay cho bạn!"
  -> TargetUrl: "/custom-order-request", TargetLabel: "Gửi yêu cầu thiết kế ngay"
  -> Chips: [{ "label": "Tạo yêu cầu thiết kế", "action": "/custom-order-request" }, { "label": "Chat với Admin", "action": "Chat với Admin" }]

- Khách ở /check-out hỏi: "sao không đặt hàng được"
  -> Trả lời: "Dạ bạn kiểm tra giúp Urii xem mình đã điền đầy đủ Số điện thoại nhận hàng, Địa chỉ cụ thể và chọn Phương thức thanh toán (COD hoặc Chuyển khoản) ở các bước bên trên chưa nhé ạ! ✨\n\n💬 Nếu bạn cần hỗ trợ thêm, hãy bấm nút [Chat với Admin] bên dưới nhé."
  -> Chips: [{ "label": "Đến giỏ hàng", "action": "/cart" }, { "label": "Chat với Admin", "action": "Chat với Admin" }]

Bản đồ liên kết nội bộ Urii:
- Trang chủ: /
- Danh sách sản phẩm: /products
- Bộ Kit DIY tự làm hạt cườm: /products?category=KIT
- Hạt cườm lẻ & charm phụ kiện: /products?category=BEADS
- Dụng cụ chuyên dụng: /products?category=TOOLS
- Thư viện map mẫu đính hạt: /sample-maps
- Đặt làm theo yêu cầu: /custom-order-request
- Góc chia sẻ Blog cộng đồng: /blog-list
- Đơn hàng của tôi: /account/my-orders
- Map mẫu đã lưu: /account/saved-maps
- Trung tâm hỗ trợ: /support

YÊU CẦU ĐỊNH DẠNG:
Bạn PHẢI trả về duy nhất một chuỗi JSON hợp lệ (không kèm Markdown code block) với cấu trúc sau:
{
  "reply": "Nội dung trả lời tự nhiên của bạn...",
  "targetUrl": "/duong-dan-phu-hop-neu-co-hoac-null",
  "targetLabel": "Chữ hiển thị trên nút bấm dẫn tới link",
  "chips": [
    { "label": "Tên nút gợi ý", "action": "/duong-dan-hoac-cau-hoi-goi-y" }
  ]
}
`;

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heuristic Fallback khi chưa cấu hình GEMINI_API_KEY hoặc mất kết nối mạng AI
 */
function getFallbackReply(userMessage, context = {}) {
  const norm = normalizeText(userMessage);
  const words = new Set(norm.split(' '));
  const currentUrl = String(context.currentUrl || '');

  const adminHelpSuffix = '\n\n💬 Nếu bạn cần hỗ trợ thêm, hãy bấm nút [Chat với Admin] bên dưới nhé. Hệ thống sẽ lập tức gửi thông báo cho quản trị viên và admin sẽ phản hồi lại ngay cho bạn!';

  // --- ƯU TIÊN 1: XỬ LÝ THEO NGỮ CẢNH TRANG HIỆN TẠI (PAGE CONTEXT) ---
  if (currentUrl.includes('custom-order')) {
    // Khách đang ở trang Đặt làm theo yêu cầu
    if (norm.includes('anh') || norm.includes('hinh') || norm.includes('bat buoc') || norm.includes('can') || norm.includes('phai') || norm.includes('khong co')) {
      return {
        reply: 'Dạ hoàn toàn KHÔNG BẮT BUỘC phải gửi ảnh bạn nhé! ✨ Khi tạo yêu cầu tại trang Đặt làm riêng này, nếu có ảnh mẫu sẵn thì bạn tải lên, còn nếu chưa có ảnh thì bạn chỉ cần nhập mô tả chi tiết (kích thước, tone màu, nhân vật hoặc chữ bạn muốn làm). Xưởng Urii sẽ lên map thiết kế mẫu gửi bạn duyệt trước khi tiến hành làm đó ạ! 💖' + adminHelpSuffix,
        targetUrl: '/custom-order-request',
        targetLabel: 'Tạo yêu cầu thiết kế ngay',
        chips: [
          { label: 'Gửi yêu cầu thiết kế', action: '/custom-order-request' },
          { label: 'Chat với Admin', action: 'Chat với Admin' },
          { label: 'Xem thư viện map mẫu', action: '/sample-maps' }
        ]
      };
    }
    if (words.has('gia') || norm.includes('bao nhieu') || norm.includes('phi')) {
      return {
        reply: 'Dạ mức giá cho đơn đặt làm riêng sẽ phụ thuộc vào kích thước và độ chi tiết của tác phẩm. Sau khi bạn gửi form yêu cầu tại trang này, xưởng Urii sẽ lên bản vẽ mẫu và gửi báo giá chi tiết cho bạn duyệt trước khi thanh toán nhé!' + adminHelpSuffix,
        targetUrl: '/custom-order-request',
        targetLabel: 'Gửi thông tin để nhận báo giá',
        chips: [
          { label: 'Tạo yêu cầu thiết kế', action: '/custom-order-request' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }
  }

  if (currentUrl.includes('check-out') || currentUrl.includes('cart')) {
    // Khách đang ở giỏ hàng hoặc thanh toán
    if (norm.includes('ma') || norm.includes('voucher') || norm.includes('giam gia') || norm.includes('freeship')) {
      return {
        reply: 'Dạ bạn có thể áp dụng các mã ưu đãi sau tại khung Mã giảm giá bên phải màn hình:\n✨ WELCOME10: Giảm 10% đơn từ 100k\n🚚 FREESHIP: Miễn phí ship đơn từ 200k\n🎁 URII50K: Giảm 50k đơn từ 500k' + adminHelpSuffix,
        targetUrl: '/cart',
        targetLabel: 'Kiểm tra giỏ hàng',
        chips: [
          { label: 'Xem giỏ hàng', action: '/cart' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }
    if (norm.includes('khong duoc') || norm.includes('loi') || norm.includes('thanh toan')) {
      return {
        reply: 'Dạ bạn kiểm tra giúp Urii xem mình đã điền đủ Số điện thoại nhận hàng, Địa chỉ cụ thể và chọn Phương thức thanh toán (COD hoặc Chuyển khoản) chưa nhé ạ!' + adminHelpSuffix,
        targetUrl: '/check-out',
        targetLabel: 'Quay lại thanh toán',
        chips: [
          { label: 'Chat với Admin hỗ trợ', action: 'Chat với Admin' }
        ]
      };
    }
  }

  if (currentUrl.includes('sample-maps')) {
    // Khách đang xem thư viện map mẫu
    if (norm.includes('mua gi') || norm.includes('can gi') || norm.includes('dung cu') || norm.includes('lam sao')) {
      return {
        reply: 'Dạ để tự tay đính các map mẫu tại thư viện này, bạn chỉ cần chuẩn bị một Bộ Kit hạt ủi (đã có sẵn hạt, khay cắm, nhíp gắp) kèm bàn ủi nhiệt mini và giấy ủi chuyên dụng là có thể làm được rồi đó ạ! ✨' + adminHelpSuffix,
        targetUrl: '/products?category=KIT',
        targetLabel: 'Xem bộ Kit làm hạt ủi',
        chips: [
          { label: 'Xem bộ Kit làm hạt', action: '/products?category=KIT' },
          { label: 'Xem dụng cụ làm hạt', action: '/products?category=TOOLS' },
          { label: 'Chat với Admin', action: 'Chat với Admin' }
        ]
      };
    }
  }

  // --- ƯU TIÊN 2: XỬ LÝ THEO Ý ĐỊNH CÂU HỎI (INTENT MATCHING) ---

  // 0. Bắt buộc gửi ảnh / Có cần gửi ảnh khi đặt làm theo yêu cầu không
  const hasImageWord = norm.includes('anh') || norm.includes('hinh') || norm.includes('photo');
  const hasRequireWord = norm.includes('bat buoc') || norm.includes('phai') || norm.includes('can') || norm.includes('co can') || norm.includes('co bat buoc');

  if (
    (hasImageWord && hasRequireWord) ||
    norm.includes('khong co anh') ||
    norm.includes('khong gui anh') ||
    norm.includes('chua co anh') ||
    norm.includes('co can gui anh') ||
    norm.includes('co bat buoc phai gui anh') ||
    norm.includes('co phai gui anh') ||
    norm.includes('bat buoc phai gui anh') ||
    norm.includes('tai anh len') ||
    norm.includes('gui anh khong')
  ) {
    return {
      reply: 'Dạ hoàn toàn KHÔNG BẮT BUỘC phải gửi ảnh bạn nhé! ✨ Khi tạo yêu cầu đặt làm thiết kế tại Urii, nếu có ảnh mẫu sẵn thì bạn tải lên, còn nếu chưa có ảnh thì bạn chỉ cần nhập mô tả chi tiết (kích thước, tone màu, nhân vật hoặc chữ bạn muốn làm). Xưởng Urii sẽ lên map thiết kế mẫu gửi bạn duyệt trước khi tiến hành làm đó ạ! 💖' + adminHelpSuffix,
      targetUrl: '/custom-order-request',
      targetLabel: 'Tạo yêu cầu thiết kế ngay',
      chips: [
        { label: 'Gửi yêu cầu thiết kế', action: '/custom-order-request' },
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Xem thư viện map mẫu', action: '/sample-maps' }
      ]
    };
  }

  // 1. Nhân viên hỗ trợ / Gặp người thật / Chat với admin
  if (norm.includes('nhan vien') || norm.includes('tu van vien') || norm.includes('gap nguoi') || norm.includes('admin') || norm.includes('cham soc') || norm.includes('khieu nai') || norm.includes('chat voi admin')) {
    return {
      reply: 'Dạ mình đã ghi nhận yêu cầu kết nối với Quản trị viên/Chuyên viên tư vấn của Urii rồi ạ! 🔔 Bạn vui lòng bấm nút [Chat với Admin] bên dưới, hệ thống sẽ gửi thông báo cho quản trị viên và admin sẽ phản hồi lại ngay cho bạn tại khung chat này nhé! ✨',
      targetUrl: '/support',
      targetLabel: 'Đến Trung tâm hỗ trợ',
      chips: [
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Gửi câu hỏi khác', action: 'Xin chào' }
      ]
    };
  }

  // 2. Tra cứu đơn hàng / Vận chuyển
  if (norm.includes('don hang') || norm.includes('van chuyen') || norm.includes('giao hang') || norm.includes('ship') || norm.includes('hoa toc') || norm.includes('bao lau') || norm.includes('kiem tra don') || norm.includes('ma don') || norm.includes('giao toi') || norm.includes('khi nao nhan')) {
    return {
      reply: 'Dạ chính sách giao hàng của Urii:\n🚚 Freeship toàn quốc cho đơn từ 200.000đ (2-4 ngày).\n⚡ Hỏa tốc nội thành TP.HCM chỉ trong 1-2 tiếng qua Grab/Ahamove.\nBạn có thể vào mục Đơn hàng của tôi để xem trạng thái đơn hàng bất cứ lúc nào nhé!' + adminHelpSuffix,
      targetUrl: '/account/my-orders',
      targetLabel: 'Xem đơn hàng của tôi',
      chips: [
        { label: 'Đơn hàng của tôi', action: '/account/my-orders' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // 3. Khuyến mãi / Mã giảm giá / Voucher
  if (norm.includes('voucher') || norm.includes('giam gia') || norm.includes('khuyen mai') || norm.includes('ma giam') || norm.includes('freeship') || norm.includes('ma uu dai') || norm.includes('don dau')) {
    return {
      reply: 'Các mã ưu đãi siêu hời đang có tại Urii:\n✨ WELCOME10: Giảm ngay 10% đơn từ 100k cho khách hàng mới.\n🚚 FREESHIP: Miễn phí vận chuyển toàn quốc cho đơn từ 200k.\n🎁 URII50K: Giảm 50.000đ cho đơn từ 500k.\nNhập mã ở bước thanh toán để được giảm giá nha! 🎀' + adminHelpSuffix,
      targetUrl: '/products',
      targetLabel: 'Mua sắm áp mã ngay',
      chips: [
        { label: 'Khám phá sản phẩm', action: '/products' },
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Đến giỏ hàng', action: '/cart' }
      ]
    };
  }

  // 4. Đặt làm theo yêu cầu / Custom order
  if (norm.includes('dat lam') || norm.includes('theo yeu cau') || norm.includes('custom') || norm.includes('thiet ke') || norm.includes('lam theo anh') || norm.includes('moc khoa theo yeu cau') || norm.includes('in theo anh')) {
    return {
      reply: 'Dạ Urii có nhận làm phụ kiện, móc khóa và tranh hạt cườm thiết kế riêng theo yêu cầu của bạn đó ạ! Bạn có thể tải ảnh mẫu (nếu có) hoặc chỉ cần ghi mô tả kích thước, màu sắc mong muốn tại trang Đặt làm riêng để xưởng lên mẫu và báo giá cho bạn nhé ✨' + adminHelpSuffix,
      targetUrl: '/custom-order-request',
      targetLabel: 'Gửi yêu cầu thiết kế ngay',
      chips: [
        { label: 'Xem thư viện map mẫu', action: '/sample-maps' },
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Bảng giá tham khảo', action: '/support' }
      ]
    };
  }

  // 5. Thư viện map mẫu / Chart đính hạt
  if (norm.includes('map') || norm.includes('mau') || norm.includes('chart') || norm.includes('hinh mau') || norm.includes('ban do')) {
    return {
      reply: 'Urii có kho thư viện hàng trăm map mẫu hạt cườm từ cấp độ Dễ đến Nâng cao hoàn toàn miễn phí! Bạn có thể tải mẫu về hoặc bấm "Lưu mẫu" vào bộ sưu tập cá nhân để xem bất cứ lúc nào nha 💖' + adminHelpSuffix,
      targetUrl: '/sample-maps',
      targetLabel: 'Khám phá thư viện map mẫu',
      chips: [
        { label: 'Bộ Kit hạt ủi', action: '/products?category=KIT' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // 6. Dụng cụ & Bàn ủi
  if (norm.includes('dung cu') || norm.includes('ban ui') || norm.includes('giay ui') || norm.includes('kep gap') || norm.includes('khay cam') || norm.includes('bang cam')) {
    return {
      reply: 'Urii có đầy đủ dụng cụ chuyên dụng cho môn hạt ủi Perler: Bàn ủi nhiệt mini, giấy ủi bóng/mờ, kẹp gắp hạt và bảng cắm hạt đa năng giúp bạn thao tác siêu dễ dàng! ✨' + adminHelpSuffix,
      targetUrl: '/products?category=TOOLS',
      targetLabel: 'Xem dụng cụ làm hạt',
      chips: [
        { label: 'Xem tất cả sản phẩm', action: '/products' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // 7. Sản phẩm / Mua hạt / Kit DIY
  if (norm.includes('kit') || norm.includes('bo lam') || norm.includes('mua') || norm.includes('san pham') || norm.includes('hat cuom') || norm.includes('hat ui') || norm.includes('perler') || words.has('gia') || norm.includes('bao nhieu')) {
    return {
      reply: 'Dạ Urii có sẵn rất nhiều bộ Kit DIY từ 24 đến 72 màu (kèm sẵn mẫu, bảng cắm và phụ kiện móc khóa) dành cho cả người mới bắt đầu lẫn các bạn làm chuyên nghiệp. Bạn ghé xem các bộ Kit bán chạy nhé! 🌸' + adminHelpSuffix,
      targetUrl: '/products?category=KIT',
      targetLabel: 'Xem bộ sưu tập Kit DIY',
      chips: [
        { label: 'Tất cả sản phẩm', action: '/products' },
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Hạt lẻ nhiều màu', action: '/products?category=BEADS' }
      ]
    };
  }

  // 8. Blog / Mẹo làm / Hướng dẫn
  if (norm.includes('blog') || norm.includes('huong dan') || norm.includes('cach lam') || norm.includes('cach ui') || norm.includes('meo') || norm.includes('chia se')) {
    return {
      reply: 'Góc Blog cộng đồng của Urii có rất nhiều bài viết hướng dẫn chi tiết cách ủi hạt phẳng đều, cách phối màu pastel, mẹo gắn móc khóa bền đẹp và chia sẻ tác phẩm của cộng đồng yêu handmade đó ạ! 🧸' + adminHelpSuffix,
      targetUrl: '/blog-list',
      targetLabel: 'Đọc blog cộng đồng',
      chips: [
        { label: 'Xem thư viện map mẫu', action: '/sample-maps' },
        { label: 'Chat với Admin', action: 'Chat với Admin' }
      ]
    };
  }

  // 9. Chào hỏi / Lời chào
  if (norm.includes('chao') || norm.includes('hello') || norm.includes('hi') || norm.includes('alo') || norm.includes('bat dau')) {
    return {
      reply: 'Xin chào bạn! Mình là Trợ lý AI của Urii ✨ Mình luôn sẵn sàng hỗ trợ bạn về sản phẩm hạt cườm, kit DIY, thư viện map mẫu hoặc nhận làm theo yêu cầu. Bạn cần Urii giúp gì hôm nay nè?' + adminHelpSuffix,
      targetUrl: '/products',
      targetLabel: 'Khám phá cửa hàng Urii',
      chips: [
        { label: 'Thư viện map mẫu', action: '/sample-maps' },
        { label: 'Đặt làm theo yêu cầu', action: '/custom-order-request' },
        { label: 'Chat với Admin', action: 'Chat với Admin' },
        { label: 'Mã giảm giá', action: 'Mã giảm giá' }
      ]
    };
  }

  // Mặc định
  return {
    reply: 'Dạ Urii đã ghi nhận câu hỏi của bạn. Urii chuyên cung cấp hạt ủi Perler beads, bộ kit DIY, map mẫu miễn phí và nhận làm móc khóa theo yêu cầu. Bạn có thể tham khảo các mục gợi ý bên dưới hoặc kết nối với Quản trị viên để được tư vấn trực tiếp 1-1 nhé! 💖' + adminHelpSuffix,
    targetUrl: '/products',
    targetLabel: 'Khám phá sản phẩm Urii',
    chips: [
      { label: 'Đặt làm theo yêu cầu', action: '/custom-order-request' },
      { label: 'Thư viện map mẫu', action: '/sample-maps' },
      { label: 'Chat với Admin', action: 'Chat với Admin' },
      { label: 'Mã giảm giá', action: 'Mã giảm giá' }
    ]
  };
}

/**
 * Trả lời câu hỏi thông qua Google Gemini API
 */
async function generateAiReply({ message, history = [], context = {}, apiKey }) {
  if (!apiKey) {
    return getFallbackReply(message, context);
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Chuẩn bị contents từ lịch sử chat (tối đa 6 tin nhắn gần nhất)
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
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 800,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[AI Service] Gemini API trả về lỗi status', response.status, errorText);
      return getFallbackReply(message);
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return getFallbackReply(message);
    }

    // Làm sạch và parse JSON
    const cleanJson = candidateText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      reply: parsed.reply || getFallbackReply(message).reply,
      targetUrl: parsed.targetUrl || null,
      targetLabel: parsed.targetLabel || null,
      chips: Array.isArray(parsed.chips) ? parsed.chips : []
    };
  } catch (error) {
    console.warn('[AI Service] Ngoại lệ khi gọi Gemini API, chuyển sang Fallback Engine:', error.message);
    return getFallbackReply(message);
  }
}

module.exports = {
  generateAiReply,
  getFallbackReply
};
