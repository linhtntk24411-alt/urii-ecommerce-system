const Notification = require('../models/Notification');
const ChatSession = require('../models/ChatSession');
const ChatbotFaq = require('../models/ChatbotFaq');
const User = require('../models/User');
const mongoose = require('mongoose');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange, emitToSession } = require('../realtime');
const { createUserNotification } = require('../utils/userNotificationHelper');
const { generateAiReply } = require('../services/aiChatService');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const yauzl = require('yauzl');

const CHAT_FILE_DIR = path.join(__dirname, '..', 'private', 'chat-attachments');
const MAX_CHAT_FILE = 10 * 1024 * 1024;
let attachmentRequests = 0;

exports.attachmentSlot = (req, res, next) => {
  if (attachmentRequests >= 2) return res.status(429).json({ message: 'Đang xử lý file khác. Vui lòng thử lại.' });
  attachmentRequests++;
  let released = false;
  const release = () => { if (!released) { released = true; attachmentRequests--; } };
  res.once('finish', release); res.once('close', release);
  next();
};

// Inspect OOXML in memory, never extract client-controlled paths onto disk.
function inspectOffice(buffer, extension) {
  return new Promise((resolve, reject) => {
    let zip; let settled = false; let count = 0; let expanded = 0;
    const names = new Set(); const xml = new Map();
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); zip?.close(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('Kiểm tra tài liệu quá thời gian.')), 5000);
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (settled) { archive?.close(); return; }
      if (error) return finish(new Error('Tài liệu Office không hợp lệ.'));
      zip = archive;
      zip.on('error', () => finish(new Error('Không thể đọc cấu trúc tài liệu.')));
      zip.on('entry', entry => {
        if (settled) return;
        const name = entry.fileName;
        if (++count > 1000 || names.has(name.toLowerCase()) || /(^\/|\\|:|(?:^|\/)\.\.(?:\/|$))/.test(name) ||
            (entry.generalPurposeBitFlag & 1) || ![0, 8].includes(entry.compressionMethod) ||
            entry.uncompressedSize > MAX_CHAT_FILE || expanded + entry.uncompressedSize > 50 * 1024 * 1024 ||
            /(?:vba|activex|embeddings|externallinks|connections\.xml|\.(?:exe|dll|com|scr|bat|cmd|msi|js|vbs|ps1|html?|hta|jar|zip|bin)$)/i.test(name)) {
          return finish(new Error('Tài liệu có nội dung nhúng, mã hóa hoặc vượt giới hạn kiểm tra.'));
        }
        names.add(name.toLowerCase());
        if (name.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (settled) { stream?.destroy(); return; }
          if (error) return finish(new Error('Không thể giải nén tài liệu.'));
          let bytes = 0; const chunks = []; const isXml = /\.(?:xml|rels)$/i.test(name);
          stream.on('data', chunk => {
            bytes += chunk.length; expanded += chunk.length;
            if (bytes > MAX_CHAT_FILE || expanded > 50 * 1024 * 1024) { stream.destroy(); finish(new Error('Tài liệu giải nén vượt giới hạn.')); return; }
            if (isXml) chunks.push(chunk);
          });
          stream.on('error', () => finish(new Error('Dữ liệu nén bị lỗi.')));
          stream.on('end', () => {
            if (settled) return;
            if (isXml) {
              let text;
              try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
              catch { return finish(new Error('XML tài liệu không được hỗ trợ.')); }
              // Conservative screening, not an XML sanitizer or malware scanner.
              if (!text.trim().startsWith('<') || /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|DDEAUTO|DDELINK|macroEnabled|vbaProject|<\s*(?:\w+:)?(?:oleObject|altChunk)\b/i.test(text)) {
                return finish(new Error('Tài liệu có liên kết ngoài hoặc nội dung chủ động không hỗ trợ.'));
              }
              if (['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'xl/workbook.xml'].includes(name)) xml.set(name, text);
            }
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        const main = extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
        const expected = extension === 'docx' ? 'wordprocessingml.document.main+xml' : 'spreadsheetml.sheet.main+xml';
        if (!xml.has(main) || !xml.has('_rels/.rels') || !xml.get('[Content_Types].xml')?.includes(expected)) return finish(new Error('Không đúng cấu trúc DOCX/XLSX.'));
        finish();
      });
      zip.readEntry();
    });
  });
}

async function validateAttachment(buffer, name, kind) {
  const ext = name.split('.').pop().toLowerCase();
  const allowed = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain' };
  if (!allowed[ext] || !['image', 'file'].includes(kind) || (kind === 'image') !== ['jpg', 'jpeg', 'png'].includes(ext)) throw new Error('Loại file không được hỗ trợ.');
  let output = buffer;
  if (kind === 'image') {
    const image = sharp(buffer, { limitInputPixels: 20000000, failOn: 'warning', pages: 1 });
    const meta = await image.metadata();
    if ((ext === 'png' ? meta.format !== 'png' : meta.format !== 'jpeg') || (meta.pages || 1) !== 1) throw new Error('Nội dung không đúng định dạng ảnh.');
    output = await (ext === 'png' ? image.png() : image.jpeg({ quality: 90 })).timeout({ seconds: 5 }).toBuffer();
  } else if (ext === 'txt') {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (buffer.includes(0) || buffer.some(byte => byte < 32 && ![9, 10, 13].includes(byte))) throw new Error('TXT chứa dữ liệu nhị phân.');
  } else if (ext === 'pdf') {
    const text = buffer.toString('latin1');
    if (!/^%PDF-1\.[0-7]\b|^%PDF-2\.0\b/.test(text) || !/%%EOF\s*$/.test(text) || !/\b(?:xref|startxref)\b/.test(text) ||
        /\/(?:Encrypt|JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|XFA)\b/.test(text)) throw new Error('PDF không hợp lệ hoặc chứa nội dung chủ động không hỗ trợ.');
  } else await inspectOffice(buffer, ext);
  if (output.length > MAX_CHAT_FILE) throw new Error('File sau xử lý vượt 10 MB.');
  return { buffer: output, mime: allowed[ext] };
}

exports.uploadAttachment = async (req, res) => {
  let temporary; let stored; let databaseAttempted = false;
  const discard = file => file ? fs.unlink(file).catch(() => {}) : Promise.resolve();
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'Cần gửi một file binary.' });
    if (req.body.length > MAX_CHAT_FILE) return res.status(413).json({ message: 'File vượt 10 MB.' });
    const requestId = req.get('X-Client-Request-Id'); const kind = req.get('X-File-Kind');
    const rawName = decodeURIComponent(req.get('X-File-Name') || '');
    if (!requestId || !/^[a-zA-Z0-9-]{16,100}$/.test(requestId) || !rawName || rawName.length > 180 || /[\\/:\x00-\x1f\x7f]/.test(rawName)) throw new Error('Tên file hoặc mã yêu cầu không hợp lệ.');
    const name = rawName.normalize('NFC'); const sourceHash = createHash('sha256').update(req.body).digest('hex');
    const same = message => message.type === kind && message.attachment?.sourceHash === sourceHash && message.attachment?.name === name;
    const session = await ChatSession.findOne({ sessionId: req.params.id }).select('+messages.attachment.storageKey +messages.attachment.sourceHash');
    if (!session) return res.status(404).json({ message: 'Không tìm thấy hội thoại.' });
    const previous = session.messages.find(m => m.clientRequestId === requestId && m.senderId === req.reactionActor);
    if (previous) return res.status(same(previous) ? 200 : 409).json(same(previous) ? { acceptedMessage: publicMessage(previous), duplicate: true } : { message: 'Mã yêu cầu đã dùng cho nội dung khác.' });
    const validated = await validateAttachment(req.body, name, kind);
    await fs.mkdir(CHAT_FILE_DIR, { recursive: true });
    const storageKey = randomUUID() + '.bin'; stored = path.join(CHAT_FILE_DIR, storageKey); temporary = stored + '.part';
    await fs.writeFile(temporary, validated.buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, stored); temporary = undefined;
    const sender = req.auth?.role === 'admin' ? 'admin' : 'user';
    const message = { messageId: randomUUID(), clientRequestId: requestId, senderId: req.reactionActor, sender,
      type: kind, text: kind === 'image' ? '[Ảnh]' : '[File đính kèm]', timestamp: Date.now(), isSystemLog: false,
      attachment: { name, mime: validated.mime, size: validated.buffer.length, sourceHash, storageKey } };
    databaseAttempted = true;
    const result = await ChatSession.findOneAndUpdate({ sessionId: req.params.id, messages: { $not: { $elemMatch: { clientRequestId: requestId, senderId: req.reactionActor } } } }, {
      $push: { messages: message }, $set: { lastMessageTime: message.timestamp, ...(sender === 'admin' ? { status: 'active', unreadCount: 0 } : {}) },
      ...(sender === 'user' ? { $inc: { unreadCount: 1 } } : {})
    }, { new: true, runValidators: true });
    if (!result) {
      const fresh = await ChatSession.findOne({ sessionId: req.params.id }).select('+messages.attachment.sourceHash');
      const accepted = fresh?.messages.find(m => m.clientRequestId === requestId && m.senderId === req.reactionActor);
      await discard(stored); stored = undefined;
      if (!accepted || !same(accepted)) return res.status(409).json({ message: 'Mã yêu cầu đã dùng cho nội dung khác.' });
      return res.json({ acceptedMessage: publicMessage(accepted), duplicate: true });
    }
    emitCrudChange('chat', 'message', req.params.id);
    res.set('Cache-Control', 'private, no-store');
    res.json({ acceptedMessage: publicMessage(result.messages.find(m => m.messageId === message.messageId)) });
  } catch (error) {
    // An ambiguous MongoDB outcome may already have committed: retain the final file.
    if (!databaseAttempted) await discard(stored);
    res.status(databaseAttempted ? 503 : 400).json({ message: databaseAttempted ? 'Chưa xác nhận được kết quả. Hãy gửi lại cùng file để đối chiếu.' : error.message || 'Không thể nhận file.' });
  } finally { await discard(temporary); }
};

exports.getAttachment = async (req, res, next) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id }).select('+messages.attachment.storageKey');
    const message = session?.messages.find(m => m.messageId === req.params.messageId);
    const file = message?.attachment;
    if (!message || message.recalledAt || !['image', 'file'].includes(message.type) || !file || !/^[a-f0-9-]{36}\.bin$/.test(file.storageKey || '')) return res.status(404).json({ message: 'File không còn khả dụng.' });
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': file.mime });
    res.set('Content-Disposition', `${message.type === 'image' ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`);
    res.sendFile(path.join(CHAT_FILE_DIR, file.storageKey), error => {
      if (error && !res.headersSent) res.status(404).json({ message: 'Không tìm thấy file.' });
      else if (error) next(error);
    });
  } catch (error) { next(error); }
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const reactionEmojis = ['❤️', '😂', '😮', '😢', '😡', '👍'];
const stickerIcons = ['🥰', '🥹', '😭', '😍', '😘', '🫶', '💗', '🎉', '👍', '👋'];

function publicMessage(value) {
  const message = value.toObject ? value.toObject() : { ...value };
  delete message.reactions;
  delete message.forwardRequestKey;
  delete message.forwardSourceKey;
  if (message.attachment) {
    const { name, mime, size } = message.attachment;
    message.attachment = { name, mime, size };
  }
  if (!message.recalledAt) return message;
  // Keep the database record for audit, but never return the original content.
  return {
    messageId: message.messageId, clientRequestId: message.clientRequestId,
    senderId: message.senderId, sender: message.sender, timestamp: message.timestamp,
    isSystemLog: message.isSystemLog, recalledAt: message.recalledAt,
    recalledBy: message.recalledBy, text: 'Tin nhắn đã được thu hồi'
  };
}

exports.recallMessage = async (req, res) => {
  const messageId = req.params.messageId;
  const message = req.chatSession.messages.find(m => m.messageId === messageId);
  const sender = req.auth?.role === 'admin' ? 'admin' : 'user';
  if (!message || !messageId || message.isSystemLog || message.sender !== sender || message.senderId !== req.reactionActor) {
    return res.status(403).json({ message: 'Bạn chỉ được thu hồi tin nhắn của chính mình có mã server hợp lệ.' });
  }
  if (message.recalledAt) return res.json({ message: publicMessage(message) });
  const session = await ChatSession.findOneAndUpdate({ sessionId: req.params.id, messages: { $elemMatch: {
    messageId, senderId: req.reactionActor, sender, isSystemLog: { $ne: true }, recalledAt: null
  } } }, { $set: { 'messages.$.recalledAt': Date.now(), 'messages.$.recalledBy': req.reactionActor } }, { new: true, runValidators: true });
  // A concurrent repeat must return the same tombstone, without changing its time.
  const saved = session || await ChatSession.findOne({ sessionId: req.params.id });
  const recalled = saved?.messages.find(m => m.messageId === messageId && m.senderId === req.reactionActor && m.sender === sender);
  if (!recalled?.recalledAt) return res.status(409).json({ message: 'Không thể xác nhận trạng thái thu hồi. Vui lòng tải lại.' });
  if (session) emitCrudChange('chat', 'recall', req.params.id);
  res.set('Cache-Control', 'private, no-store');
  res.json({ message: publicMessage(recalled) });
};

// A session ID or a submitted email is never proof of ownership.
exports.chatIdentity = (req, res, next) => {
  const cookie = /(?:^|;\s*)urii_reaction_guest=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  req.reactionGuestHash = cookie ? createHash('sha256').update(cookie[1]).digest('hex') : '';
  req.reactionActor = req.auth?.id ? `account:${req.auth.id}` : (req.reactionGuestHash ? `guest:${req.reactionGuestHash}` : '');
  next();
};

function ownsChat(req, session) {
  if (req.auth?.role === 'admin') return true;
  if (session.reactionOwnerId) return session.reactionOwnerId === req.reactionActor;
  if (session.userId) return String(session.userId) === String(req.auth?.id || '');
  return Boolean(session.reactionGuestHash && session.reactionGuestHash === req.reactionGuestHash);
}

exports.requireChatOwner = async (req, res, next) => {
  try {
    const id = req.params.id || req.body?.sessionId;
    const session = await ChatSession.findOne({ sessionId: id }).select('+reactionOwnerId +reactionGuestHash');
    if (!session) return res.status(404).json({ message: 'Không tìm thấy phiên trò chuyện.' });
    if (!req.reactionActor || !ownsChat(req, session)) return res.status(403).json({ message: 'Bạn không có quyền truy cập phiên trò chuyện này.' });
    req.chatSession = session;
    next();
  } catch (error) { next(error); }
};

exports.prepareReactionSession = async (req, res) => {
  const id = req.params.id;
  if (!id || id.length > 150) return res.status(400).json({ message: 'Mã phiên không hợp lệ.' });
  if (!req.reactionActor) {
    const secret = randomBytes(32).toString('hex');
    req.reactionGuestHash = createHash('sha256').update(secret).digest('hex');
    req.reactionActor = `guest:${req.reactionGuestHash}`;
    res.cookie('urii_reaction_guest', secret, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api', maxAge: 365 * 86400000 });
  }
  // Atomic set-on-insert preserves legacy records and never claims them.
  const session = await ChatSession.findOneAndUpdate({ sessionId: id }, { $setOnInsert: {
    sessionId: id, userName: String(req.body?.userName || 'Khách vãng lai').slice(0, 100),
    userEmail: String(req.body?.userEmail || '').slice(0, 254),
    ...(req.auth?.id ? { userId: req.auth.id, reactionOwnerId: req.reactionActor } : { reactionGuestHash: req.reactionGuestHash }),
    messages: [], status: 'ai', unreadCount: 0, lastMessageTime: Date.now()
  } }, { upsert: true, new: true, runValidators: true }).select('+reactionOwnerId +reactionGuestHash');
  if (!ownsChat(req, session)) return res.status(403).json({ message: 'Phiên cũ chưa có bằng chứng quyền sở hữu; lịch sử được giữ nguyên.' });
  res.json({ actor: req.reactionActor });
};

exports.getReactions = async (req, res) => {
  const session = await ChatSession.findOne({ sessionId: req.params.id }).select('+messages.reactions').lean();
  if (!session) return res.status(404).json({ message: 'Không tìm thấy phiên trò chuyện.' });
  const reactions = {};
  const messages = (session.messages || []).filter(m => m.messageId).map(m => {
    reactions[m.messageId] = m.recalledAt ? [] : m.reactions || [];
    return publicMessage(m);
  });
  res.set('Cache-Control', 'private, no-store');
  res.json({ actor: req.reactionActor, reactions, messages, status: session.status, updatedAt: session.updatedAt });
};

exports.setReaction = async (req, res) => {
  const { emoji } = req.body || {};
  if (emoji !== null && !reactionEmojis.includes(emoji)) return res.status(400).json({ message: 'Cảm xúc không hợp lệ.' });
  const messageId = req.params.messageId;
  // Update only the current actor within the matched message, atomically.
  const retained = { $filter: { input: { $ifNull: ['$$m.reactions', []] }, as: 'r', cond: { $ne: ['$$r.actor', req.reactionActor] } } };
  const session = await ChatSession.findOneAndUpdate({ sessionId: req.params.id, messages: { $elemMatch: { messageId, isSystemLog: { $ne: true }, recalledAt: null } } }, [{ $set: {
    messages: { $map: { input: '$messages', as: 'm', in: { $cond: [
      { $and: [{ $eq: ['$$m.messageId', messageId] }, { $eq: [{ $ifNull: ['$$m.recalledAt', null] }, null] }] },
      { $mergeObjects: ['$$m', { reactions: { $concatArrays: [retained, emoji === null ? [] : [{ actor: req.reactionActor, emoji }]] } }] }, '$$m'
    ] } } }
  } }], { new: true, updatePipeline: true }).select('+messages.reactions');
  if (!session) return res.status(req.chatSession.messages.some(m => m.messageId === messageId) ? 409 : 404).json({ message: 'Tin nhắn chưa có mã server, đã thu hồi hoặc không hỗ trợ reaction.' });
  emitCrudChange('chat', 'reaction', req.params.id);
  res.json({ messageId, reactions: session.messages.find(m => m.messageId === messageId).reactions || [] });
};

exports.forwardMessage = async (req, res) => {
  const { targetSessionId, clientRequestId } = req.body || {};
  const sourceId = req.params.id;
  const messageId = req.params.messageId;
  if (req.auth?.role !== 'admin' || !req.auth.id || req.reactionActor !== `account:${req.auth.id}`) return res.status(403).json({ message: 'Chỉ Admin được chuyển tiếp tin nhắn.' });
  if (typeof targetSessionId !== 'string' || !targetSessionId || targetSessionId.length > 150 || targetSessionId === sourceId ||
      typeof clientRequestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(clientRequestId)) {
    return res.status(400).json({ message: 'Hội thoại đích hoặc mã yêu cầu không hợp lệ.' });
  }
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const requestKey = createHash('sha256').update(JSON.stringify([req.reactionActor, clientRequestId])).digest('hex');
  const sourceKey = createHash('sha256').update(JSON.stringify([sourceId, messageId, targetSessionId])).digest('hex');
  let transaction;
  let result;
  let duplicate = false;
  try {
    // Check the actual deployment, not merely whether Mongoose exposes a session API.
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    const supported = hello?.logicalSessionTimeoutMinutes != null &&
      ((hello.setName && hello.maxWireVersion >= 7) || (hello.msg === 'isdbgrid' && hello.maxWireVersion >= 8));
    if (!supported) throw fail(503, 'MongoDB chưa xác nhận hỗ trợ transaction. Chuyển tiếp đã bị dừng, không có dữ liệu nào được ghi.');
    transaction = await mongoose.startSession();
    await transaction.withTransaction(async () => {
      result = undefined; duplicate = false;
      const target = await ChatSession.findOne({ sessionId: targetSessionId }).session(transaction)
        .select('+reactionOwnerId +reactionGuestHash +messages.forwardRequestKey +messages.forwardSourceKey');
      if (!target) throw fail(404, 'Không tìm thấy hội thoại đích.');
      if (!ownsChat(req, target)) throw fail(403, 'Không có quyền truy cập hội thoại đích.');
      const previous = target.messages.find(m => m.forwardRequestKey === requestKey);
      if (previous) {
        if (previous.forwardSourceKey !== sourceKey) throw fail(409, 'Mã yêu cầu đã được dùng cho một thao tác khác.');
        result = publicMessage(previous); duplicate = true; return;
      }
      // A real write lock serializes this operation against recall. Only the session
      // version changes: original messages, unread, status and conversation time stay intact.
      const source = await ChatSession.findOneAndUpdate({ sessionId: sourceId, messages: { $elemMatch: {
        messageId, sender: { $in: ['admin', 'user'] }, type: { $in: [null, 'text'] }, isSystemLog: { $ne: true }, recalledAt: null
      } } }, { $inc: { __v: 1 } }, { new: true, session: transaction, timestamps: false })
        .select('+reactionOwnerId +reactionGuestHash');
      if (!source) throw fail(409, 'Tin nhắn nguồn chưa lưu trên server, đã thu hồi hoặc không được phép chuyển tiếp.');
      if (!ownsChat(req, source)) throw fail(403, 'Không có quyền truy cập hội thoại nguồn.');
      const original = source.messages.find(m => m.messageId === messageId);
      const message = {
        messageId: randomUUID(), clientRequestId: `forward-${clientRequestId}`, sender: 'admin', senderId: req.reactionActor,
        text: original.text, type: 'text', timestamp: Date.now(), isSystemLog: false, forwarded: true,
        forwardRequestKey: requestKey, forwardSourceKey: sourceKey
      };
      const updated = await ChatSession.findOneAndUpdate({ sessionId: targetSessionId, messages: { $not: { $elemMatch: { forwardRequestKey: requestKey } } } }, {
        $push: { messages: message }, $set: { lastMessageTime: message.timestamp }
      }, { new: true, runValidators: true, session: transaction });
      // Forwarding is neither a takeover nor a read receipt.
      if (!updated) throw fail(409, 'Hội thoại đích đã thay đổi. Vui lòng thử lại cùng yêu cầu.');
      result = publicMessage(message);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    if (!duplicate) emitCrudChange('chat', 'message', targetSessionId);
    res.set('Cache-Control', 'private, no-store');
    res.json({ message: result, duplicate });
  } catch (error) {
    const unsupported = error.code === 20 || error.codeName === 'IllegalOperation';
    res.status(error.status || 503).json({ message: error.status ? error.message : unsupported
      ? 'Database không hỗ trợ transaction cho thao tác này. Chuyển tiếp đã bị dừng.'
      : 'Không thể hoàn tất transaction chuyển tiếp. Vui lòng thử lại cùng yêu cầu.' });
  } finally { if (transaction) await transaction.endSession(); }
};

function faqFilter(value) {
  const filters = [{ id: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

async function enrichSessions(sessions) {
  const userIds = [...new Set(sessions.map((s) => s.userId).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name email avatar').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  return sessions.map((session) => {
    const user = session.userId ? usersById.get(String(session.userId)) : null;
    return {
      ...session,
      userName: session.userName || user?.name || 'Khách vãng lai',
      userEmail: session.userEmail || user?.email || '',
      avatar: session.avatar || user?.avatar || 'images/avatar_user.jpeg'
    };
  }).map(session => {
    delete session.reactionOwnerId;
    delete session.reactionGuestHash;
    session.messages = (session.messages || []).map(publicMessage);
    return session;
  });
}

// Lấy danh sách tất cả các phiên chat (hỗ trợ lọc status & tìm kiếm)
exports.getAllSessions = async (req, res) => {
  try {
    const { status, q } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    const rawSessions = await ChatSession.find(filter).sort({ lastMessageTime: -1 }).lean();
    let sessions = await enrichSessions(rawSessions);

    if (q) {
      const needle = String(q).toLowerCase().trim();
      sessions = sessions.filter((s) => (
        (s.userName && s.userName.toLowerCase().includes(needle))
        || (s.userEmail && s.userEmail.toLowerCase().includes(needle))
        || (s.messages || []).some((m) => m.text && m.text.toLowerCase().includes(needle))
      ));
    }

    // Map dạng object { [sessionId]: session } tương thích cho SupportAdmin & client
    const sessionMap = {};
    for (const s of sessions) {
      sessionMap[s.sessionId] = s;
    }

    res.set('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      count: sessions.length,
      sessions,
      sessionMap
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách chat sessions:', error);
    res.status(500).json({ message: 'Không thể tải danh sách phiên chat.' });
  }
};

// Lấy chi tiết một phiên chat theo sessionId
exports.getSessionById = async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id }).lean();
    if (!session) {
      return res.status(404).json({ message: 'Không tìm thấy phiên trò chuyện.' });
    }
    const [enriched] = await enrichSessions([session]);
    res.set('Cache-Control', 'private, no-store');
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi lấy phiên chat:', error);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
};

exports.updateSession = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu phiên chat không hợp lệ.' });
    return;
  }

  const allowedFields = [
    'userId',
    'userName',
    'userEmail',
    'avatar',
    'status',
    'unreadCount',
    'lastMessageTime'
  ];
  const updates = Object.fromEntries(
    allowedFields
      .filter((field) => Object.hasOwn(req.body, field))
      .map((field) => [field, req.body[field]])
  );
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: 'Không có trường phiên chat hợp lệ để cập nhật.' });
    return;
  }

  try {
    const session = await ChatSession.findOneAndUpdate(
      { sessionId: req.params.id },
      updates,
      { new: true, runValidators: true }
    );
    if (!session) {
      res.status(404).json({ message: 'Không tìm thấy phiên chat.' });
      return;
    }
    emitCrudChange('chat', 'update', session.sessionId);
    const [enriched] = await enrichSessions([session.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu phiên chat không hợp lệ.' });
      return;
    }
    console.error('Lỗi cập nhật phiên chat:', error);
    res.status(500).json({ message: 'Không thể cập nhật phiên chat.' });
  }
};

// Tạo mới hoặc cập nhật một phiên chat
exports.createOrUpdateSession = async (req, res) => {
  // Preserve the endpoint while preventing arbitrary sender/owner injection.
  req.params.id = req.body?.sessionId || `cs_${randomUUID()}`;
  if (req.body?.message) return res.status(400).json({ message: 'Gửi tin nhắn qua API messages để nhận messageId.' });
  return exports.prepareReactionSession(req, res);
};

// Gửi tin nhắn vào phiên chat
exports.addMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, sender, isSystemLog } = req.body;
    const type = req.body.type === undefined ? 'text' : req.body.type;
    // Older admin callers can still send once without supplying a retry key.
    const clientRequestId = req.body.clientRequestId || (req.auth?.role === 'admin' ? randomUUID() : undefined);

    if (typeof text !== 'string' || !text.trim() || text.length > 10000 || typeof clientRequestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(clientRequestId)) {
      return res.status(400).json({ message: 'Nội dung tin nhắn không được để trống.' });
    }
    if (!['text', 'sticker'].includes(type) || (type === 'sticker' && !stickerIcons.includes(text))) {
      return res.status(400).json({ message: 'Sticker không thuộc bộ 10 icon được hỗ trợ hoặc loại tin nhắn không hợp lệ.' });
    }

    const session = req.chatSession;
    if (!session) {
      session = new ChatSession({
        sessionId: id,
        userName: userName || 'Khách vãng lai',
        userEmail: userEmail || '',
        avatar: 'images/avatar_user.jpeg',
        status: sender === 'admin' ? 'active' : 'waiting',
        unreadCount: sender === 'admin' ? 0 : 1,
        lastMessageTime: Date.now(),
        messages: []
      });
    }

    const msgSender = req.auth?.role === 'admin' ? 'admin' : 'user';
    if ((sender && sender !== msgSender) || isSystemLog) return res.status(403).json({ message: 'Không được giả mạo người gửi.' });
    const message = {
      messageId: randomUUID(), clientRequestId, senderId: req.reactionActor,
      text: text.trim(), type,
      sender: msgSender,
      timestamp: Date.now(),
      isSystemLog: false
    };

    // The conditional push makes retries and concurrent copies idempotent.
    const result = await ChatSession.findOneAndUpdate({ sessionId: id, messages: { $not: { $elemMatch: { clientRequestId, senderId: req.reactionActor } } } }, {
      $push: { messages: message },
      $set: { lastMessageTime: Date.now(), ...(msgSender === 'admin' ? { status: 'active', unreadCount: 0 } : {}) },
      ...(msgSender === 'user' ? { $inc: { unreadCount: 1 } } : {})
    }, { new: true, runValidators: true });
    const saved = result || await ChatSession.findOne({ sessionId: id });
    const accepted = saved?.messages.find(m => m.clientRequestId === clientRequestId && m.senderId === req.reactionActor);
    if (!accepted) return res.status(409).json({ message: 'Không thể xác nhận tin nhắn.' });
    if (accepted.text !== text.trim() || (accepted.type || 'text') !== type) return res.status(409).json({ message: 'Mã yêu cầu đã được dùng cho tin nhắn khác hoặc khác loại.' });
    if (result) {
      emitCrudChange('chat', 'message', id);
      emitToSession(id, 'chat:message', { sessionId: id });
      const recipient = saved.userId || (req.chatSession.reactionOwnerId?.startsWith('account:') ? req.chatSession.reactionOwnerId.slice(8) : null);
      if (msgSender === 'admin' && recipient) {
        void createUserNotification({ userId: recipient,
          typeId: 'USER_CHAT_ADMIN_REPLIED', reference: { sessionId: id },
          title: 'Urii Support', message: 'Bạn có tin nhắn mới từ tư vấn viên.', actionUrl: '/support' });
      }
    }
    const [enriched] = await enrichSessions([saved.toObject()]);
    const acceptedMessage = publicMessage(accepted);
    res.json({ ...enriched, acceptedMessage });
  } catch (error) {
    console.error('Lỗi gửi tin nhắn:', error);
    res.status(500).json({ message: 'Không thể gửi tin nhắn.' });
  }
};

// Cập nhật trạng thái phiên chat (Takeover / Handback AI)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, systemLog } = req.body;

    if (!['ai', 'waiting', 'active'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ (ai, waiting, active).' });
    }

    const session = await ChatSession.findOne({ sessionId: id });
    if (!session) {
      return res.status(404).json({ message: 'Không tìm thấy phiên chat.' });
    }

    session.status = status;

    if (systemLog) {
      session.messages.push({
        text: systemLog,
        sender: status === 'ai' ? 'bot' : 'admin',
        timestamp: Date.now(),
        isSystemLog: true
      });
    }

    if (status === 'active') {
      session.unreadCount = 0;
      if (session.userId || session.userEmail) {
        createUserNotification({
          userId: session.userId,
          userEmail: session.userEmail,
          typeId: 'USER_CHAT_ADMIN_REPLIED',
          reference: { sessionId: session.sessionId },
          title: 'Tư vấn viên đã tiếp nhận hỗ trợ',
          message: `Nhân viên tư vấn đã bắt đầu tiếp quản phiên chat #${session.sessionId.slice(-6)} của bạn.`,
          actionUrl: '/support'
        }).catch(console.error);
      }
    }

    session.lastMessageTime = Date.now();
    await session.save();

    emitCrudChange('chat', 'status', session.sessionId);
    emitToSession(session.sessionId, 'chat:status', {
      sessionId: session.sessionId,
      status
    });
    const [enriched] = await enrichSessions([session.toObject()]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi cập nhật trạng thái chat:', error);
    res.status(500).json({ message: 'Không thể cập nhật trạng thái.' });
  }
};

// Xóa toàn bộ tin nhắn trong một phiên chat
exports.clearSessionMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await ChatSession.findOneAndUpdate(
      { sessionId: id },
      { $set: { messages: [], lastMessageTime: Date.now() } },
      { new: true }
    );
    if (!session) {
      return res.status(404).json({ message: 'Không tìm thấy phiên chat để xóa tin nhắn.' });
    }
    emitCrudChange('chat', 'update', id);
    res.json({ success: true, message: 'Đã xóa toàn bộ tin nhắn trong đoạn chat.', session });
  } catch (error) {
    console.error('Lỗi xóa tin nhắn trong phiên chat:', error);
    res.status(500).json({ message: 'Không thể xóa tin nhắn.' });
  }
};

// Xóa một phiên chat hoàn toàn
exports.deleteSession = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ChatSession.findOneAndDelete({ sessionId: id })
      || (mongoose.isValidObjectId(id) ? await ChatSession.findByIdAndDelete(id) : null);
    if (!deleted) {
      return res.status(404).json({ message: 'Không tìm thấy phiên chat để xóa.' });
    }
    emitCrudChange('chat', 'delete', id);
    res.json({ success: true, message: 'Đã xóa phiên chat thành công.' });
  } catch (error) {
    console.error('Lỗi xóa phiên chat:', error);
    res.status(500).json({ message: 'Không thể xóa phiên chat.' });
  }
};

// Lấy danh sách FAQ / Kịch bản phản hồi tự động của Bot
exports.getFaqs = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const faqs = await ChatbotFaq.find().sort({ id: 1 }).skip(skip).limit(limit).lean();
    res.json(faqs);
  } catch (error) {
    console.error('Lỗi lấy danh sách FAQ:', error);
    res.status(500).json({ message: 'Không thể tải kịch bản chatbot.' });
  }
};

exports.getFaqById = async (req, res) => {
  try {
    const faq = await ChatbotFaq.findOne(faqFilter(req.params.id)).lean();
    if (!faq) {
      res.status(404).json({ message: 'Không tìm thấy FAQ.' });
      return;
    }
    res.json(faq);
  } catch (error) {
    console.error('Lỗi tải FAQ:', error);
    res.status(500).json({ message: 'Không thể tải FAQ.' });
  }
};

exports.createFaq = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
    return;
  }

  try {
    const faq = await ChatbotFaq.create({
      ...req.body,
      id: req.body.id || `faq-${randomUUID()}`
    });
    emitCrudChange('chatbotFaqs', 'created', faq.id);
    res.status(201).json(faq);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã FAQ đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo FAQ:', error);
    res.status(500).json({ message: 'Không thể tạo FAQ.' });
  }
};

exports.updateFaq = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    const faq = await ChatbotFaq.findOneAndUpdate(faqFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!faq) {
      res.status(404).json({ message: 'Không tìm thấy FAQ.' });
      return;
    }
    emitCrudChange('chatbotFaqs', 'updated', faq.id);
    res.json(faq);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu FAQ không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã FAQ đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật FAQ:', error);
    res.status(500).json({ message: 'Không thể cập nhật FAQ.' });
  }
};

exports.deleteFaq = async (req, res) => {
  try {
    const faq = await ChatbotFaq.findOneAndDelete(faqFilter(req.params.id));
    if (!faq) {
      res.status(404).json({ message: 'Không tìm thấy FAQ.' });
      return;
    }
    emitCrudChange('chatbotFaqs', 'deleted', faq.id);
    res.json({ message: 'Đã xóa FAQ.' });
  } catch (error) {
    console.error('Lỗi xóa FAQ:', error);
    res.status(500).json({ message: 'Không thể xóa FAQ.' });
  }
};

function removeVietnameseTones(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

// Khớp câu hỏi của người dùng với kịch bản trả lời tự động (FAQ Matching)
exports.matchFaq = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ message: 'Vui lòng cung cấp nội dung truy vấn.' });
    }

    const q = query.toLowerCase().trim();
    const qNorm = removeVietnameseTones(q);
    const faqs = await ChatbotFaq.find().lean();

    let matchedFaq = null;
    let maxScore = 0;

    for (const faq of faqs) {
      let score = 0;
      for (const kw of faq.keywords || []) {
        const kwLower = kw.toLowerCase().trim();
        const kwNorm = removeVietnameseTones(kwLower);
        if (q === kwLower || qNorm === kwNorm) {
          score += 10;
        } else if (q.includes(kwLower) || qNorm.includes(kwNorm)) {
          score += kwNorm.length;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        matchedFaq = faq;
      }
    }

    if (matchedFaq && maxScore >= 3) {
      return res.json({
        matched: true,
        intent: matchedFaq.intent,
        response: matchedFaq.response,
        quickReplies: matchedFaq.quickReplies || []
      });
    }

    res.json({
      matched: false,
      intent: 'fallback',
      response: 'Dạ Urii đã ghi nhận câu hỏi của bạn. Bạn muốn tra cứu sản phẩm, đơn hàng hay cần gặp chuyên viên tư vấn trực tiếp ạ?',
      quickReplies: ['Tra cứu đơn hàng', 'Hướng dẫn làm hạt ủi', 'Mã giảm giá', 'Gặp tư vấn viên']
    });
  } catch (error) {
    console.error('Lỗi xử lý câu hỏi chatbot:', error);
    res.status(500).json({ message: 'Lỗi xử lý phản hồi tự động.' });
  }
};

// Trả lời câu hỏi linh hoạt bằng AI, tự động trỏ danh mục và hỗ trợ deep-linking
exports.askAi = async (req, res) => {
  try {
    const { message, history, context } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung câu hỏi.' });
    }

    const trimmedMsg = message.trim();
    const msgNorm = removeVietnameseTones(trimmedMsg);

    // Ưu tiên tra cứu trực tiếp các kịch bản FAQ do Admin cấu hình trong Database
    try {
      const faqs = await ChatbotFaq.find().lean();
      let bestFaq = null;
      let highestScore = 0;

      for (const faq of faqs) {
        let score = 0;
        for (const kw of faq.keywords || []) {
          const kwNorm = removeVietnameseTones(kw);
          if (msgNorm === kwNorm) {
            score += 15;
          } else if (msgNorm.includes(kwNorm)) {
            score += kwNorm.length >= 4 ? kwNorm.length : 3;
          }
        }
        if (score > highestScore) {
          highestScore = score;
          bestFaq = faq;
        }
      }

      if (bestFaq && highestScore >= 6) {
        const chips = (bestFaq.quickReplies || []).map((r) => {
          const label = typeof r === 'string' ? r : (r.label || '');
          const action = typeof r === 'string' ? r : (r.action || r.label || '');
          return { label, action };
        });

        let targetUrl = '';
        let targetLabel = '';
        if (bestFaq.intent === 'order_tracking') {
          targetUrl = '/orders';
          targetLabel = 'Đơn hàng của tôi';
        } else if (bestFaq.intent === 'colors_catalog') {
          targetUrl = '/products?category=BEADS';
          targetLabel = 'Xem bảng màu hạt';
        } else if (bestFaq.intent === 'custom_order') {
          targetUrl = '/custom-order';
          targetLabel = 'Đặt làm theo yêu cầu';
        } else if (bestFaq.intent === 'vouchers') {
          targetUrl = '/vouchers';
          targetLabel = 'Kho voucher của tôi';
        } else if (bestFaq.intent === 'perler_guide') {
          targetUrl = '/sample-maps';
          targetLabel = 'Thư viện map mẫu';
        }

        return res.json({
          success: true,
          reply: bestFaq.response,
          targetUrl,
          targetLabel,
          isWarning: false,
          chips
        });
      }
    } catch (faqErr) {
      console.warn('Lỗi tra cứu ChatbotFaq trong askAi:', faqErr.message);
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
    const aiResponse = await generateAiReply({
      message: trimmedMsg,
      history: Array.isArray(history) ? history : [],
      context: context || {},
      apiKey
    });

    res.json({
      success: true,
      ...aiResponse
    });
  } catch (error) {
    console.error('Lỗi API Chat AI:', error);
    res.status(500).json({ message: 'Không thể tạo phản hồi từ AI lúc này.' });
  }
};


// Khách hàng yêu cầu hỗ trợ từ Admin -> cập nhật status 'waiting' và tạo thông báo cho Admin
exports.requestAgent = async (req, res) => {
  try {
    const id = req.chatSession?.sessionId;
    if (!id) return res.status(403).json({ message: 'Forbidden' });
    const session = await ChatSession.findOneAndUpdate({ sessionId: id, status: { $ne: 'waiting' } }, {
      $set: { status: 'waiting', lastMessageTime: Date.now() }, $inc: { unreadCount: 1 }
    }, { new: true, runValidators: true });
    if (!session) return res.json({ success: true, status: 'waiting', sessionId: id });

    const notifId = `notif-chat-${Date.now()}`;
    const displayName = session.userName || session.userEmail || 'Khách vãng lai';

    const notifDoc = {
      id: notifId,
      audience: 'admin',
      typeId: 'ADMIN_CHAT_WAITING_SUPPORT',
      reference: { sessionId: session.sessionId },
      title: `Khách hàng chờ tư vấn #${session.sessionId.slice(-6)}`,
      message: `Khách hàng ${displayName} đang chờ hỗ trợ tư vấn trực tiếp.`,
      actionUrl: `/chatbot?sessionId=${session.sessionId}`,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.collection('admin_notifications').insertOne({ ...notifDoc });
      }
    } catch (notifColErr) {
      console.error('Lỗi lưu admin_notifications collection:', notifColErr);
    }

    try {
      if (mongoose.connection.readyState === 1) {
        await Notification.create(notifDoc);
      }
    } catch (notifErr) {
      console.warn('Lỗi Notification.create:', notifErr.message);
    }

    emitCrudChange('notifications', 'created', notifId);
    emitCrudChange('chat', 'status', session.sessionId);
    emitCrudChange('chat', 'message', session.sessionId);

    res.json({
      success: true,
      message: 'Đã gửi yêu cầu và thông báo đến Quản trị viên thành công.',
      status: 'waiting',
      sessionId: session.sessionId
    });
  } catch (error) {
    console.error('Lỗi khi gửi yêu cầu hỗ trợ tới admin:', error);
    res.status(500).json({ message: 'Không thể gửi yêu cầu hỗ trợ lúc này.' });
  }
};

// Khách hàng hủy yêu cầu hỗ trợ trực tiếp -> chuyển lại về 'ai'
exports.cancelAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await ChatSession.findOneAndUpdate({ sessionId: id, status: 'waiting' }, {
      $set: { status: 'ai', lastMessageTime: Date.now() }
    }, { new: true });
    if (!session) {
      if (req.chatSession.status === 'ai') return res.json({ success: true, status: 'ai' });
      return res.status(409).json({ message: 'Conversation is no longer waiting.' });
    }
    emitCrudChange('chat', 'status', session.sessionId);
    emitCrudChange('chat', 'message', session.sessionId);

    res.json({ success: true, message: 'Đã hủy yêu cầu hỗ trợ.', status: 'ai' });
  } catch (error) {
    console.error('Lỗi hủy yêu cầu hỗ trợ:', error);
    res.status(500).json({ message: 'Không thể hủy yêu cầu hỗ trợ.' });
  }
};
