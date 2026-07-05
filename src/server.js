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
    if (ws.authenticatedId) {
      const prevConns = clients.get(ws.authenticatedId);
      if (prevConns) {
        prevConns.delete(ws);
        if (prevConns.size === 0) clients.delete(ws.authenticatedId);
      }
    }

    ws.authenticatedId = id;
    if (!clients.has(id)) {
      clients.set(id, new Set());
    }
    clients.get(id).add(ws);
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
    ws.authenticatedId = null;
    ws.requestIdCount = 0;

    ws.on('message', (data) => {
      const message = data.toString();

      if (message.length > MAX_MESSAGE_SIZE) {
        ws.send(`!errorLimit of ${MAX_MESSAGE_SIZE} characters exceeded`);
        return;
      }

      if (message.startsWith('!')) {
        handleCommand(ws, message);
      } else {
        handleRelay(ws, message);
      }
    });

    ws.on('close', () => {
      if (ws.authenticatedId) {
        const conns = clients.get(ws.authenticatedId);
        if (conns) {
          conns.delete(ws);
          if (conns.size === 0) {
            clients.delete(ws.authenticatedId);
          }
        }
      }
    });
  });

  function handleCommand(ws, message) {
    if (message.startsWith('!request_id')) {
      if (ws.requestIdCount >= MAX_REQUEST_ID_COUNT) {
        ws.send('!errorRequest limit reached');
        return;
      }
      ws.requestIdCount++;
      const id = uuidv4();
      const signature = signId(id);
      bindId(ws, id);
      ws.send(`!credentials${id}${signature}`);
    } else if (message.startsWith('!auth')) {
      const id = message.slice(5, 41);
      const signature = message.slice(41);

      if (id.length === 36 && verifySignature(id, signature)) {
        bindId(ws, id);
      } else {
        ws.send('!errorInvalid credentials');
      }
    } else {
      ws.send('!errorUnknown command');
    }
  }

  function handleRelay(ws, message) {
    if (!ws.authenticatedId) {
      ws.send('!errorNot authenticated');
      return;
    }

    if (message.length < 36) {
      ws.send('!errorInvalid message format');
      return;
    }

    const targetId = message.slice(0, 36);
    const content = message.slice(36);
    const targetConns = clients.get(targetId);

    if (!targetConns || targetConns.size === 0) {
      ws.send('!noticeTarget offline');
      return;
    }

    const relayMessage = `${ws.authenticatedId}${content}`;
    for (const conn of targetConns) {
      if (conn !== ws && conn.readyState === 1) {
        conn.send(relayMessage);
      }
    }
  }

  return wss;
}
