const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function send(res, code, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const requestPath = urlPath === '/' ? '/index.html' : urlPath;
  const normalized = path.posix.normalize(requestPath).replace(/^\.\.(\/|$)+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (!err) {
      const ext = path.extname(filePath).toLowerCase();
      send(res, 200, data, MIME[ext] || 'application/octet-stream');
      return;
    }

    // If a direct asset/file path is missing, return 404 instead of HTML fallback.
    if (path.extname(normalized)) {
      send(res, 404, 'Not found');
      return;
    }

    // SPA fallback for route-like URLs.
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (indexErr, indexData) => {
      if (indexErr) {
        send(res, 404, 'Not found');
        return;
      }
      send(res, 200, indexData, MIME['.html']);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Diary app running at http://localhost:${PORT}`);
});
