require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Import tất cả Models
const Product = require('./models/Product');
const Category = require('./models/Category');
const SampleMap = require('./models/SampleMap');
const Voucher = require('./models/Voucher');
const Order = require('./models/Order');
const Blog = require('./models/Blog');
const Comment = require('./models/Comment');
const User = require('./models/User');
const SavedMap = require('./models/SavedMap');
const ChatSession = require('./models/ChatSession');
const ChatbotFaq = require('./models/ChatbotFaq');

function readJSON(fileName) {
  const filePath = path.join(__dirname, 'data', fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function prepareMaps(maps) {
  return maps.map((map) => ({
    ...map,
    slug: map.slug || `map-${String(map.map_id).toLowerCase()}`
  }));
}

// Cấu hình danh sách các module dữ liệu
const MODULES = [
  {
    name: 'Categories (Danh mục)',
    aliases: ['category', 'categories', 'danhmuc'],
    model: Category,
    key: '_id',
    getData: () => readJSON('categories.json')
  },
  {
    name: 'Products (Sản phẩm)',
    aliases: ['product', 'products', 'sanpham'],
    model: Product,
    key: 'id',
    getData: () => readJSON('products.json')?.products
  },
  {
    name: 'Blogs (Bài viết)',
    aliases: ['blog', 'blogs', 'baiviet'],
    model: Blog,
    key: 'slug',
    getData: () => readJSON('blogs.json')?.blogs
  },
  {
    name: 'Orders (Đơn hàng)',
    aliases: ['order', 'orders', 'donhang'],
    model: Order,
    key: 'id',
    getData: () => readJSON('orders.json')?.orders
  },
  {
    name: 'Comments (Bình luận)',
    aliases: ['comment', 'comments', 'binhluan'],
    model: Comment,
    key: 'id',
    getData: () => readJSON('comments.json')?.comments
  },
  {
    name: 'Gallery (Mẫu Map)',
    aliases: ['map', 'maps', 'gallery', 'samplemap', 'maumap'],
    model: SampleMap,
    key: 'map_id',
    getData: () => {
      const data = readJSON('gallery.json');
      return data ? prepareMaps(data) : null;
    }
  },
  {
    name: 'Saved Maps (Map đã lưu)',
    aliases: ['saved_maps', 'savedmaps', 'mapdaluu'],
    model: SavedMap,
    key: 'id',
    getData: () => readJSON('saved_maps.json')?.maps
  },
  {
    name: 'Vouchers (Mã giảm giá)',
    aliases: ['voucher', 'vouchers', 'magiamgia'],
    model: Voucher,
    key: 'code',
    getData: () => readJSON('vouchers.json')?.vouchers
  },
  {
    name: 'Chat Sessions (Phiên Chatbot)',
    aliases: ['chatsession', 'chatsessions', 'chat_sessions', 'chat', 'chatbot'],
    model: ChatSession,
    key: 'sessionId',
    getData: () => {
      const separate = readJSON('chat_sessions.json');
      if (separate) return separate;
      const combined = readJSON('chatbot.json');
      return Array.isArray(combined?.sessions) ? combined.sessions : (combined?.sessions ? Object.values(combined.sessions) : null);
    }
  },
  {
    name: 'Chatbot FAQs (Câu hỏi Chatbot)',
    aliases: ['faq', 'faqs', 'chatbot_faqs', 'chatbotfaqs', 'cauhoi', 'chatbot'],
    model: ChatbotFaq,
    key: 'id',
    getData: () => {
      const separate = readJSON('chatbot_faqs.json');
      if (separate) return separate;
      return readJSON('chatbot.json')?.faqs;
    }
  },
  {
    name: 'Users (Người dùng)',
    aliases: ['user', 'users', 'nguoidung'],
    model: User,
    key: 'email',
    getData: async () => {
      const users = readJSON('users.json')?.users;
      if (!Array.isArray(users)) return null;

      // Xử lý mật khẩu nếu là user mới
      const preparedUsers = [];
      for (const user of users) {
        const email = user.email.trim().toLowerCase();
        const existing = await User.findOne({ email }).lean();
        if (existing) {
          // Giữ nguyên mật khẩu đã mã hóa của user hiện tại
          preparedUsers.push({ ...user, email, password: existing.password });
        } else {
          // Tạo mật khẩu mặc định an toàn cho user mới nếu là $GENERATE
          const rawPass = (user.password && user.password !== '$GENERATE') ? user.password : 'UriiUser@2026Secure';
          const hashedPassword = await bcrypt.hash(rawPass, 10);
          preparedUsers.push({ ...user, email, password: hashedPassword });
        }
      }
      return preparedUsers;
    }
  }
];

async function syncModule(mod) {
  try {
    let docs = typeof mod.getData === 'function' ? await mod.getData() : null;
    if (!docs || !Array.isArray(docs) || docs.length === 0) {
      console.log(`⚠️  [${mod.name}]: Không có dữ liệu để tải lên.`);
      return;
    }

    const operations = docs.map((doc) => ({
      updateOne: {
        filter: { [mod.key]: doc[mod.key] },
        update: { $set: doc },
        upsert: true
      }
    }));

    const result = await mod.model.bulkWrite(operations, { ordered: false });
    const inserted = result.upsertedCount || 0;
    const modified = result.modifiedCount || 0;
    const matched = result.matchedCount || 0;
    const totalOnAtlas = await mod.model.countDocuments();

    if (inserted > 0) {
      console.log(`✨ [${mod.name}]: ĐÃ THÊM MỚI ${inserted} bản ghi! (Tổng hiện có: ${totalOnAtlas})`);
    } else if (modified > 0) {
      console.log(`🔄 [${mod.name}]: Đã cập nhật ${modified} bản ghi thay đổi. (Tổng hiện có: ${totalOnAtlas})`);
    } else {
      console.log(`✔️  [${mod.name}]: Đã đồng bộ, không có mục mới (${matched} bản ghi giữ nguyên).`);
    }
  } catch (err) {
    console.error(`❌ [${mod.name}] Lỗi:`, err.message);
  }
}

async function main() {
  const targetArg = process.argv[2]?.toLowerCase().trim();
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('❌ Lỗi: Chưa cấu hình MONGO_URI trong file .env');
    process.exit(1);
  }

  console.log('====================================================');
  console.log('🚀 URII MONGO ATLAS AUTO-SYNC & UPLOAD');
  console.log('====================================================');
  console.log('📡 Đang kết nối tới MongoDB Atlas...');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log('✅ Kết nối Atlas thành công!\n');

  // Xác định các module cần sync
  let targets = MODULES;
  if (targetArg && targetArg !== 'all') {
    targets = MODULES.filter((m) => m.aliases.includes(targetArg));
    if (targets.length === 0) {
      console.log(`⚠️  Không tìm thấy module khớp với "${targetArg}".`);
      console.log(`👉 Bạn có thể dùng: products, categories, blogs, orders, comments, maps, vouchers, chatbot, users, hoặc không truyền tham số để sync tất cả.\n`);
      await mongoose.disconnect();
      return;
    }
  }

  console.log(`📦 Bắt đầu kiểm tra và tải dữ liệu mới lên MongoDB Atlas...\n`);
  for (const mod of targets) {
    await syncModule(mod);
  }

  console.log('\n====================================================');
  console.log('🎉 ĐỒNG BỘ HOÀN TẤT! DỮ LIỆU ĐÃ SẴN SÀNG TRÊN MONGO ATLAS.');
  console.log('====================================================');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\n❌ Lỗi tiến trình upload:', err);
  process.exit(1);
});
