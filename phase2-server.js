const http = require('http');
const fs = require('fs');
const path = require('path');

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
  // Route 2: SSE endpoint — Phase 2: Full event format
  // ──────────────────────────────────────────────
  if (req.url === '/events') {

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Counter to generate unique event IDs
    let eventId = 0;

    // ──────────────────────────────────────────────
    // Example 1: Default message (no event name)
    // ──────────────────────────────────────────────
    //
    // When you send ONLY "data: ..." with no "event:" field,
    // the browser fires the generic `source.onmessage` handler.
    //
    // Wire format:
    //   data: Hello world
    //   <blank line>
    //
    setInterval(() => {
      res.write(`data: [default] tick at ${new Date().toISOString()}\n\n`);
    }, 2000);

    // ──────────────────────────────────────────────
    // Example 2: Named event with "event:" field
    // ──────────────────────────────────────────────
    //
    // When you add "event: <name>", the browser fires
    // `source.addEventListener('<name>', callback)` instead of onmessage.
    //
    // Wire format:
    //   event: alert
    //   data: Something happened!
    //   <blank line>
    //
    setInterval(() => {
      res.write(`event: alert\n`);
      res.write(`data: Server alert #${++eventId}\n\n`);
    }, 5000);

    // ──────────────────────────────────────────────
    // Example 3: Event with "id:" field
    // ──────────────────────────────────────────────
    //
    // The "id:" field assigns an ID to the message.
    // The browser stores this ID and sends it back as
    // "Last-Event-ID" header when reconnecting (Phase 3).
    //
    // Wire format:
    //   id: 42
    //   event: update
    //   data: New data available
    //   <blank line>
    //
    setInterval(() => {
      res.write(`id: ${eventId}\n`);
      res.write(`event: update\n`);
      res.write(`data: Update payload — counter is ${eventId}\n\n`);
    }, 7000);

    // ──────────────────────────────────────────────
    // Example 4: Multi-line data
    // ──────────────────────────────────────────────
    //
    // Multiple "data:" lines are joined with a single newline (\n).
    // Each line must start with "data: ".
    //
    // Wire format:
    //   data: Line one
    //   data: Line two
    //   data: Line three
    //   <blank line>
    //
    // Browser receives: "Line one\nLine two\nLine three"
    //
    setInterval(() => {
      res.write(`event: multiline\n`);
      res.write(`data: Line 1: timestamp=${Date.now()}\n`);
      res.write(`data: Line 2: eventCount=${eventId}\n`);
      res.write(`data: Line 3: connection=active\n\n`);
    }, 10000);

    // ──────────────────────────────────────────────
    // Example 5: Comment lines (start with ":")
    // ──────────────────────────────────────────────
    //
    // Lines starting with ":" are comments.
    // The browser ignores them completely.
    // They are useful as heartbeat/keep-alive pings
    // to prevent idle timeouts from intermediate proxies.
    //
    // Wire format:
    //   : ping
    //
    // No blank line needed — the comment is self-terminating.
    //
    const heartbeatId = setInterval(() => {
      res.write(`: heartbeat ${new Date().toISOString()}\n`);
    }, 15000);

    // ──────────────────────────────────────────────
    // Example 6: "retry:" field
    // ──────────────────────────────────────────────
    //
    // Tells the browser how long to wait (in milliseconds)
    // before reconnecting if the connection drops.
    // Default is ~3000ms. You only need to send this once.
    //
    // Wire format:
    //   retry: 5000
    //
    // This sets reconnect delay to 5 seconds.
    //
    res.write(`retry: 5000\n`);

    // ──────────────────────────────────────────────
    // Cleanup on disconnect
    // ──────────────────────────────────────────────
    req.on('close', () => {
      clearInterval(heartbeatId);
      console.log('Client disconnected');
    });

    console.log('Client connected to /events');
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
});
