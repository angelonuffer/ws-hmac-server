import { createServer } from './server.js';

try {
  createServer();
  console.log('Server started');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
