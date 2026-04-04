# SSE Learning — Phase 3: Reconnection & Resilience

## Objective
Understand how SSE handles connection failures automatically, and how to build a server that can resume streams after a disconnect.

## The Problem: Connections Drop

Connections fail for many reasons:
- Network blips (WiFi drops, mobile switching towers)
- Server restarts
- Proxy timeouts
- Browser goes to background (mobile)

Without reconnection handling, every drop means lost messages.

## Browser Auto-Reconnect (Built In)

The browser automatically reconnects when an SSE connection drops. You don't need to code this.

```
Connection drops
  → browser waits ~3 seconds (default)
  → browser opens new GET /events
  → browser sends Last-Event-ID header
  → server responds
  → connection restored
```

This loop continues indefinitely until:
- You call `source.close()` on the client
- The server returns a non-200 status code

## The `Last-Event-ID` Header

This is the key to resilient SSE. When the browser reconnects, it tells the server the ID of the last message it received:

```
GET /events
Last-Event-ID: 5
```

The server reads this header and knows: "This client has messages 1-5. Send everything after 5."

### How the browser stores the ID

The browser only stores an ID if the server sends an `id:` field:

```
id: 5
event: message
data: Hello
```

If the server never sends `id:`, the browser sends an empty `Last-Event-ID` header on reconnect.

### Accessing it on the server

```js
const lastEventId = parseInt(req.headers['last-event-id'], 10) || 0;
```

- First connection: `last-event-id` header is absent → `lastEventId = 0`
- Reconnect after receiving ID 5: `last-event-id: 5` → `lastEventId = 5`

## Server-Side Message Buffer

To replay missed messages, the server must store them somewhere.

```js
const messageBuffer = [];

function bufferMessage(event, data) {
  messageBuffer.push({ id: nextId, event, data });
  nextId++;
}

function getMessagesAfter(lastId) {
  return messageBuffer.filter((msg) => msg.id > lastId);
}
```

### Replay flow

```js
const lastEventId = parseInt(req.headers['last-event-id'], 10) || 0;

if (lastEventId > 0) {
  // Client is reconnecting — send missed messages first
  const missed = getMessagesAfter(lastEventId);
  for (const msg of missed) {
    res.write(`id: ${msg.id}\n`);
    res.write(`event: ${msg.event}\n`);
    res.write(`data: ${msg.data}\n\n`);
  }
}

// Then start live streaming
setInterval(() => { ... }, 2000);
```

### Important: replay before live stream

Missed messages must be sent **before** starting the live stream timer. Otherwise the client receives live messages interleaved with replayed ones, causing duplicates or ordering issues.

## The `retry:` Field

Tells the browser how long to wait before reconnecting (in milliseconds).

```js
res.write(`retry: 5000\n`);
```

- Default: ~3000ms (varies by browser)
- Sent once at connection start
- Applies to all subsequent reconnects for that EventSource instance
- If you create a new `EventSource`, it resets to default

### When to customize retry

| Scenario | Recommended retry |
|---|---|
| Real-time trading data | 1000ms (reconnect fast) |
| Chat application | 3000ms (default is fine) |
| Background sync | 10000ms+ (don't hammer the server) |
| Server under heavy load | Increase retry to reduce reconnect storm |

## Reconnect Storm

If your server crashes and comes back up, hundreds of clients may reconnect simultaneously. This is called a "reconnect storm."

Mitigation strategies:
1. Server-side: Add jitter (random delay) before accepting reconnects
2. Server-side: Use exponential backoff in the `retry:` field
3. Client-side: Don't use EventSource — use a custom fetch loop with backoff (but you lose the built-in protocol)

## Testing Reconnection

### Manual test 1: Close and reopen tab
1. Open page → receive messages with IDs 1, 2, 3
2. Close tab
3. Reopen page → `Last-Event-ID` is empty (new EventSource) → starts from scratch
4. This is expected — the browser doesn't persist Last-Event-ID across page loads

### Manual test 2: Kill and restart server
1. Open page → receive messages with IDs 1, 2, 3
2. Kill server (`Ctrl+C`)
3. Restart server immediately
4. Browser auto-reconnects with `Last-Event-ID: 3`
5. Server replays messages 4+ (if any were buffered while server was down — in our simple example, none were)

### Manual test 3: Use the Reconnect button
1. Open page → receive messages
2. Click "Reconnect" → creates new EventSource
3. Browser sends `Last-Event-ID` from previous connection
4. Server replays missed messages, then continues live

## Heartbeat (From Phase 3)

```js
res.write(`: heartbeat\n`);
```

Sent every 15 seconds. The browser ignores it (it's a comment). Proxies see data flowing and don't close the connection.

## What's Next

Phase 4 covers proper connection lifecycle management: connection registry, per-client cleanup, graceful shutdown, and the `/status` diagnostic endpoint.
