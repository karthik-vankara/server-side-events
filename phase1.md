# SSE Learning — Phase 1: Hello World

## Objective
Understand the bare minimum of how Server-Sent Events work: a server opens a persistent HTTP connection and pushes text messages to a browser client.

## What Was Built

### Server (`server.js`)
A raw Node.js HTTP server (no frameworks) with two routes:

| Route | Purpose |
|---|---|
| `/` | Serves the HTML client page |
| `/events` | SSE endpoint — streams timestamps every 2 seconds |

### Client (`client/index.html`)
A minimal HTML page that uses the browser-native `EventSource` API to connect to `/events` and display incoming messages.

## Core Concepts

### 1. The Three Headers That Make SSE Work

```js
res.writeHead(200, {
  'Content-Type': 'text/event-stream',  // tells the browser this is SSE, not a normal response
  'Cache-Control': 'no-cache',           // prevents proxies and browsers from caching the stream
  'Connection': 'keep-alive',            // keeps the underlying TCP connection open
});
```

Without these headers, the browser treats the response as a normal HTTP request and closes the connection after receiving the body.

### 2. SSE Wire Format — `data: <message>\n\n`

SSE is a line-based text protocol. Every message follows this structure:

```
data: Server time: 2026-04-04T10:00:00.000Z

```

- `data: ` — the field prefix (note the space after the colon is optional but conventional)
- `Server time: ...` — the actual payload
- `\n\n` — double newline, which tells the browser "this message is complete, deliver it now"

The double newline is the **message terminator**. Without it, the browser buffers the data and never fires the `onmessage` event.

### 3. `EventSource` — Browser API

```js
const source = new EventSource('/events');
```

This single line does a lot:
1. Opens an HTTP GET request to `/events`
2. Validates the `Content-Type` header is `text/event-stream`
3. Keeps the connection open
4. Parses incoming lines and fires events based on the SSE spec
5. Automatically reconnects if the connection drops (covered in Phase 3)

No library to install. Built into every modern browser.

### 4. Connection Lifecycle

```
Client                          Server
  |                               |
  |--- GET /events -------------->|
  |<-- 200 text/event-stream -----|
  |                               |
  |<-- data: message\n\n ---------|  (every 2s)
  |<-- data: message\n\n ---------|
  |                               |
  |--- (tab closed) ------------->|
  |    req.on('close') fires      |
  |    clearInterval()            |
  |    (cleanup)                  |
```

The server detects client disconnect via `req.on('close')`. This is where you clean up timers, remove subscribers, etc.

## How to Run

```bash
node server.js
# Open http://localhost:3000 in your browser
```

## What to Observe

1. Open the browser Network tab — you'll see `/events` with type `eventsource`
2. The request stays in "pending" state — it never completes
3. Click the request → Response tab — you'll see raw `data: ...` lines streaming in
4. Close the browser tab — the server logs "Client disconnected"

## What's Next

Phase 2 covers the full SSE event format: `event:`, `id:`, `retry:`, multi-line data, and comments.
