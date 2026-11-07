require('dotenv').config();

const mongoose = require('mongoose');

async function migrateCustomOrderCollection() {
  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((collection) => collection.name));
  const legacyNames = ['customerorders', 'customorders'].filter((name) => names.has(name));
  if (legacyNames.length === 0) {
    console.log('Không có collection custom order cũ cần chuyển đổi.');
    return;
  }

  if (!names.has('custom_orders')) {
    await db.createCollection('custom_orders');
  }

  const target = db.collection('custom_orders');
  let migrated = 0;
  for (const legacyName of legacyNames) {
    const legacy = db.collection(legacyName);
    const documents = await legacy.find({}).toArray();
    if (documents.some((document) => !document.id)) {
      throw new Error(`Collection ${legacyName} có bản ghi thiếu id; không xóa collection.`);
    }

    if (documents.length > 0) {
      const operations = documents.map((document) => {
        const { _id, ...customOrder } = document;
        return {
          updateOne: {
            filter: { id: customOrder.id },
            update: { $setOnInsert: customOrder },
            upsert: true
          }
        };
      });
      await target.bulkWrite(operations, { ordered: true });

      const migratedIds = new Set(
        await target.distinct('id', { id: { $in: documents.map((document) => document.id) } })
      );
      if (migratedIds.size !== documents.length) {
        throw new Error(`Không xác minh đủ dữ liệu từ ${legacyName}; không xóa collection.`);
      }
    }

    await legacy.drop();
    migrated += documents.length;
    console.log(`Đã xác minh và xóa collection cũ ${legacyName} (${documents.length} bản ghi).`);
  }

  console.log(`Hoàn tất: ${migrated} bản ghi cũ đã được hợp nhất vào custom_orders.`);
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  await migrateCustomOrderCollection();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Không thể chuyển collection custom order:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = { migrateCustomOrderCollection };
