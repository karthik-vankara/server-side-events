# SSE Learning — Phase 4: Connection Lifecycle & Cleanup

## Objective
Understand how SSE connections are born, live, and die — and how to manage them properly on both server and client.

## Connection Lifecycle

```
Client                          Server
  |                               |
  |--- GET /events -------------->|
  |    readyState = CONNECTING    |
  |                               |
  |<-- 200 text/event-stream -----|
  |    onopen fires               |
  |    readyState = OPEN          |
  |                               |
  |<-- data: ...\n\n -------------|  (messages flowing)
  |<-- : heartbeat\n -------------|  (keepalive)
  |                               |
  |--- (tab closed / .close()) -->|
  |    req.on('close') fires      |
  |    cleanup timers             |
  |    remove from registry       |
  |    res.end()                  |
  |    readyState = CLOSED        |
```

## Client-Side: readyState

`EventSource.readyState` has three possible values:

| Value | Constant | Meaning |
|---|---|---|
| `0` | `CONNECTING` | Browser is trying to establish the connection |
| `1` | `OPEN` | Connection is active, messages are flowing |
| `2` | `CLOSED` | Connection is closed, no auto-reconnect will happen |

### State transitions

```
new EventSource('/events')
  → readyState = 0 (CONNECTING)
  → server responds 200
  → onopen fires
  → readyState = 1 (OPEN)

  → network drops
  → onerror fires
  → readyState = 0 (CONNECTING)  ← browser auto-reconnects

  → source.close() called
  → readyState = 2 (CLOSED)      ← no more reconnects
```

### source.close()

```js
source.close();
```

Does two things:
1. Closes the underlying TCP connection immediately
2. Sets `readyState` to `CLOSED` (2)

After this, the browser will **never** auto-reconnect. The only way to reconnect is to create a new `EventSource` instance.

## Server-Side: Connection Registry

In production, you need to track every active connection. A `Map` is the simplest structure:

```js
const connections = new Map();
// Key: unique client ID
// Value: { res, connectedAt, timers, ... }
```

### Why track connections?

1. **Cleanup** — When a client disconnects, you must clear its timers (intervals). Otherwise they leak and the server slows down.
2. **Broadcasting** — To send a message to all clients, you iterate the registry (Phase 5).
3. **Monitoring** — You can expose how many clients are connected, how long they've been connected, etc.
4. **Graceful shutdown** — When the server stops, you need to close every connection cleanly.

### Per-client resources

Each SSE connection owns:

| Resource | Why it exists | What happens if not cleaned |
|---|---|---|
| `setInterval` (stream) | Sends messages on a timer | Leaks — keeps firing forever |
| `setInterval` (heartbeat) | Keeps connection alive | Leaks — writes to closed socket |
| `res` (HTTP response) | The writable stream | Orphaned — holds TCP connection open |

### Cleanup function

```js
function removeConnection(clientId, reason) {
  const conn = connections.get(clientId);
  if (!conn) return;

  clearInterval(conn.streamInterval);
  clearInterval(conn.heartbeatInterval);
  conn.res.end();           // sends EOF to browser
  connections.delete(clientId);
}
```

Call this from:
- `req.on('close')` — client disconnected
- `req.on('error')` — write error on the stream
- Server shutdown — close everything

## Server-Side: Disconnect Detection

### `req.on('close')`

Fires when the underlying TCP socket closes. This happens when:
- Browser tab is closed
- `source.close()` is called on the client
- Network cable unplugged (eventually detected by TCP)

### `req.on('error')`

Fires when there's a write error. Common scenario:
- Server tries to `res.write()` but the client is already gone
- Without this handler, the error crashes the Node.js process

```js
req.on('error', (err) => {
  console.error('Stream error:', err.message);
  removeConnection(clientId, 'stream error');
});
```

## Graceful Shutdown

When you stop the server (`Ctrl+C`), you should close all SSE connections properly:

```js
function gracefulShutdown(signal) {
  for (const [clientId] of connections) {
    removeConnection(clientId, 'server shutdown');
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', gracefulShutdown);   // Ctrl+C
process.on('SIGTERM', gracefulShutdown);  // kill <pid>
```

Without this:
- Clients are abruptly disconnected
- Browsers try to reconnect to a dead server
- No clean state transition on the client side

## Heartbeat (Revisited)

From Phase 3, the heartbeat is a comment line sent periodically:

```js
res.write(`: heartbeat\n`);
```

Why it matters for lifecycle:
- Without heartbeat, idle proxies kill the connection silently
- With heartbeat, the connection stays alive and `req.on('close')` fires promptly when the client actually leaves
- The heartbeat interval should be **half of your proxy's idle timeout**

## The /status Endpoint

A simple diagnostic endpoint to inspect server state:

```
GET /status
```

Returns:
```json
{
  "activeConnections": 2,
  "bufferSize": 45,
  "nextId": 46,
  "connections": [
    { "id": "client-1", "connectedAt": "...", "lastEventId": 10 },
    { "id": "client-2", "connectedAt": "...", "lastEventId": 5 }
  ]
}
```

Useful for:
- Debugging connection leaks
- Monitoring in production
- Verifying cleanup works correctly

## What's Next

Phase 5 builds a multi-client pub/sub system where messages are broadcast to all connected clients, with per-client filtering and state.
