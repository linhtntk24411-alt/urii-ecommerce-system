require('dotenv').config();

const mongoose = require('mongoose');

async function migrateGalleryCollection() {
  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((collection) => collection.name));
  if (!names.has('samplemaps')) {
    console.log('Không có collection samplemaps cũ cần chuyển đổi.');
    return;
  }

  if (!names.has('gallery')) {
    await db.createCollection('gallery');
  }

  const legacy = db.collection('samplemaps');
  const documents = await legacy.find({}).toArray();
  if (documents.some((document) => !document.map_id)) {
    throw new Error('Collection samplemaps có bản ghi thiếu map_id; không xóa collection.');
  }

  if (documents.length > 0) {
    const operations = documents.map((document) => {
      const { _id, ...galleryItem } = document;
      return {
        updateOne: {
          filter: { map_id: galleryItem.map_id },
          update: { $setOnInsert: galleryItem },
          upsert: true
        }
      };
    });
    await db.collection('gallery').bulkWrite(operations, { ordered: true });

    const migratedIds = new Set(
      await db.collection('gallery').distinct('map_id', {
        map_id: { $in: documents.map((document) => document.map_id) }
      })
    );
    if (migratedIds.size !== documents.length) {
      throw new Error('Không xác minh đủ dữ liệu gallery; không xóa collection samplemaps.');
    }
  }

  await legacy.drop();
  console.log(`Đã xác minh ${documents.length} bản ghi trong gallery và xóa collection samplemaps cũ.`);
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  await migrateGalleryCollection();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Không thể chuyển collection gallery:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = { migrateGalleryCollection };
