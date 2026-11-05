const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'images', 'uploads');

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function saveImageBuffer(buffer, mimeType) {
  const ext = MIME_TO_EXT[String(mimeType || '').toLowerCase()];
  if (!ext) {
    throw new Error('Định dạng ảnh không được hỗ trợ (chỉ nhận PNG, JPG, WEBP, GIF).');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Kích thước ảnh không hợp lệ (tối đa 8MB).');
  }
  ensureUploadDir();
  const fileName = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return `/images/uploads/${fileName}`;
}

function isDataImageUrl(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value.trim());
}

function saveDataUrlImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) {
    throw new Error('Dữ liệu ảnh base64 không hợp lệ.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  return saveImageBuffer(buffer, match[1]);
}

function parseMultipartImage(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : '';
  if (!boundary) {
    throw new Error('Thiếu boundary trong multipart/form-data.');
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from('\r\n\r\n');
  let searchIndex = 0;

  while (searchIndex < buffer.length) {
    const partStart = buffer.indexOf(delimiter, searchIndex);
    if (partStart === -1) break;
    const contentStart = partStart + delimiter.length;
    if (buffer.subarray(contentStart, contentStart + 2).equals(Buffer.from('--'))) {
      break;
    }
    const headersStart = contentStart + (buffer.subarray(contentStart, contentStart + 2).equals(Buffer.from('\r\n')) ? 2 : 0);
    const headersEnd = buffer.indexOf(headerSeparator, headersStart);
    if (headersEnd === -1) break;

    const rawHeaders = buffer.subarray(headersStart, headersEnd).toString('utf8');
    const bodyStart = headersEnd + headerSeparator.length;
    const nextPart = buffer.indexOf(delimiter, bodyStart);
    if (nextPart === -1) break;
    const bodyEnd = buffer.subarray(nextPart - 2, nextPart).equals(Buffer.from('\r\n')) ? nextPart - 2 : nextPart;

    const mimeMatch = /content-type:\s*([^\r\n;]+)/i.exec(rawHeaders);
    const filenameMatch = /filename="([^"]*)"/i.exec(rawHeaders);
    if (filenameMatch && mimeMatch) {
      return {
        buffer: buffer.subarray(bodyStart, bodyEnd),
        mimeType: mimeMatch[1].trim().toLowerCase()
      };
    }

    searchIndex = nextPart;
  }

  throw new Error('Không tìm thấy file ảnh trong dữ liệu tải lên.');
}

module.exports = {
  isDataImageUrl,
  saveDataUrlImage,
  saveImageBuffer,
  parseMultipartImage
};
