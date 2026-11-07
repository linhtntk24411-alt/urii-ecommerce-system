require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Import tất cả Models
const Product = require('./models/Product');
const Category = require('./models/Category');
const Gallery = require('./models/Gallery');
const Voucher = require('./models/Voucher');
const Order = require('./models/Order');
const Blog = require('./models/Blog');
const Comment = require('./models/Comment');
const User = require('./models/User');
const SavedMap = require('./models/SavedMap');
const LikedProduct = require('./models/LikedProduct');
const LikedBlog = require('./models/LikedBlog');
const ChatSession = require('./models/ChatSession');
const ChatbotFaq = require('./models/ChatbotFaq');
const CustomOrder = require('./models/CustomOrder');
const Cart = require('./models/Cart');
const Review = require('./models/Review');
const { prepareSavedMaps } = require('./utils/savedMaps');
const { prepareLikedProducts } = require('./utils/likedProducts');
const { prepareLikedBlogs } = require('./utils/likedBlogs');
const { prepareCartFixtures, prepareReviewFixtures, syncAllProductRatings } = require('./utils/commerceFixtures');
const { prepareUserPassword } = require('./utils/userPassword');

function readJSON(fileName) {
  const filePath = path.join(__dirname, 'data', fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeTarget(value) {
  return path.basename(value).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isModuleFile(mod, fileName) {
  const fileTarget = normalizeTarget(fileName);
  return mod.aliases.some((alias) => normalizeTarget(alias) === fileTarget);
}

function getJsonRecords(fileName) {
  const data = readJSON(fileName);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 1 && Array.isArray(data[keys[0]])) return data[keys[0]];
    return [data];
  }
  throw new Error(`[${fileName}] JSON phải là một object hoặc một danh sách object.`);
}

function prepareGallery(gallery) {
  return gallery.map((item) => ({
    ...item,
    slug: item.slug || `map-${String(item.map_id).toLowerCase()}`
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
    name: 'Custom Orders (Đơn hàng thiết kế riêng)',
    aliases: ['custom-orders'],
    model: CustomOrder,
    key: 'id',
    getData: () => readJSON('custom_orders.json')
  },
  {
    name: 'Comments (Bình luận)',
    aliases: ['comment', 'comments', 'binhluan'],
    model: Comment,
    key: 'id',
    getData: () => readJSON('comments.json')?.comments
  },
  {
    name: 'Gallery',
    aliases: ['gallery'],
    model: Gallery,
    key: 'map_id',
    getData: () => {
      const data = readJSON('gallery.json');
      return data ? prepareGallery(data) : null;
    }
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

      const preparedUsers = [];
      for (const user of users) {
        const email = user.email.trim().toLowerCase();
        const existing = await User.findOne({ email }).select('+password').lean();
        const authProviders = Array.from(new Set([
          ...(user.authProviders || []),
          ...(existing?.authProviders || []),
          ...(existing?.password ? ['password'] : [])
        ]));
        const oauthAccounts = [
          ...(user.oauthAccounts || []),
          ...(existing?.oauthAccounts || [])
        ].filter((account, index, accounts) => (
          accounts.findIndex((candidate) => (
            candidate.provider === account.provider
            && candidate.providerUserId === account.providerUserId
          )) === index
        ));
        const password = await prepareUserPassword(
          user.password,
          existing?.password,
          authProviders
        );
        preparedUsers.push({ ...user, email, password, authProviders, oauthAccounts });
      }
      return preparedUsers;
    }
  },
  {
    name: 'Saved Maps (Map đã lưu)',
    aliases: ['saved_maps', 'savedmaps', 'mapdaluu'],
    model: SavedMap,
    key: 'id',
    filter: (map) => ({ userId: map.userId, mapId: map.mapId }),
    getData: async () => {
      const data = readJSON('saved_maps.json');
      if (!Array.isArray(data?.users)) return null;
      const users = await User.find({
        _id: { $in: data.users.map((user) => user.userId) },
        role: 'user'
      }).select('_id email role').lean();
      const gallery = await Gallery.find().lean();
      return prepareSavedMaps(data, users, gallery);
    }
  },
  {
    name: 'Liked Products (Sản phẩm đã thích)',
    aliases: ['liked_products', 'likedproducts', 'liked-products', 'sanphamdathich'],
    model: LikedProduct,
    key: 'id',
    filter: (item) => ({ userId: item.userId, productId: item.productId }),
    getData: () => prepareLikedProducts(
      readJSON('liked_products.json'),
      readJSON('users.json')?.users || [],
      readJSON('products.json')?.products || []
    )
  },
  {
    name: 'Liked Blogs (Bài viết đã thích)',
    aliases: ['liked_blogs', 'likedblogs', 'liked-blogs', 'baivietdathich'],
    model: LikedBlog,
    key: 'id',
    filter: (item) => ({ userId: item.userId, blogId: item.blogId }),
    getData: () => prepareLikedBlogs(
      readJSON('liked_blogs.json'),
      readJSON('users.json')?.users || [],
      readJSON('blogs.json')?.blogs || []
    )
  },
  {
    name: 'Carts (Giỏ hàng)',
    aliases: ['cart', 'carts', 'giohang'],
    model: Cart,
    key: 'userId',
    getData: () => prepareCartFixtures(
      readJSON('carts.json'),
      readJSON('users.json')?.users || [],
      readJSON('products.json')?.products || []
    )
  },
  {
    name: 'Review Orders (Đơn hàng đã giao phục vụ đánh giá)',
    aliases: ['review-orders', 'review_orders'],
    model: Order,
    key: 'id',
    getData: () => prepareReviewFixtures(
      readJSON('review_orders.json'),
      readJSON('users.json')?.users || [],
      readJSON('products.json')?.products || []
    ).orders
  },
  {
    name: 'Reviews (Đánh giá sản phẩm)',
    aliases: ['review', 'reviews', 'danhgia'],
    model: Review,
    key: 'id',
    getData: () => prepareReviewFixtures(
      readJSON('review_orders.json'),
      readJSON('users.json')?.users || [],
      readJSON('products.json')?.products || []
    ).reviews
  }
];

async function syncModule(mod) {
  const docs = typeof mod.getData === 'function' ? await mod.getData() : null;
  if (!docs || !Array.isArray(docs) || docs.length === 0) {
    throw new Error(`[${mod.name}] Không có dữ liệu hợp lệ để tải lên.`);
  }

  const operations = docs.map((doc) => {
    const { _id, ...fields } = doc;
    const update = { $set: fields };
    if (_id !== undefined) update.$setOnInsert = { _id };

    return {
      updateOne: {
        filter: mod.filter ? mod.filter(doc) : { [mod.key]: doc[mod.key] },
        update,
        upsert: true
      }
    };
  });

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

  if (mod.model === Review) {
    await syncAllProductRatings({ ReviewModel: Review, ProductModel: Product });
  }
}

async function syncJsonFile(fileName) {
  const collectionName = path.basename(fileName).replace(/\.json$/i, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(collectionName)) {
    throw new Error(`[${fileName}] Tên file không hợp lệ để dùng làm tên collection.`);
  }

  const docs = getJsonRecords(fileName);
  if (docs.length === 0 || docs.some((doc) => !doc || typeof doc !== 'object' || Array.isArray(doc))) {
    throw new Error(`[${fileName}] Không có danh sách object hợp lệ để tải lên.`);
  }

  const collection = mongoose.connection.collection(collectionName);
  const operations = docs.map((doc, index) => {
    const { _id, ...fields } = doc;
    const id = _id ?? `${collectionName}:${doc.id ?? doc.slug ?? doc.email ?? doc.code ?? index}`;
    return {
      updateOne: {
        filter: { _id: id },
        update: { $set: fields },
        upsert: true
      }
    };
  });

  const result = await collection.bulkWrite(operations, { ordered: false });
  const inserted = result.upsertedCount || 0;
  const modified = result.modifiedCount || 0;
  const matched = result.matchedCount || 0;
  const totalOnAtlas = await collection.countDocuments();

  if (inserted > 0) {
    console.log(`✨ [${fileName}]: ĐÃ THÊM MỚI ${inserted} bản ghi! (Tổng hiện có: ${totalOnAtlas})`);
  } else if (modified > 0) {
    console.log(`🔄 [${fileName}]: Đã cập nhật ${modified} bản ghi thay đổi. (Tổng hiện có: ${totalOnAtlas})`);
  } else {
    console.log(`✔️  [${fileName}]: Đã đồng bộ, không có mục mới (${matched} bản ghi giữ nguyên).`);
  }
}

async function main() {
  const targetArg = process.argv[2]?.trim();
  const normalizedTarget = targetArg ? normalizeTarget(targetArg) : '';
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
  let additionalFiles = [];
  if (targetArg && normalizedTarget !== 'all') {
    targets = MODULES.filter((mod) => isModuleFile(mod, targetArg));
    if (targets.length === 0) {
      const fileName = `${path.basename(targetArg).replace(/\.json$/i, '')}.json`;
      if (fs.existsSync(path.join(__dirname, 'data', fileName))) {
        additionalFiles = [fileName];
      } else {
        console.log(`⚠️  Không tìm thấy module hoặc file JSON "${targetArg}".`);
        console.log('👉 Dùng tên module hoặc tên file trong thư mục data (có hoặc không có .json), hoặc bỏ tham số để sync tất cả.\n');
        await mongoose.disconnect();
        return;
      }
    }
  } else if (normalizedTarget === 'all' || !normalizedTarget) {
    additionalFiles = fs.readdirSync(path.join(__dirname, 'data'))
      .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
      .filter((fileName) => !MODULES.some((mod) => isModuleFile(mod, fileName)));
  }

  if (targets.length === 0 && additionalFiles.length === 0) {
    console.log('⚠️  Không có dữ liệu nào để đồng bộ.\n');
    await mongoose.disconnect();
    return;
  }

  console.log(`📦 Bắt đầu kiểm tra và tải dữ liệu mới lên MongoDB Atlas...\n`);
  try {
    for (const mod of targets) {
      await syncModule(mod);
    }
    for (const fileName of additionalFiles) {
      await syncJsonFile(fileName);
    }

    console.log('\n====================================================');
    console.log('🎉 ĐỒNG BỘ HOÀN TẤT! DỮ LIỆU ĐÃ SẴN SÀNG TRÊN MONGO ATLAS.');
    console.log('====================================================');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ Lỗi tiến trình upload:', err);
  process.exit(1);
});
