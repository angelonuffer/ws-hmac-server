import { WebSocketServer } from 'ws';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export function createServer(config = {}) {
  const HOST = config.HOST || process.env.HOST || '0.0.0.0';
  const PORT = config.PORT || parseInt(process.env.PORT || '8080', 10);
  const SERVER_SECRET = config.SERVER_SECRET || process.env.SERVER_SECRET;
  const ALLOWED_ORIGINS = config.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '';
  const MAX_MESSAGE_SIZE = config.MAX_MESSAGE_SIZE || parseInt(process.env.MAX_MESSAGE_SIZE || '65536', 10);
  const MAX_REQUEST_ID_COUNT = config.MAX_REQUEST_ID_COUNT || parseInt(process.env.MAX_REQUEST_ID_COUNT || '10', 10);

  if (!SERVER_SECRET) {
    throw new Error('SERVER_SECRET is required');
  }

  const clients = new Map(); // Map<uuid, Set<WebSocket>>

  function signId(id) {
    return createHmac('sha256', SERVER_SECRET)
      .update(id)
      .digest('base64');
  }

  function verifySignature(id, signature) {
    try {
      const expected = signId(id);
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(signature);
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch (e) {
      return false;
    }
  }

  function bindId(ws, id) {
    if (ws.authenticatedIds.has(id)) return;

    ws.authenticatedIds.add(id);
    if (!clients.has(id)) {
      clients.set(id, new Set());
    }
    clients.get(id).add(ws);
  }

  function unbindId(ws, id) {
    if (!ws.authenticatedIds.has(id)) return;

    ws.authenticatedIds.delete(id);
    const conns = clients.get(id);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) {
        clients.delete(id);
      }
    }
  }

  function isOriginAllowed(origin) {
    if (!origin) return false;
    const allowedList = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    if (allowedList.length === 0) return false;

    return allowedList.some(allowed => {
      if (allowed === '*') return true;

      let originUrl;
      try {
        originUrl = new URL(origin);
      } catch (e) {
        return origin === allowed;
      }

      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(2);
        return originUrl.hostname === suffix || originUrl.hostname.endsWith('.' + suffix);
      }

      try {
        const allowedUrl = new URL(allowed);
        return originUrl.origin === allowedUrl.origin;
      } catch (e) {
        return origin === allowed;
      }
    });
  }

  const wss = new WebSocketServer({
    host: HOST,
    port: PORT,
    verifyClient: (info) => {
      const origin = info.origin || info.req.headers.origin;
      return isOriginAllowed(origin);
    }
  });

  wss.on('connection', (ws) => {
    ws.authenticatedIds = new Set();
    ws.requestIdCount = 0;

    ws.on('message', (data) => {
      const message = data.toString();

      if (message.length > MAX_MESSAGE_SIZE) {
        ws.send(`%Limit of ${MAX_MESSAGE_SIZE} characters exceeded`);
        return;
      }

      const prefix = message[0];
      switch (prefix) {
        case '?':
          handleRequestId(ws);
          break;
        case '$':
          handleAuth(ws, message);
          break;
        case '-':
          handleUnbind(ws, message);
          break;
        case ':':
          handleRelay(ws, message);
          break;
        default:
          ws.send('%Unknown command or missing prefix');
      }
    });

    ws.on('close', () => {
      for (const id of ws.authenticatedIds) {
        const conns = clients.get(id);
        if (conns) {
          conns.delete(ws);
          if (conns.size === 0) {
            clients.delete(id);
          }
        }
      }
      ws.authenticatedIds.clear();
    });
  });

  function handleRequestId(ws) {
    if (ws.requestIdCount >= MAX_REQUEST_ID_COUNT) {
      ws.send('%Request limit reached');
      return;
    }
    ws.requestIdCount++;
    const id = uuidv4();
    const signature = signId(id);
    bindId(ws, id);
    ws.send(`=${id}${signature}`);
  }

  function handleAuth(ws, message) {
    const id = message.slice(1, 37);
    const signature = message.slice(37);

    if (id.length === 36 && verifySignature(id, signature)) {
      bindId(ws, id);
    } else {
      ws.send('%Invalid credentials');
    }
  }

  function handleUnbind(ws, message) {
    const id = message.slice(1, 37);
    if (id.length === 36) {
      unbindId(ws, id);
    } else {
      ws.send('%Invalid ID format');
    }
  }

  function handleRelay(ws, message) {
    if (ws.authenticatedIds.size === 0) {
      ws.send('%Not authenticated');
      return;
    }

    if (message.length < 73) {
      ws.send('%Invalid message format');
      return;
    }

    const sourceId = message.slice(1, 37);
    const targetId = message.slice(37, 73);
    const content = message.slice(73);

    if (!ws.authenticatedIds.has(sourceId)) {
      ws.send('%Source ID not bound to this connection');
      return;
    }

    const targetConns = clients.get(targetId);

    if (!targetConns || targetConns.size === 0) {
      ws.send('#Target offline');
      return;
    }

    const relayMessage = `:${sourceId}${targetId}${content}`;
    for (const conn of targetConns) {
      if (conn !== ws && conn.readyState === 1) {
        conn.send(relayMessage);
      }
    }
  }

  return wss;
}
