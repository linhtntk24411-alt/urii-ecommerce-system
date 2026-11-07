const express = require('express');
const {
  isDataImageUrl,
  saveDataUrlImage,
  saveImageBuffer,
  parseMultipartImage
} = require('../utils/imageUpload');

const router = express.Router();
const MAX_STREAM_BYTES = 10 * 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_STREAM_BYTES) {
        reject(new Error('Request vượt quá dung lượng cho phép.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleImageUpload(req, res) {
  try {
    const contentType = String(req.get?.('content-type') || req.headers?.['content-type'] || '').toLowerCase();

    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      const candidate = req.body.image || req.body.imageUrl || req.body.dataUrl || req.body.file;
      if (isDataImageUrl(candidate)) {
        const imageUrl = saveDataUrlImage(candidate);
        res.status(201).json({ imageUrl, url: imageUrl });
        return;
      }
    }

    if (contentType.startsWith('multipart/form-data')) {
      const rawBuffer = Buffer.isBuffer(req.body) ? req.body : await readRawBody(req);
      const { buffer, mimeType } = parseMultipartImage(rawBuffer, contentType);
      const imageUrl = saveImageBuffer(buffer, mimeType);
      res.status(201).json({ imageUrl, url: imageUrl });
      return;
    }

    if (/^image\/(?:png|jpe?g|webp|gif)\b/.test(contentType)) {
      const rawBuffer = Buffer.isBuffer(req.body) ? req.body : await readRawBody(req);
      const mimeType = contentType.split(';')[0].trim();
      const imageUrl = saveImageBuffer(rawBuffer, mimeType);
      res.status(201).json({ imageUrl, url: imageUrl });
      return;
    }

    res.status(400).json({
      message: 'Vui lòng tải lên file ảnh (multipart/form-data) hoặc gửi dữ liệu ảnh base64 (data:image/...).'
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Không thể tải ảnh lên.' });
  }
}

router.post('/', handleImageUpload);

module.exports = router;
module.exports.handleImageUpload = handleImageUpload;
