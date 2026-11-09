const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let ioInstance;
let adminNamespace;
let userNamespace;

function joinChatRoom(socket, sessionId) {
  if (!sessionId) return;
  socket.join(`chat:${sessionId}`);
  socket.join(`chat_${sessionId}`);
}

function leaveChatRoom(socket, sessionId) {
  if (!sessionId) return;
  socket.leave(`chat:${sessionId}`);
  socket.leave(`chat_${sessionId}`);
}

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
    socket.on('join:chat', (sessionId) => joinChatRoom(socket, sessionId));
    socket.on('leave:chat', (sessionId) => leaveChatRoom(socket, sessionId));
    socket.on('chat:join', (sessionId) => joinChatRoom(socket, sessionId));
    socket.on('chat:leave', (sessionId) => leaveChatRoom(socket, sessionId));
  });

  userNamespace = io.of('/user');
  const setupUserSocket = (namespace) => {
    namespace.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token && process.env.JWT_SECRET) {
        try {
          const user = jwt.verify(token, process.env.JWT_SECRET);
          socket.user = user;
          socket.userId = String(user.id || user._id || '');
        } catch {
          // Invalid or expired tokens connect as guests.
        }
      }
      next();
    });

    namespace.on('connection', (socket) => {
      socket.join('public');
      if (socket.userId) {
        socket.join(`user:${socket.userId}`);
        socket.join(`user_${socket.userId}`);
      }
      const email = socket.user?.email;
      if (email) {
        socket.join(`email_${email.trim().toLowerCase()}`);
      }

      socket.on('join:chat', (sessionId) => joinChatRoom(socket, sessionId));
      socket.on('leave:chat', (sessionId) => leaveChatRoom(socket, sessionId));
      socket.on('chat:join', (sessionId) => joinChatRoom(socket, sessionId));
      socket.on('chat:leave', (sessionId) => leaveChatRoom(socket, sessionId));
      socket.on('identify', (userId) => {
        if (userId) {
          socket.userId = String(userId);
          socket.join(`user:${socket.userId}`);
          socket.join(`user_${socket.userId}`);
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

  if (['products', 'maps', 'categories', 'blogs'].includes(resource)) {
    userNamespace?.emit('catalog:updated', payload);
  }

  if (resource === 'chat') {
    adminNamespace?.emit('chat:update', payload);
    ioInstance?.to(`chat:${id}`).emit('chat:update', payload);
    ioInstance?.to(`chat_${id}`).emit('chat:update', payload);
    userNamespace?.to(`chat:${id}`).emit('chat:update', payload);
    userNamespace?.to(`chat_${id}`).emit('chat:update', payload);
  }

  if (extraData.userId) {
    emitToUser(extraData.userId, 'user:update', payload);
  }
}

function emitToUser(userId, event, data) {
  if (!userId) return;
  const id = String(userId);
  ioInstance?.to(`user:${id}`).emit(event, data);
  ioInstance?.to(`user_${id}`).emit(event, data);
  userNamespace?.to(`user:${id}`).emit(event, data);
  userNamespace?.to(`user_${id}`).emit(event, data);
}

function emitToUserEmail(email, event, payload) {
  if (!email) return;
  const room = `email_${email.trim().toLowerCase()}`;
  ioInstance?.to(room).emit(event, payload);
  userNamespace?.to(room).emit(event, payload);
}

function emitToSession(sessionId, event, payload) {
  if (!sessionId) return;
  for (const room of [`chat:${sessionId}`, `chat_${sessionId}`]) {
    ioInstance?.to(room).emit(event, payload);
    userNamespace?.to(room).emit(event, payload);
  }
  adminNamespace?.emit(event, { sessionId, ...payload });
}

function broadcastEvent(event, data) {
  adminNamespace?.emit(event, data);
  ioInstance?.emit(event, data);
  userNamespace?.emit(event, data);
}

module.exports = {
  initializeRealtime,
  emitCrudChange,
  emitToUser,
  emitToUserEmail,
  emitToSession,
  broadcastEvent
};
