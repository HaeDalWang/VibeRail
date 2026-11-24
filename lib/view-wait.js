'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_EXIT = 124;

function openBrowser(url) {
  const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => {}); // The address is always printed for manual opening.
  child.unref();
}

async function readAnswer(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('답이 너무 큽니다');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function startWait(html, { timeout = 540, open = openBrowser, output = console.log } = {}) {
  const token = randomBytes(32).toString('hex');
  const prefix = `/${token}/`;
  let used = false;
  let timer;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const server = http.createServer((req, res) => handle(req, res));
  const close = () => { clearTimeout(timer); server.close(); server.closeIdleConnections(); };
  const reply = (res, status, text, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  };
  async function handle(req, res) {
    if (req.headers.host !== new URL(url).host) return reply(res, 403, '주소가 다릅니다');
    if (req.method === 'GET' && req.url === prefix) return reply(res, 200, page, 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === prefix + 'mermaid.min.js') return reply(res, 200, fs.readFileSync(path.join(__dirname, 'mermaid.min.js')), 'text/javascript; charset=utf-8');
    if (req.method !== 'POST' || req.url !== prefix + 'answer') return reply(res, 404, '찾을 수 없습니다');
    if (req.headers.origin && req.headers.origin !== new URL(url).origin) return reply(res, 403, '이 화면에서만 보낼 수 있습니다');
    let answer;
    try { answer = await readAnswer(req); } catch { return reply(res, 400, '답을 읽을 수 없습니다'); }
    if (answer?.token !== token) return reply(res, 403, '보내기 주소가 다릅니다');
    if (used) return reply(res, 409, '이미 보냈습니다');
    if (typeof answer.text !== 'string' || !answer.text.trim()) return reply(res, 400, '답이 비어 있습니다');
    used = true;
    output(answer.text);
    reply(res, 200, '보냈습니다');
    setImmediate(() => { close(); finish(0); });
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}${prefix}`;
  const config = `<script>var waitSession=${JSON.stringify({ token, endpoint: prefix + 'answer' })};</script>`;
  const page = html.replace('</head>', config + '</head>');
  output(url);
  timer = setTimeout(() => {
    used = true;
    output('답이 오지 않았다 → 사용자에게 화면의 복사 버튼으로 답을 붙여 넣어 달라고 한다');
    close();
    server.closeAllConnections();
    finish(TIMEOUT_EXIT);
  }, timeout * 1000);
  try { open(url); } catch { /* Address above remains available when the opener fails. */ }
  return { url, token, done, close };
}

module.exports = { startWait };
