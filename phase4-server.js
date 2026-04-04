const http = require('http');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// Connection registry — tracks all active clients
// ──────────────────────────────────────────────
//
// In production this would be a Map<clientId, ConnectionInfo>.
// Each entry holds the response object and metadata.
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
// Helper: remove a client and clean up its resources
// ──────────────────────────────────────────────
function removeConnection(clientId, reason) {
  const conn = connections.get(clientId);
  if (!conn) return;

  // Clear all timers associated with this client
  clearInterval(conn.streamInterval);
  clearInterval(conn.heartbeatInterval);

  // End the HTTP response (sends EOF to the browser)
  // This is important — without it, the browser might
  // think the connection is still open.
  conn.res.end();

  connections.delete(clientId);
  console.log(`[${clientId}] Removed — ${reason} (active: ${connections.size})`);
}

const server = http.createServer((req, res) => {

  // ──────────────────────────────────────────────
  // Route 1: Serve the HTML client page
  // ──────────────────────────────────────────────
  if (req.url === '/' || req.url === '/index.html') {
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
  // Route 2: SSE endpoint — Phase 4: Connection Lifecycle
  // ──────────────────────────────────────────────
  if (req.url === '/events') {

    const clientId = `client-${++connectionCounter}`;
    const lastEventId = parseInt(req.headers['last-event-id'], 10) || 0;

    console.log(`[${clientId}] Connected. Last-Event-ID: ${lastEventId}. Active: ${connections.size + 1}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // ──────────────────────────────────────────────
    // Register this connection in the registry
    // ──────────────────────────────────────────────
    const conn = {
      res,
      clientId,
      connectedAt: new Date(),
      lastEventId,
      streamInterval: null,
      heartbeatInterval: null,
    };
    connections.set(clientId, conn);

    // ──────────────────────────────────────────────
    // Replay missed messages
    // ──────────────────────────────────────────────
    if (lastEventId > 0) {
      const missed = getMessagesAfter(lastEventId);
      console.log(`[${clientId}] Replaying ${missed.length} missed message(s)`);
      for (const msg of missed) {
        sendToClient(res, msg);
      }
    }

    // ──────────────────────────────────────────────
    // Live stream: send messages every 2 seconds
    // ──────────────────────────────────────────────
    conn.streamInterval = setInterval(() => {
      const data = `Event #${nextId} from ${clientId} at ${new Date().toISOString()}`;
      bufferMessage('message', data);

      // Send to THIS client only
      // (In Phase 5 we'll broadcast to ALL clients)
      const msg = { id: nextId - 1, event: 'message', data };
      sendToClient(res, msg);
    }, 2000);

    // ──────────────────────────────────────────────
    // Heartbeat: keep the connection alive
    // ──────────────────────────────────────────────
    conn.heartbeatInterval = setInterval(() => {
      res.write(`: heartbeat\n`);
    }, 15000);

    // ──────────────────────────────────────────────
    // Disconnect detection — multiple events can fire
    // ──────────────────────────────────────────────
    //
    // 'close' — fires when the underlying TCP socket closes.
    //   This happens when the browser tab is closed, or
    //   source.close() is called on the client.
    //
    // 'error' — fires when there's a write error (e.g.,
    //   trying to write to a closed socket). We handle it
    //   gracefully instead of crashing the server.
    //
    req.on('close', () => {
      removeConnection(clientId, 'client closed connection');
    });

    req.on('error', (err) => {
      console.error(`[${clientId}] Stream error:`, err.message);
      removeConnection(clientId, 'stream error');
    });

    return;
  }

  // ──────────────────────────────────────────────
  // Route 3: Admin endpoint — see active connections
  // ──────────────────────────────────────────────
  if (req.url === '/status') {
    const info = {
      activeConnections: connections.size,
      bufferSize: messageBuffer.length,
      nextId,
      connections: Array.from(connections.entries()).map(([id, conn]) => ({
        id,
        connectedAt: conn.connectedAt.toISOString(),
        lastEventId: conn.lastEventId,
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
// Graceful shutdown — clean up ALL connections
// ──────────────────────────────────────────────
//
// When you Ctrl+C the server, we want to:
//   1. Stop accepting new connections
//   2. Close all active SSE connections properly
//   3. Exit cleanly
//
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  console.log(`Closing ${connections.size} active connection(s)...`);

  // Close every active connection
  for (const [clientId] of connections) {
    removeConnection(clientId, 'server shutdown');
  }

  server.close(() => {
    console.log('HTTP server closed. Bye.');
    process.exit(0);
  });

  // Force exit after 5 seconds if something is stuck
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', gracefulShutdown);   // Ctrl+C
process.on('SIGTERM', gracefulShutdown);  // kill <pid>

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  console.log('  /events  — SSE stream');
  console.log('  /status  — Active connections (JSON)');
});
