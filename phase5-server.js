const http = require('http');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// Connection registry — tracks all active clients
// ──────────────────────────────────────────────
//
// Each client has:
//   - res: the HTTP response stream
//   - subscriptions: Set of event types they want (e.g. "alert", "update")
//   - connectedAt: timestamp
//
const connections = new Map();
let connectionCounter = 0;

// ──────────────────────────────────────────────
// Message buffer — stores all sent events
// ──────────────────────────────────────────────
const messageBuffer = [];
let nextId = 1;

function bufferMessage(event, data) {
  messageBuffer.push({ id: nextId, event, data });
  nextId++;
}

function getMessagesAfter(lastId) {
  return messageBuffer.filter((msg) => msg.id > lastId);
}

// ──────────────────────────────────────────────
// Helper: send an SSE message to a specific client
// ──────────────────────────────────────────────
function sendToClient(res, msg) {
  res.write(`id: ${msg.id}\n`);
  res.write(`event: ${msg.event}\n`);
  res.write(`data: ${msg.data}\n\n`);
}

// ──────────────────────────────────────────────
// Helper: broadcast a message to ALL connected clients
// ──────────────────────────────────────────────
//
// Each client only receives events they are subscribed to.
// The "*" subscription means "receive everything."
//
function broadcast(event, data) {
  const msg = { id: nextId, event, data };
  bufferMessage(event, data);

  let sentCount = 0;
  for (const [clientId, conn] of connections) {
    // Client gets the message if:
    //   1. They subscribed to this specific event type, OR
    //   2. They subscribed to "*" (everything)
    if (conn.subscriptions.has(event) || conn.subscriptions.has('*')) {
      sendToClient(conn.res, msg);
      sentCount++;
    }
  }

  console.log(`[broadcast] event="${event}" → sent to ${sentCount}/${connections.size} clients`);
  nextId++;
}

// ──────────────────────────────────────────────
// Helper: remove a client and clean up
// ──────────────────────────────────────────────
function removeConnection(clientId, reason) {
  const conn = connections.get(clientId);
  if (!conn) return;

  clearInterval(conn.heartbeatInterval);
  conn.res.end();
  connections.delete(clientId);
  console.log(`[${clientId}] Removed — ${reason} (active: ${connections.size}, subs: ${Array.from(conn.subscriptions).join(', ')})`);
}

const server = http.createServer((req, res) => {

  // Parse the pathname (without query string) for route matching
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  // ──────────────────────────────────────────────
  // Route 1: Serve the HTML client page
  // ──────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'client', 'index.html');
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
  // Route 2: SSE endpoint — Phase 5: Multi-Client Pub/Sub
  // ──────────────────────────────────────────────
  if (pathname === '/events') {

    const clientId = `client-${++connectionCounter}`;
    const lastEventId = parseInt(req.headers['last-event-id'], 10) || 0;

    // Parse subscriptions from query string
    // Example: /events?subscribe=alert,update
    const url = new URL(req.url, `http://${req.headers.host}`);
    const subscribeParam = url.searchParams.get('subscribe');
    const subscriptions = subscribeParam
      ? new Set(subscribeParam.split(',').map((s) => s.trim()))
      : new Set(['*']); // Default: subscribe to everything

    console.log(`[${clientId}] Connected. Subs: ${Array.from(subscriptions).join(', ')}. Last-Event-ID: ${lastEventId}. Active: ${connections.size + 1}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Register connection
    const conn = {
      res,
      clientId,
      subscriptions,
      connectedAt: new Date(),
      lastEventId,
      heartbeatInterval: null,
    };
    connections.set(clientId, conn);

    // Replay missed messages (only ones the client is subscribed to)
    if (lastEventId > 0) {
      const missed = getMessagesAfter(lastEventId);
      const relevant = missed.filter(
        (msg) => subscriptions.has(msg.event) || subscriptions.has('*')
      );
      console.log(`[${clientId}] Replaying ${relevant.length}/${missed.length} missed message(s)`);
      for (const msg of relevant) {
        sendToClient(res, msg);
      }
    }

    // Heartbeat
    conn.heartbeatInterval = setInterval(() => {
      res.write(`: heartbeat\n`);
    }, 15000);

    // Disconnect cleanup
    req.on('close', () => {
      removeConnection(clientId, 'client closed connection');
    });

    req.on('error', () => {
      removeConnection(clientId, 'stream error');
    });

    return;
  }

  // ──────────────────────────────────────────────
  // Route 3: POST /broadcast — send a message to all clients
  // ──────────────────────────────────────────────
  //
  // Usage:
  //   curl -X POST http://localhost:3000/broadcast \
  //     -H "Content-Type: application/json" \
  //     -d '{"event": "alert", "data": "System maintenance at midnight"}'
  //
  if (pathname === '/broadcast' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { event, data } = JSON.parse(body);
        if (!event || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Both "event" and "data" are required' }));
          return;
        }
        broadcast(event, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sent: true, event, data }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // ──────────────────────────────────────────────
  // Route 4: GET /status — see active connections
  // ──────────────────────────────────────────────
  if (pathname === '/status') {
    const info = {
      activeConnections: connections.size,
      bufferSize: messageBuffer.length,
      nextId,
      connections: Array.from(connections.entries()).map(([id, conn]) => ({
        id,
        connectedAt: conn.connectedAt.toISOString(),
        subscriptions: Array.from(conn.subscriptions),
      })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info, null, 2));
    return;
  }

  // ──────────────────────────────────────────────
  // Fallback: 404
  // ──────────────────────────────────────────────
  res.writeHead(404);
  res.end('Not Found');
});

// ──────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  for (const [clientId] of connections) {
    removeConnection(clientId, 'server shutdown');
  }
  server.close(() => {
    console.log('HTTP server closed. Bye.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  console.log('  /events              — SSE stream (add ?subscribe=alert,update to filter)');
  console.log('  POST /broadcast      — Send a message to all clients');
  console.log('  GET  /status         — Active connections (JSON)');
});
