const http = require('http');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// Message buffer — stores all sent events
// ──────────────────────────────────────────────
//
// In a real app this would be a database, Redis, or message queue.
// Here we use a simple in-memory array to demonstrate the concept.
//
// Each entry: { id, event, data }
//
const messageBuffer = [];
let nextId = 1;

// Helper: add a message to the buffer
function bufferMessage(event, data) {
  messageBuffer.push({ id: nextId, event, data });
  nextId++;
}

// Helper: get all messages AFTER a given ID
// Returns empty array if lastId is 0 or not found
function getMessagesAfter(lastId) {
  return messageBuffer.filter((msg) => msg.id > lastId);
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
  // Route 2: SSE endpoint — Phase 3: Reconnection & Resilience
  // ──────────────────────────────────────────────
  if (req.url === '/events') {

    // ──────────────────────────────────────────────
    // Step 1: Read Last-Event-ID from the request
    // ──────────────────────────────────────────────
    //
    // When the browser reconnects after a drop, it automatically
    // sends the Last-Event-ID header with the ID of the last
    // message it successfully received.
    //
    // On first connection, this header is empty (or undefined).
    //
    const lastEventId = parseInt(req.headers['last-event-id'], 10) || 0;

    console.log(`Client connected. Last-Event-ID: ${lastEventId}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // ──────────────────────────────────────────────
    // Step 2: Replay missed messages
    // ──────────────────────────────────────────────
    //
    // If lastEventId > 0, the client is reconnecting and missed
    // some messages. Send everything it missed before starting
    // the live stream.
    //
    if (lastEventId > 0) {
      const missed = getMessagesAfter(lastEventId);
      console.log(`Replaying ${missed.length} missed message(s) since ID ${lastEventId}`);

      for (const msg of missed) {
        res.write(`id: ${msg.id}\n`);
        res.write(`event: ${msg.event}\n`);
        res.write(`data: ${msg.data}\n\n`);
      }
    }

    // ──────────────────────────────────────────────
    // Step 3: Start live streaming new messages
    // ──────────────────────────────────────────────
    //
    // Every 2 seconds: generate a new message, buffer it, send it.
    // New clients get it live. Reconnecting clients get it via replay.
    //
    const intervalId = setInterval(() => {
      const data = `Event #${nextId} at ${new Date().toISOString()}`;
      bufferMessage('message', data);

      res.write(`id: ${nextId - 1}\n`);
      res.write(`event: message\n`);
      res.write(`data: ${data}\n\n`);
    }, 2000);

    // ──────────────────────────────────────────────
    // Step 4: Heartbeat to keep connection alive
    // ──────────────────────────────────────────────
    const heartbeatId = setInterval(() => {
      res.write(`: heartbeat\n`);
    }, 15000);

    // ──────────────────────────────────────────────
    // Step 5: Cleanup on disconnect
    // ──────────────────────────────────────────────
    req.on('close', () => {
      clearInterval(intervalId);
      clearInterval(heartbeatId);
      console.log(`Client disconnected. Buffer size: ${messageBuffer.length}`);
    });

    return;
  }

  // ──────────────────────────────────────────────
  // Fallback: 404 for any unknown route
  // ──────────────────────────────────────────────
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  console.log('Buffer starts empty. Messages accumulate as clients connect.');
});
