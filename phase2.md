# SSE Learning — Phase 2: Event Format Deep Dive

## Objective
Learn the complete SSE wire protocol — every field, every line, what the browser does with each one.

## SSE Wire Protocol

An SSE stream is a sequence of lines. Each message block ends with a blank line (`\n\n`).

```
field: value
field: value
<blank line>
```

## The Four SSE Fields

### 1. `data:` — The Payload

The most important field. Contains the actual message content.

```
data: Hello world
```

**Multi-line data:** Repeat the `data:` field. Lines are joined with `\n`.

```
data: Line one
data: Line two
data: Line three
```

Browser receives: `"Line one\nLine two\nLine three"`

**Important:** If you omit the space after the colon (`data:Hello`), the browser still parses it correctly. The space is conventional but not required.

### 2. `event:` — The Event Name

Assigns a name to the message. Controls which listener fires on the client.

```
event: alert
data: Something happened
```

- With `event:` → fires `source.addEventListener('alert', callback)`
- Without `event:` → fires `source.onmessage` (the default handler)

This is how you multiplex different message types over a single connection.

### 3. `id:` — The Event ID

Assigns an identifier to the message.

```
id: 42
event: update
data: New data
```

The browser stores this ID internally. When the connection drops and reconnects, the browser sends:

```
GET /events
Last-Event-ID: 42
```

This lets the server know where to resume from. Without `id:`, the browser sends an empty `Last-Event-ID` header.

### 4. `retry:` — Reconnect Delay

Sets the reconnection delay in milliseconds. Default is ~3000ms.

```
retry: 5000
```

You only need to send this once per connection. It overrides the browser's default reconnect timer.

## Comment Lines

Lines starting with `:` are comments. The browser ignores them completely.

```
: heartbeat
```

No blank line needed — comments are self-terminating. Commonly used as keep-alive pings to prevent intermediate proxies from closing idle connections.

## Complete Message Examples

### Minimal message
```
data: hello
```

### Named event with ID
```
id: 1
event: notification
data: You have a new message
```

### Multi-line with comment
```
: processing complete
data: {"status": "done"}
data: {"items": 42}
```

## What's Next

Phase 3 covers reconnection behavior, `Last-Event-ID` handling, and building a resilient server that can resume streams after disconnects.
