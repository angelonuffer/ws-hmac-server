# WebSocket HMAC Server

A Node.js WebSocket server focused on text-based message exchange and routing by identifiers (UUIDs) with HMAC authentication.

## Server Settings (Environment Variables)

The server is configured through the following environment variables:

- `HOST`: Network address where the server will run (Default: `0.0.0.0`).
- `PORT`: Server listening port (Default: `8080`).
- `SERVER_SECRET`: Cryptographic key used to sign and validate IDs (**Required**).
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins for connection protection. Supports wildcards at the beginning (e.g., `*.example.com`). Connections without an Origin header or from unlisted origins are rejected.
- `MAX_MESSAGE_SIZE`: Maximum character limit per message (Default: `65536`).

## Messaging Protocol

All messages travel as a single string. Data separation is done by position (slice).

### Control Commands (Starting with `!`)

#### Identity Generation (`!request_id`)
The client sends `!request_id`.
The server creates a UUID v4, generates an HMAC-SHA256 signature using the `SERVER_SECRET`, and responds with `!credentials<uuid><signature>`.
- `uuid`: 36 characters.
- `signature`: HMAC-SHA256 in Base64 format (approx. 44 characters).

#### Authentication/Binding (`!auth`)
The client sends `!auth<uuid><signature>`.
The server validates the pair (ID + Signature). If valid, it binds the current connection to that ID.
- **Multi-connection Rule**: The same ID can be validated by multiple simultaneous connections.

### Standard Message Exchange

#### Client -> Server
The client sends the first 36 characters containing the destination ID, followed immediately by the message content.
Format: `<destination_id><message_content>`

#### Server -> Client (Relay)
The server identifies who sent the message and forwards it to the destination, replacing the destination ID with the source ID.
Format: `<source_id><message_content>`

**Relay Rules:**
- The sender must be authenticated.
- The message is sent to all active connections bound to the `destination_id`, **except** for the connection that sent the message (even if it shares the same ID).

### Error and Warning Messages
- `!error<message>`: Sent by the server in case of authentication failure, invalid command, or format error.
- `!notice<message>`: Sent when the destination ID has no active connections.

## Execution

### Requirements
- Node.js v18 or higher.

### Installation
```bash
npm install
```

### Start the Server
```bash
export SERVER_SECRET="your_secret_key"
export ALLOWED_ORIGINS="http://yourapp.com,*.example.com"
npm start
```

### Tests
```bash
npm test
```
