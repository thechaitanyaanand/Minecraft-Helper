'use strict';
// Live view: serves web/index.html and streams game state over Server-Sent Events.
// Bound to 127.0.0.1 only — never exposed to the LAN.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'web', 'index.html');
const clients = new Set();
const feed = [];            // recent chat/decision/event items, replayed to new viewers
let snapshot = null;

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publish(type, data) {
  if (type === 'snapshot') snapshot = data;
  else {
    feed.push({ type, data });
    if (feed.length > 100) feed.shift();
  }
  for (const res of clients) send(res, type, data);
}

function startWeb(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      if (snapshot) send(res, 'snapshot', snapshot);
      for (const item of feed) send(res, item.type, item.data);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      // read per request so page edits show up on refresh without restarting the bot
      fs.readFile(PAGE, (err, html) => {
        if (err) { res.writeHead(500); res.end(err.message); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startWeb, publish };
