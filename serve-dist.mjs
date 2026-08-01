import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join } from 'path';

const ROOT = './dist';
const PORT = process.env.PORT || 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  let path = req.url.split('?')[0];
  if (path.endsWith('/')) path += 'index.html';
  let filePath = join(ROOT, path);
  if (!existsSync(filePath)) {
    filePath = join(ROOT, path, 'index.html');
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const body = await readFile(filePath);
  res.writeHead(200, { 'content-type': mime });
  res.end(body);
});

server.listen(PORT, () => console.log(`dist server: http://127.0.0.1:${PORT}/`));
