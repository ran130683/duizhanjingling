const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const maxBodyBytes = 25 * 1024 * 1024;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function safeName(value) {
  return String(value || 'avatar')
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'avatar';
}

function extensionFromMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/svg+xml') return 'svg';
  return 'webp';
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function saveAsset(req, res) {
  try {
    const body = await readJsonBody(req);
    const kind = body.kind === 'pet' ? 'pets' : 'heroes';
    const match = String(body.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('缺少有效图片数据');
    const mime = match[1];
    if (!mime.startsWith('image/')) throw new Error('仅支持图片');
    const ext = extensionFromMime(mime);
    const id = safeName(body.id || Date.now());
    const name = safeName(body.name || kind.slice(0, -1));
    const dir = path.join(root, 'assets', kind);
    const filename = `${name}-${id}.${ext}`;
    const filePath = path.join(dir, filename);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, Buffer.from(match[2], 'base64'));
    send(res, 200, JSON.stringify({
      ok: true,
      url: `/assets/${kind}/${encodeURIComponent(filename)}`,
    }));
  } catch (err) {
    send(res, 400, JSON.stringify({ ok: false, error: err.message }));
  }
}

async function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const decodedPath = decodeURIComponent(reqUrl.pathname);
  const requested = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch (err) {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/assets') {
    saveAsset(req, res);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }
  send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
});

server.listen(port, () => {
  console.log(`Card formation server running at http://localhost:${port}`);
});
