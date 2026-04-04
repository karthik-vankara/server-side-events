# SSE Learning — Phase 5: Multi-Client Architecture

## Objective
Build a proper pub/sub system where multiple clients connect, subscribe to specific event types, and receive only the messages they care about.

## The Problem with Single-Client SSE

Phases 1-4 dealt with one client at a time. In reality, you have many clients and need to:

1. Send one message to everyone (broadcast)
2. Let clients choose what they receive (subscribe/filter)
3. Track who is connected and what they want
4. Clean up properly when clients leave

## Connection Registry

The server tracks every active client in a `Map`:

```js
const connections = new Map();
// Key: "client-1", "client-2", ...
// Value: { res, subscriptions, connectedAt, heartbeatInterval }
```

Each entry stores:
- `res` — the writable HTTP stream to send messages
- `subscriptions` — a `Set` of event types this client wants
- `connectedAt` — when they connected
- `heartbeatInterval` — their keepalive timer (for cleanup)

## Subscription Model

Clients declare what they want via the query string:

```
/events                          → subscribes to "*" (everything)
/events?subscribe=alert          → only "alert" events
/events?subscribe=alert,update   → "alert" and "update" events
/events?subscribe=*              → everything (explicit)
```

Parsed on the server:

```js
const url = new URL(req.url, `http://${req.headers.host}`);
const subscribeParam = url.searchParams.get('subscribe');
const subscriptions = subscribeParam
  ? new Set(subscribeParam.split(',').map((s) => s.trim()))
  : new Set(['*']);
```

## Broadcast Function

Sends a message to all connected clients, respecting their subscriptions:

```js
function broadcast(event, data) {
  const msg = { id: nextId, event, data };
  bufferMessage(event, data);

  for (const [clientId, conn] of connections) {
    if (conn.subscriptions.has(event) || conn.subscriptions.has('*')) {
      sendToClient(conn.res, msg);
    }
  }
}
```

A client receives the message if:
1. They subscribed to this specific event type, OR
2. They subscribed to `"*"` (wildcard = everything)

## POST /broadcast Endpoint

External systems (or a UI) can push messages to all clients:

```bash
curl -X POST http://localhost:3000/broadcast \
  -H "Content-Type: application/json" \
  -d '{"event": "alert", "data": "System maintenance at midnight"}'
```

Server parses the JSON body and calls `broadcast()`:

```js
if (pathname === '/broadcast' && req.method === 'POST') {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const { event, data } = JSON.parse(body);
    broadcast(event, data);
  });
}
```

## Replay with Subscription Filtering

When a client reconnects, the server replays missed messages — but only the ones the client is subscribed to:

```js
const missed = getMessagesAfter(lastEventId);
const relevant = missed.filter(
  (msg) => subscriptions.has(msg.event) || subscriptions.has('*')
);
```

Without this filter, a client subscribed only to `alert` would receive replayed `update` and `message` events from before they disconnected.

## Route Matching with Query Strings

A common gotcha: `req.url` includes the query string.

```js
req.url === '/events'              // FALSE when URL is /events?subscribe=alert
req.url === '/events?subscribe=alert'  // TRUE
```

Solution: parse the pathname separately:

```js
const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
// pathname === '/events'  (always, regardless of query string)
```

This is why Phase 5 uses `pathname` for all route matching instead of `req.url`.

## Client-Side: Multiple Event Listeners

The client registers a separate listener for each event type:

```js
source.addEventListener('message', function (event) { ... });
source.addEventListener('alert', function (event) { ... });
source.addEventListener('update', function (event) { ... });
```

Each listener fires only when the server sends a matching `event:` field. The `onmessage` handler is the fallback for events with no `event:` field.

## Testing Multi-Client Behavior

### Test 1: Broadcast to all
1. Open two tabs, both subscribed to `*`
2. Broadcast an `alert` message
3. Both tabs receive it

### Test 2: Filtered subscription
1. Tab 1: subscribed to `*`
2. Tab 2: subscribed to `alert` only
3. Broadcast a `message` event
4. Tab 1 receives it, Tab 2 does not

### Test 3: Broadcast via curl
```bash
curl -X POST http://localhost:3000/broadcast \
  -H "Content-Type: application/json" \
  -d '{"event": "update", "data": "v2.0 deployed"}'
```
All subscribed tabs receive it simultaneously.

### Test 4: Check /status
```bash
curl http://localhost:3000/status
```
Shows all active connections with their subscriptions.

## What You've Learned Across All Phases

| Phase | Concept |
|---|---|
| 1 | Basic SSE: headers, `data:`, `EventSource`, connection lifecycle |
| 2 | Full wire protocol: `event:`, `id:`, `retry:`, multi-line data, comments |
| 3 | Reconnection: `Last-Event-ID`, message buffer, replay, auto-reconnect |
| 4 | Lifecycle management: connection registry, cleanup, graceful shutdown |
| 5 | Multi-client: broadcast, pub/sub filtering, subscription model |
