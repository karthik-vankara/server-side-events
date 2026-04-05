# SSE Authentication

## Objective
Understand the authentication limitations of `EventSource` and learn three practical approaches to secure SSE connections.

## The Core Problem

`EventSource` is a simple browser API with significant limitations:

| Limitation | Impact |
|---|---|
| **No custom headers** | Cannot send `Authorization: Bearer token` |
| **Only GET requests** | Cannot POST credentials |
| **No programmatic cookies** | Can only use cookies the browser already has |

This means standard REST auth patterns don't work. You need workarounds.

---

## Method 1: URL Token Authentication

### How it works

Pass the token in the query string:

```js
const source = new EventSource('/events?token=token-alice-123');
```

### Server-side validation

```js
const url = new URL(req.url, `http://${req.headers.host}`);
const token = url.searchParams.get('token');
const username = validateToken(token);

if (!username) {
  res.writeHead(401);
  res.end(JSON.stringify({ error: 'Invalid token' }));
  return;
}
```

### Pros
- Simple — works with native `EventSource`
- No extra client code needed
- No cookie/CORS complexity

### Cons
- **Token appears in browser history**
- **Token appears in server access logs**
- **Token appears in proxy logs**
- **Token appears in HTTP Referer header** when navigating away
- Token is visible in Network tab

### When to use
- Internal tools where convenience outweighs risk
- Short-lived tokens that rotate frequently
- Development/testing

---

## Method 2: Cookie Authentication

### How it works

Two-step process:

1. **Login**: POST credentials to `/login`, server responds with `Set-Cookie`
2. **Connect**: `EventSource` to `/events` — browser automatically sends the cookie

### Step 1: Login

```js
const res = await fetch('/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'token-alice-123' }),
});
// Server responds with: Set-Cookie: session=abc123; HttpOnly; SameSite=Strict; Path=/
```

### Step 2: Connect

```js
// Browser automatically sends the session cookie with this request
const source = new EventSource('/events');
```

### Server-side: Set the cookie

```js
const sessionId = createSession(username);
res.setHeader('Set-Cookie', `session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`);
```

### Server-side: Read the cookie

```js
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    cookies[name] = rest.join('=');
    return cookies;
  }, {});
}

const cookies = parseCookies(req.headers.cookie);
const username = validateSession(cookies.session);
```

### Cookie flags explained

| Flag | Purpose |
|---|---|
| `HttpOnly` | JavaScript cannot read the cookie (prevents XSS theft) |
| `SameSite=Strict` | Cookie only sent on same-origin requests (prevents CSRF) |
| `Path=/` | Cookie sent with all paths on this domain |

### Pros
- Token never appears in URL
- `HttpOnly` cookie can't be stolen by XSS
- `SameSite` prevents CSRF
- Works with native `EventSource`

### Cons
- Requires same-origin (or CORS with `credentials: 'include'`)
- Two-step process (login, then connect)
- Cookie management on server (session store)

### When to use
- Same-origin applications (most common case)
- When you already have a session-based auth system
- Production applications where security matters

---

## Method 3: Bearer Token (Fetch Polyfill)

### How it works

Replace `EventSource` with a custom client built on `fetch()`. This gives full control over headers.

### Client code

```js
const abortController = new AbortController();

fetch('/events', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
  signal: abortController.signal,
})
.then(async (response) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by \n\n
    const messages = buffer.split('\n\n');
    buffer = messages.pop(); // keep incomplete chunk

    for (const message of messages) {
      // Parse "event:" and "data:" lines
      let event = 'message';
      let data = '';
      for (const line of message.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      // Handle the event
    }
  }
});
```

### Cancel the connection

```js
abortController.abort();
```

### Server-side: Read the header

```js
const authHeader = req.headers.authorization;
if (authHeader && authHeader.startsWith('Bearer ')) {
  const token = authHeader.slice(7);
  const username = validateToken(token);
}
```

### Pros
- Full header control — standard `Authorization: Bearer` pattern
- Token not in URL, not in logs
- Works cross-origin
- Can handle 401 responses properly (EventSource can't)

### Cons
- More complex client code
- No built-in auto-reconnect (must implement manually)
- Must manually parse SSE wire format
- Must handle stream reading and buffering

### When to use
- Cross-origin SSE connections
- When you need standard OAuth/JWT auth
- Production applications with existing token-based auth
- When you need to detect 401/403 responses

---

## Comparison

| Criteria | URL Token | Cookie | Bearer (Fetch) |
|---|---|---|---|
| **Security** | Low | High | High |
| **Complexity** | Low | Medium | High |
| **Auto-reconnect** | Yes (built-in) | Yes (built-in) | No (manual) |
| **Cross-origin** | Yes | Needs CORS setup | Yes |
| **Token in URL** | Yes | No | No |
| **Token in logs** | Yes | No | No |
| **Works with EventSource** | Yes | Yes | No |
| **Detect 401 response** | No | No | Yes |

---

## Why EventSource Can't Detect 401

When the server returns a non-2xx status, `EventSource`:
1. Fires `onerror`
2. **Does NOT reconnect** (it gives up on auth failures)
3. Provides **no status code** — you can't tell if it was 401, 500, or network error

The fetch polyfill lets you check `response.status` and handle each case differently.

---

## What's Next

The fetch-based polyfill is the foundation for production SSE. The next step is adding auto-reconnect logic with exponential backoff to match what `EventSource` does automatically.
