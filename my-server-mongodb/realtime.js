const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let adminNamespace;

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
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  return io;
}

function emitCrudChange(resource, action, id) {
  adminNamespace?.emit('crud:changed', { resource, action, id: String(id) });
}

module.exports = { emitCrudChange, initializeRealtime };
