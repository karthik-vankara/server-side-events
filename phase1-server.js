const http = require('http');
const fs = require('fs');
const path = require('path');

// Create a basic HTTP server — no frameworks, just raw Node.js
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
  // Route 2: SSE endpoint — this is the core
  // ──────────────────────────────────────────────
  if (req.url === '/events') {

    // These 3 headers are what make SSE work:
    // 1. Content-Type: text/event-stream  →  tells the browser "this is an SSE stream, not a normal HTTP response"
    // 2. Cache-Control: no-cache          →  prevents proxies/browsers from caching the stream
    // 3. Connection: keep-alive           →  tells the underlying TCP connection to stay open
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send a message to the client every 2 seconds.
    // In a real app this would be database changes, notifications, etc.
    const intervalId = setInterval(() => {
      // SSE wire format:
      //   data: <your message here>
      //   <blank line>
      //
      // The "data: " prefix marks the payload.
      // The double newline (\n\n) tells the browser "this message is complete, deliver it now."
      const message = `Server time: ${new Date().toISOString()}`;
      res.write(`data: ${message}\n\n`);
    }, 2000);

    // When the browser tab is closed or the EventSource is destroyed,
    // the server detects it via the 'close' event on the request.
    // We MUST clean up the interval here, otherwise it leaks.
    req.on('close', () => {
      clearInterval(intervalId);
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
