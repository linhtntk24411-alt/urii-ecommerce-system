const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createHash } = require('node:crypto');
const ChatSession = require('./models/ChatSession');
const { checkAccountSession } = require('./middleware/auth');

let ioInstance;
let adminNamespace;
let userNamespace;

function expireSocket(socket) {
  if (!socket.user?.exp) return;
  const remaining = socket.user.exp * 1000 - Date.now();
  const timer = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(remaining, 2147483647)));
  timer.unref?.();
  socket.once('disconnect', () => clearTimeout(timer));
}

async function joinChatRoom(socket, sessionId, acknowledge = () => {}) {
  const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
  try {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 150) return reply({ ok: false });
    if (socket.user?.exp && socket.user.exp * 1000 <= Date.now()) return reply({ ok: false });
    if (socket.user && await checkAccountSession(socket.user)) return reply({ ok: false });
    if (socket.user?.role !== 'admin') {
      const session = await ChatSession.findOne({ sessionId }).select('+reactionOwnerId +reactionGuestHash').lean();
      const actor = socket.userId ? `account:${socket.userId}` : socket.guestHash ? `guest:${socket.guestHash}` : '';
      const owner = session && (session.reactionOwnerId ? session.reactionOwnerId === actor : session.userId
        ? String(session.userId) === socket.userId : Boolean(socket.guestHash && session.reactionGuestHash === socket.guestHash));
      if (!actor || !owner || !socket.connected) return reply({ ok: false });
    }
    await socket.join([`chat:${sessionId}`, `chat_${sessionId}`]);
    reply({ ok: true });
  } catch { reply({ ok: false }); }
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
  adminNamespace.use(async (socket, next) => {
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
      if (await checkAccountSession(user)) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  adminNamespace.on('connection', (socket) => {
    socket.join(['admins', 'user:' + socket.user.id]);
    expireSocket(socket);
    socket.on('join:chat', (sessionId, ack) => { void joinChatRoom(socket, sessionId, ack); });
    socket.on('leave:chat', (sessionId) => leaveChatRoom(socket, sessionId));
    socket.on('chat:join', (sessionId, ack) => { void joinChatRoom(socket, sessionId, ack); });
    socket.on('chat:leave', (sessionId) => leaveChatRoom(socket, sessionId));
  });

  userNamespace = io.of('/user');
  const setupUserSocket = (namespace) => {
    namespace.use(async (socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token) {
        try {
          const user = jwt.verify(token, process.env.JWT_SECRET);
          if (!user.id || !['admin', 'user'].includes(user.role)) return next(new Error('Unauthorized'));
          if (await checkAccountSession(user)) return next(new Error('Unauthorized'));
          socket.user = user;
          socket.userId = String(user.id || user._id || '');
        } catch {
          return next(new Error('Unauthorized'));
        }
      }
      const cookie = /(?:^|;\s*)urii_reaction_guest=([a-f0-9]{64})(?:;|$)/.exec(socket.handshake.headers.cookie || '');
      socket.guestHash = cookie ? createHash('sha256').update(cookie[1]).digest('hex') : '';
      next();
    });

    namespace.on('connection', (socket) => {
      expireSocket(socket);
      socket.join('public');
      if (socket.userId) {
        socket.join(`user:${socket.userId}`);
        socket.join(`user_${socket.userId}`);
      }
      const email = socket.user?.email;
      if (email) {
        socket.join(`email_${email.trim().toLowerCase()}`);
      }

      socket.on('join:chat', (sessionId, ack) => { void joinChatRoom(socket, sessionId, ack); });
      socket.on('leave:chat', (sessionId) => leaveChatRoom(socket, sessionId));
      socket.on('chat:join', (sessionId, ack) => { void joinChatRoom(socket, sessionId, ack); });
      socket.on('chat:leave', (sessionId) => leaveChatRoom(socket, sessionId));
      socket.on('identify', (userId) => {
        if (socket.userId && String(userId) === socket.userId) {
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

function disconnectAccount(userId) {
  const room = 'user:' + userId;
  ioInstance?.in(room).disconnectSockets(true);
  userNamespace?.in(room).disconnectSockets(true);
  adminNamespace?.in(room).disconnectSockets(true);
}

function emitCrudChange(resource, action, id, extraData = {}) {
  const payload = { resource, action, id: String(id), ...extraData };
  adminNamespace?.emit('crud:changed', payload);
  const publicResource = ['products', 'maps', 'categories', 'blogs', 'vouchers', 'promotions'].includes(resource);
  if (publicResource) {
    ioInstance?.emit('crud:changed', payload);
    userNamespace?.emit('crud:changed', payload);
  }

  if (['products', 'maps', 'categories', 'blogs'].includes(resource)) {
    userNamespace?.emit('catalog:updated', payload);
  }

  if (resource === 'chat') {
    adminNamespace?.emit('chat:update', payload);
    ioInstance?.to([`chat:${id}`, `chat_${id}`]).emit('chat:update', payload);
    userNamespace?.to([`chat:${id}`, `chat_${id}`]).emit('chat:update', payload);
  }

  if (extraData.userId) {
    emitToUser(extraData.userId, 'user:update', payload);
  }
}

function emitToUser(userId, event, data) {
  if (!userId) return;
  const id = String(userId);
  ioInstance?.to([`user:${id}`, `user_${id}`]).emit(event, data);
  userNamespace?.to([`user:${id}`, `user_${id}`]).emit(event, data);
}

function emitToUserEmail(email, event, payload) {
  if (!email) return;
  const room = `email_${email.trim().toLowerCase()}`;
  ioInstance?.to(room).emit(event, payload);
  userNamespace?.to(room).emit(event, payload);
}

function emitToSession(sessionId, event, payload) {
  if (!sessionId) return;
  ioInstance?.to([`chat:${sessionId}`, `chat_${sessionId}`]).emit(event, payload);
  userNamespace?.to([`chat:${sessionId}`, `chat_${sessionId}`]).emit(event, payload);
  adminNamespace?.emit(event, { sessionId, ...payload });
}

function broadcastEvent(event, data) {
  adminNamespace?.emit(event, data);
  ioInstance?.emit(event, data);
  userNamespace?.emit(event, data);
}

module.exports = {
  disconnectAccount,
  initializeRealtime,
  emitCrudChange,
  emitToUser,
  emitToUserEmail,
  emitToSession,
  broadcastEvent
};
