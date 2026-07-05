import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import { createHmac } from 'node:crypto';
import { createServer } from '../src/server.js';

describe('Server Unit Tests', () => {
  const SERVER_SECRET = 'test-secret';
  const ALLOWED_ORIGINS = 'http://localhost:3000';

  test('should verify origin correctly', () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const verifyClient = server.options.verifyClient;

    assert.strictEqual(verifyClient({ origin: 'http://localhost:3000' }), true);
    assert.strictEqual(verifyClient({ origin: 'http://evil.com' }), false);
    server.close();
  });

  test('should handle !request_id', () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const ws = new EventEmitter();
    ws.send = mock.fn();
    ws.readyState = 1;

    server.emit('connection', ws);
    ws.emit('message', Buffer.from('!request_id'));

    assert.strictEqual(ws.send.mock.callCount(), 1);
    const response = ws.send.mock.calls[0].arguments[0];
    assert.ok(response.startsWith('!credentials'));
    server.close();
  });

  test('should authenticate and relay message', async () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const ws1 = new EventEmitter();
    ws1.send = mock.fn();
    ws1.readyState = 1;

    const ws2 = new EventEmitter();
    ws2.send = mock.fn();
    ws2.readyState = 1;

    server.emit('connection', ws1);
    server.emit('connection', ws2);

    ws1.emit('message', Buffer.from('!request_id'));
    const creds1 = ws1.send.mock.calls[0].arguments[0].slice(12);
    const id1 = creds1.slice(0, 36);
    const sig1 = creds1.slice(36);

    ws1.emit('message', Buffer.from(`!auth${id1}${sig1}`));
    assert.strictEqual(ws1.authenticatedId, id1);

    ws2.emit('message', Buffer.from('!request_id'));
    const creds2 = ws2.send.mock.calls[0].arguments[0].slice(12);
    const id2 = creds2.slice(0, 36);
    const sig2 = creds2.slice(36);

    ws2.emit('message', Buffer.from(`!auth${id2}${sig2}`));

    ws1.emit('message', Buffer.from(`${id2}Hello World`));

    assert.strictEqual(ws2.send.mock.callCount(), 2);
    assert.strictEqual(ws2.send.mock.calls[1].arguments[0], `${id1}Hello World`);
    server.close();
  });

  test('should handle multi-connection and avoid echo', async () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const id = '12345678-1234-1234-1234-123456789012';
    const sig = createHmac('sha256', SERVER_SECRET).update(id).digest('base64');

    const ws1 = new EventEmitter();
    ws1.send = mock.fn();
    ws1.readyState = 1;

    const ws2 = new EventEmitter();
    ws2.send = mock.fn();
    ws2.readyState = 1;

    server.emit('connection', ws1);
    server.emit('connection', ws2);

    ws1.emit('message', Buffer.from(`!auth${id}${sig}`));
    ws2.emit('message', Buffer.from(`!auth${id}${sig}`));

    ws1.emit('message', Buffer.from(`${id}Broadcast`));

    const ws1Messages = ws1.send.mock.calls.map(c => c.arguments[0]);
    assert.ok(!ws1Messages.includes(`${id}Broadcast`));

    const ws2Messages = ws2.send.mock.calls.map(c => c.arguments[0]);
    assert.ok(ws2Messages.includes(`${id}Broadcast`));
    server.close();
  });

  test('should send notice when target is offline', () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const ws = new EventEmitter();
    ws.send = mock.fn();
    ws.readyState = 1;

    const id = '12345678-1234-1234-1234-123456789012';
    const sig = createHmac('sha256', SERVER_SECRET).update(id).digest('base64');

    server.emit('connection', ws);
    ws.emit('message', Buffer.from(`!auth${id}${sig}`));
    ws.emit('message', Buffer.from(`${'0'.repeat(36)}Test message`));

    const lastMessage = ws.send.mock.calls[ws.send.mock.calls.length - 1].arguments[0];
    assert.strictEqual(lastMessage, '!noticeTarget offline');
    server.close();
  });

  test('should bind ID automatically on !request_id', () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const ws = new EventEmitter();
    ws.send = mock.fn();
    ws.readyState = 1;

    server.emit('connection', ws);
    ws.emit('message', Buffer.from('!request_id'));

    const response = ws.send.mock.calls[0].arguments[0];
    const id = response.slice(12, 48);
    assert.strictEqual(ws.authenticatedId, id);
    server.close();
  });

  test('should replace bound ID on subsequent !request_id', () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0 });
    const ws = new EventEmitter();
    ws.send = mock.fn();
    ws.readyState = 1;

    server.emit('connection', ws);

    ws.emit('message', Buffer.from('!request_id'));
    const id1 = ws.send.mock.calls[0].arguments[0].slice(12, 48);
    assert.strictEqual(ws.authenticatedId, id1);

    ws.emit('message', Buffer.from('!request_id'));
    const id2 = ws.send.mock.calls[1].arguments[0].slice(12, 48);
    assert.strictEqual(ws.authenticatedId, id2);
    assert.notStrictEqual(id1, id2);
    server.close();
  });

  test('should enforce MAX_REQUEST_ID_COUNT', () => {
    const server = createServer({ SERVER_SECRET, ALLOWED_ORIGINS, PORT: 0, MAX_REQUEST_ID_COUNT: 2 });
    const ws = new EventEmitter();
    ws.send = mock.fn();
    ws.readyState = 1;

    server.emit('connection', ws);

    ws.emit('message', Buffer.from('!request_id')); // 1
    ws.emit('message', Buffer.from('!request_id')); // 2
    ws.emit('message', Buffer.from('!request_id')); // 3 - should fail

    assert.strictEqual(ws.send.mock.callCount(), 3);
    const lastMessage = ws.send.mock.calls[2].arguments[0];
    assert.strictEqual(lastMessage, '!errorRequest limit reached');
    server.close();
  });
});
