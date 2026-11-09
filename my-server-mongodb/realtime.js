const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let ioInstance;
let adminNamespace;
let userNamespace;

function initializeRealtime(server, allowedOrigins) {
  const io = new Server(server, {
    cors: {
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true
    },
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.has(origin));
    }
  });

  ioInstance = io;

  // 1. ADMIN NAMESPACE (/admin) - Dành riêng cho Quản trị viên
  adminNamespace = io.of('/admin');
  adminNamespace.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token || !process.env.JWT_SECRET) {
      next(new Error('Unauthorized'));
      return;
    }

    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      if (user.role !== 'admin') {
        next(new Error('Forbidden'));
        return;
      }
      socket.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  adminNamespace.on('connection', (socket) => {
    socket.join('admins');
  });

  // 2. USER NAMESPACE (/user) - Dành cho Khách hàng & Người dùng
  userNamespace = io.of('/user');
  userNamespace.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
      } catch (_) {
        // Cho phép kết nối dưới quyền khách nếu token hết hạn
      }
    }
    next();
  });

  userNamespace.on('connection', (socket) => {
    socket.join('public');

    const userId = socket.user?.id || socket.user?._id;
    if (userId) {
      socket.join(`user_${userId}`);
    }
    const userEmail = socket.user?.email;
    if (userEmail) {
      socket.join(`email_${userEmail.trim().toLowerCase()}`);
    }

    // Khách hàng hoặc tư vấn viên tham gia vào phòng chat session cụ thể
    socket.on('chat:join', (sessionId) => {
      if (sessionId) {
        socket.join(`chat_${sessionId}`);
      }
    });

    socket.on('chat:leave', (sessionId) => {
      if (sessionId) {
        socket.leave(`chat_${sessionId}`);
      }
    });
  });

  return io;
}

function emitCrudChange(resource, action, id) {
  adminNamespace?.emit('crud:changed', { resource, action, id: String(id) });

  // Phát tín hiệu cập nhật danh mục công khai cho user client
  if (['products', 'maps', 'categories', 'blogs'].includes(resource)) {
    userNamespace?.emit('catalog:updated', { resource, action, id: String(id) });
  }
}

function emitToUser(userId, event, payload) {
  if (!userNamespace || !userId) return;
  userNamespace.to(`user_${userId}`).emit(event, payload);
}

function emitToUserEmail(email, event, payload) {
  if (!userNamespace || !email) return;
  userNamespace.to(`email_${email.trim().toLowerCase()}`).emit(event, payload);
}

function emitToSession(sessionId, event, payload) {
  if (!sessionId) return;
  userNamespace?.to(`chat_${sessionId}`).emit(event, payload);
  adminNamespace?.emit(event, { sessionId, ...payload });
}

module.exports = {
  initializeRealtime,
  emitCrudChange,
  emitToUser,
  emitToUserEmail,
  emitToSession
};
