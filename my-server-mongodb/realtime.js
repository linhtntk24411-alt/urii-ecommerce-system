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
      }
    },
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.has(origin));
    }
  });

  ioInstance = io;

  // 1. Admin Namespace (/admin) - Bắt buộc token Admin
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
    socket.on('join:chat', (sessionId) => {
      if (sessionId) socket.join(`chat:${sessionId}`);
    });
    socket.on('leave:chat', (sessionId) => {
      if (sessionId) socket.leave(`chat:${sessionId}`);
    });
  });

  // 2. User Namespace (/user) và Root (/) - Cho phép cả User đăng nhập & khách vãng lai
  userNamespace = io.of('/user');
  const setupUserSocket = (nsp) => {
    nsp.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token && process.env.JWT_SECRET) {
        try {
          const user = jwt.verify(token, process.env.JWT_SECRET);
          socket.user = user;
          socket.userId = String(user.id || user._id);
        } catch {
          // Token không hợp lệ thì coi như guest
        }
      }
      next();
    });

    nsp.on('connection', (socket) => {
      if (socket.userId) {
        socket.join(`user:${socket.userId}`);
      }
      socket.join('public');

      socket.on('join:chat', (sessionId) => {
        if (sessionId) socket.join(`chat:${sessionId}`);
      });
      socket.on('leave:chat', (sessionId) => {
        if (sessionId) socket.leave(`chat:${sessionId}`);
      });
      socket.on('identify', (userId) => {
        if (userId) {
          socket.userId = String(userId);
          socket.join(`user:${socket.userId}`);
        }
      });
    });
  };

  setupUserSocket(io);
  setupUserSocket(userNamespace);

  return io;
}

function emitCrudChange(resource, action, id, extraData = {}) {
  const payload = { resource, action, id: String(id), ...extraData };
  adminNamespace?.emit('crud:changed', payload);
  ioInstance?.emit('crud:changed', payload);
  userNamespace?.emit('crud:changed', payload);

  // Nếu là sự kiện chat
  if (resource === 'chat') {
    adminNamespace?.emit('chat:update', payload);
    ioInstance?.to(`chat:${id}`).emit('chat:update', payload);
    userNamespace?.to(`chat:${id}`).emit('chat:update', payload);
  }

  // Nếu có đích danh userId (ví dụ thông báo, cập nhật đơn hàng)
  if (extraData?.userId) {
    const userTarget = `user:${extraData.userId}`;
    ioInstance?.to(userTarget).emit('user:update', payload);
    userNamespace?.to(userTarget).emit('user:update', payload);
  }
}

function emitToUser(userId, event, data) {
  if (!userId) return;
  const userTarget = `user:${userId}`;
  ioInstance?.to(userTarget).emit(event, data);
  userNamespace?.to(userTarget).emit(event, data);
}

function broadcastEvent(event, data) {
  adminNamespace?.emit(event, data);
  ioInstance?.emit(event, data);
  userNamespace?.emit(event, data);
}

module.exports = {
  emitCrudChange,
  emitToUser,
  broadcastEvent,
  initializeRealtime
};
