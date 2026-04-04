# Server-Sent Events (SSE) — Learning Guide

A hands-on, phase-by-phase guide to understanding SSE from the ground up using raw Node.js and vanilla JavaScript. No frameworks, no libraries — just the protocol.

## What is SSE?

Server-Sent Events is a one-way push protocol from server → client over HTTP. The client opens a persistent connection, and the server streams text events. It's simpler than WebSockets when you only need server-to-client push.

```
Client                          Server
  |--- GET /events -------------->|
  |<-- 200 text/event-stream -----|
  |<-- data: hello\n\n -----------|
  |<-- data: world\n\n -----------|
  |    (connection stays open)    |
```

## Project Structure

```
sse/
├── README.md              ← you are here
├── phase1.md              ← Phase 1 notes
├── phase2.md              ← Phase 2 notes
├── phase3.md              ← Phase 3 notes
├── phase4.md              ← Phase 4 notes
├── phase5.md              ← Phase 5 notes
├── phase1-server.js       ← Phase 1 server
├── phase2-server.js       ← Phase 2 server
├── phase3-server.js       ← Phase 3 server
├── phase4-server.js       ← Phase 4 server
├── phase5-server.js       ← Phase 5 server
└── client/
    └── index.html         ← Client UI (updated per phase)
```

Run any phase: `node phaseN-server.js`

---

## Topics Covered

### Phase 1: Hello World
- The three headers that make SSE work (`Content-Type`, `Cache-Control`, `Connection`)
- SSE wire format: `data: <message>\n\n`
- `EventSource` browser API
- `onmessage`, `onopen`, `onerror` handlers
- Server-side disconnect detection (`req.on('close')`)

### Phase 2: Event Format Deep Dive
- `data:` — the payload field, including multi-line data
- `event:` — named events and `addEventListener('name', cb)`
- `id:` — event IDs and how the browser stores them
- `retry:` — controlling reconnect delay
- Comment lines (`:`) — heartbeat/keepalive
- The double newline (`\n\n`) as message terminator

### Phase 3: Reconnection & Resilience
- Browser auto-reconnect behavior (built-in, no code needed)
- `Last-Event-ID` header — sent by browser on reconnect
- Server-side message buffer for replay
- Replay logic — send missed messages before starting live stream
- `retry:` field in practice
- Heartbeat to prevent proxy idle timeouts

### Phase 4: Connection Lifecycle & Cleanup
- `EventSource.readyState`: CONNECTING (0), OPEN (1), CLOSED (2)
- `source.close()` — manual disconnect, no auto-reconnect
- Connection registry (`Map`) — tracking all active clients
- Per-client resources (timers, response streams) and cleanup
- `req.on('close')` vs `req.on('error')` — disconnect detection
- Graceful shutdown (`SIGINT`, `SIGTERM`)
- `/status` diagnostic endpoint

### Phase 5: Multi-Client Pub/Sub
- Broadcast — send one message to all connected clients
- Subscription model — clients filter by event type via query string
- `*` wildcard subscription — receive everything
- `POST /broadcast` endpoint — external message injection
- Replay with subscription filtering
- Route matching with query strings (pathname vs req.url)

---

## Topics NOT Covered (Production Concerns)

These are real-world topics you'll need when deploying SSE in production:

| Topic | The Problem |
|---|---|
| **Authentication** | `EventSource` cannot send custom headers. Auth must use cookies, URL tokens, or a fetch-based polyfill. |
| **CORS** | Cross-origin SSE requires `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, and special preflight handling. |
| **Horizontal Scaling** | SSE connections are sticky to one server instance. Broadcasting across multiple servers requires Redis pub/sub or similar. |
| **JSON Payloads** | SSE is text-only. Structured data requires `JSON.stringify` on server and `JSON.parse(event.data)` on client, with error handling. |
| **Error Handling** | What happens on 4xx/5xx responses? Browser stops reconnecting on non-2xx. Need max reconnect logic and exponential backoff. |
| **EventSource Limitations** | No custom headers, no POST method, no binary data. When these are needed, use a fetch-based SSE polyfill. |
| **Rate Limiting / Backpressure** | Server sends faster than client can consume. Need to detect slow clients and drop or buffer messages. |
| **Security** | XSS via unescaped `event.data`, injection through untrusted payloads. Need sanitization and Content Security Policy. |
| **SSE vs WebSockets** | SSE = one-way, HTTP-based, auto-reconnect. WebSockets = bidirectional, lower latency, more complex. Choose based on need. |
| **Reverse Proxy Config** | Nginx, Apache, and load balancers need specific config to support long-lived SSE connections (buffering off, timeout tuning). |
| **Message Persistence** | In-memory buffer (Phases 3-5) is lost on restart. Production needs Redis, database, or WAL for durability. |
| **Connection Limits** | Node.js has file descriptor limits. Each SSE connection = 1 fd. Need to cap connections and handle OS limits. |

---

## SSE Wire Protocol Quick Reference

```
retry: 5000\n
id: 42\n
event: alert\n
data: Line one\n
data: Line two\n
\n
```

| Field | Purpose | Required |
|---|---|---|
| `data:` | Message payload | Yes (at least one) |
| `event:` | Event name (fires named listener) | No |
| `id:` | Event ID (sent back on reconnect) | No |
| `retry:` | Reconnect delay in ms | No |
| `: comment` | Ignored by browser (heartbeat) | No |
| `\n\n` | Message terminator | Yes |

---

## Browser Support

SSE is supported in all modern browsers. **Not supported in Internet Explorer.** For IE or environments needing custom headers, use a fetch-based polyfill.

## When to Use SSE vs WebSockets

| Use SSE when | Use WebSockets when |
|---|---|
| Server → client only (news, notifications, live feeds) | Client → server AND server → client (chat, gaming) |
| You want auto-reconnect for free | You need binary data |
| You want simple HTTP-based protocol | You need sub-10ms latency |
| Text/JSON data is sufficient | You need custom headers per message |
