const http = require('http');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// Valid tokens — in production this comes from a database
// ──────────────────────────────────────────────
const VALID_TOKENS = new Set([
  'token-alice-123',
  'token-bob-456',
  'token-charlie-789',
]);

// ──────────────────────────────────────────────
// Session store — maps session cookies to users
// ──────────────────────────────────────────────
// Key: "session-abc123"
// Value: { username: "alice", createdAt: Date }
const sessions = new Map();

// ──────────────────────────────────────────────
// Helper: validate a token, return username or null
// ──────────────────────────────────────────────
function validateToken(token) {
  if (!token || !VALID_TOKENS.has(token)) return null;
  // Extract username from token format: "token-<name>-<id>"
  return token.split('-')[1];
}

// ──────────────────────────────────────────────
// Helper: create a session, return session ID
// ──────────────────────────────────────────────
function createSession(username) {
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessions.set(sessionId, { username, createdAt: new Date() });
  return sessionId;
}

// ──────────────────────────────────────────────
// Helper: validate a session cookie, return username or null
// ──────────────────────────────────────────────
function validateSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return session.username;
}

// ──────────────────────────────────────────────
// Helper: parse cookies from request header
// ──────────────────────────────────────────────
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    cookies[name] = rest.join('=');
    return cookies;
  }, {});
}

// ──────────────────────────────────────────────
// Helper: send SSE message
// ──────────────────────────────────────────────
function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ──────────────────────────────────────────────
  // Route 1: Serve the auth demo page
  // ──────────────────────────────────────────────
  if (pathname === '/' || pathname === '/auth.html') {
    const filePath = path.join(__dirname, 'client', 'auth.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ──────────────────────────────────────────────
  // Route 2: POST /login — cookie-based auth
  // ──────────────────────────────────────────────
  //
  // Client sends: { token: "token-alice-123" }
  // Server responds with Set-Cookie header
  //
  if (pathname === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        const username = validateToken(token);

        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid token' }));
          return;
        }

        const sessionId = createSession(username);

        // Set HTTP-only, SameSite=Strict cookie
        // Browser will automatically send this on subsequent requests
        res.setHeader('Set-Cookie', `session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ username, message: 'Logged in successfully' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ──────────────────────────────────────────────
  // Route 3: POST /logout — destroy session
  // ──────────────────────────────────────────────
  if (pathname === '/logout' && req.method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.session;

    if (sessionId) {
      sessions.delete(sessionId);
    }

    // Clear the cookie
    res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Logged out' }));
    return;
  }

  // ──────────────────────────────────────────────
  // Route 4: GET /events — SSE endpoint with 3 auth methods
  // ──────────────────────────────────────────────
  if (pathname === '/events') {

    let username = null;
    let authMethod = null;

    // ──────────────────────────────────────────
    // Method 1: URL Token Authentication
    // ──────────────────────────────────────────
    // Client connects to: /events?token=token-alice-123
    //
    const urlToken = url.searchParams.get('token');
    if (urlToken) {
      username = validateToken(urlToken);
      authMethod = 'url-token';
    }

    // ──────────────────────────────────────────
    // Method 2: Cookie Authentication
    // ──────────────────────────────────────────
    // Browser automatically sends the session cookie
    //
    if (!username) {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.session) {
        username = validateSession(cookies.session);
        authMethod = 'cookie';
      }
    }

    // ──────────────────────────────────────────
    // Method 3: Authorization Header (fetch polyfill)
    // ──────────────────────────────────────────
    // Client sends: Authorization: Bearer token-alice-123
    //
    if (!username) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        username = validateToken(token);
        authMethod = 'bearer';
      }
    }

    // ──────────────────────────────────────────
    // Auth failed — no valid credentials
    // ──────────────────────────────────────────
    if (!username) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Authentication required',
        methods: [
          'URL token: /events?token=token-alice-123',
          'Cookie: POST /login first, then browser sends cookie automatically',
          'Bearer header: Authorization: Bearer token-alice-123',
        ],
      }));
      return;
    }

    // ──────────────────────────────────────────
    // Auth succeeded — open SSE stream
    // ──────────────────────────────────────────
    console.log(`[${username}] Connected via ${authMethod}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send welcome message
    sendSSE(res, 'welcome', `Authenticated as "${username}" via ${authMethod}`);

    // Stream messages every 2 seconds
    let msgCount = 0;
    const intervalId = setInterval(() => {
      msgCount++;
      sendSSE(res, 'message', `Message #${msgCount} for ${username}`);
    }, 2000);

    // Heartbeat
    const heartbeatId = setInterval(() => {
      res.write(`: heartbeat\n`);
    }, 15000);

    // Cleanup
    req.on('close', () => {
      clearInterval(intervalId);
      clearInterval(heartbeatId);
      console.log(`[${username}] Disconnected`);
    });

    return;
  }

  // ──────────────────────────────────────────────
  // Fallback: 404
  // ──────────────────────────────────────────────
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  console.log('');
  console.log('Valid tokens for testing:');
  console.log('  token-alice-123');
  console.log('  token-bob-456');
  console.log('  token-charlie-789');
  console.log('');
  console.log('Test URL token auth:');
  console.log('  curl "http://localhost:3000/events?token=token-alice-123"');
  console.log('');
  console.log('Test cookie auth:');
  console.log('  curl -X POST http://localhost:3000/login -H "Content-Type: application/json" -d \'{"token":"token-alice-123"}\' -c -');
});
