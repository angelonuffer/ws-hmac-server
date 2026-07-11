# WebSocket HMAC Server

A Node.js WebSocket server focused on text-based message exchange and routing by identifiers (UUIDs) with HMAC authentication.

## Server Settings (Environment Variables)

The server is configured through the following environment variables:

- `HOST`: Network address where the server will run (Default: `0.0.0.0`).
- `PORT`: Server listening port (Default: `8080`).
- `SERVER_SECRET`: Cryptographic key used to sign and validate IDs (**Required**).
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins for connection protection. Supports wildcards at the beginning (e.g., `*.example.com`). Connections without an Origin header or from unlisted origins are rejected.
- `MAX_MESSAGE_SIZE`: Maximum character limit per message (Default: `65536`).
- `MAX_REQUEST_ID_COUNT`: Maximum number of `?` calls allowed per connection (Default: `10`).

## Messaging Protocol

All messages travel as a single string. Data separation is done by position (slice).

### Control Commands

#### Identity Generation (`?`)
The client sends `?`.
The server creates a UUID v4, generates an HMAC-SHA256 signature using the `SERVER_SECRET`, responds with `=<uuid><signature>`, and **automatically binds the connection to this ID**.
- `uuid`: 36 characters.
- `signature`: HMAC-SHA256 in Base64 format (approx. 44 characters).
- **Multiple IDs**: A single connection can have multiple IDs bound to it by calling `?` multiple times.

#### Authentication/Binding (`$`)
The client sends `$<uuid><signature>`.
The server validates the pair (ID + Signature). If valid, it binds the current connection to that ID.
- **Multiple IDs**: A single connection can have multiple IDs bound to it.
- **Multi-connection Rule**: The same ID can be validated by multiple simultaneous connections.

#### Unbinding Identity (`-`)
The client sends `-<uuid>`.
The server removes the binding between the current connection and the specified ID.
- `uuid`: 36 characters.

### Standard Message Exchange

#### Client -> Server
The client sends the prefix `:` followed by the 36 characters of the source ID (which must be bound to the connection), then the 36 characters of the destination ID, and finally the message content.
Format: `:<source_id><destination_id><message_content>`

#### Server -> Client (Relay)
The server forwards the message to the destination exactly as received (including source and destination IDs), maintaining the `:` prefix.
Format: `:<source_id><destination_id><message_content>`

**Relay Rules:**
- The sender must be authenticated.
- The message is sent to all active connections bound to the `destination_id`, **except** for the connection that sent the message (even if it shares the same ID).

### Error and Warning Messages
- `%<message>`: Sent by the server in case of authentication failure, invalid command, format error, or limit reached.
- `#<message>`: Sent when the destination ID has no active connections (offline).

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
