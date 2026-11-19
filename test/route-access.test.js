'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runRouteAccess } = require('../lib/route-access');

const NODE_MODULES = path.join(__dirname, '..', 'node_modules');

// A tiny app: header x-user-id = "m" (member) or "a" (admin).
const APP = (extra = '') => `'use strict';
const express = require('express');
function authenticate(req, res, next) {
  const role = { m: 'member', a: 'admin' }[req.get('x-user-id')];
  if (!role) return res.status(401).end();
  req.user = { role };
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).end();
  next();
}
function createApp() {
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));
  const items = express.Router();
  items.get('/', (req, res) => res.json([]));
  items.get('/:id', (req, res) => res.status(404).end());
  const nested = express.Router();
  nested.post('/', (req, res) => res.status(201).end());
  items.use('/:id/notes', nested);
  app.use('/items', authenticate, items);
  app.get('/admin/stats', authenticate, requireAdmin, (req, res) => res.json({}));
  ${extra}
  return app;
}
module.exports = { createApp };
`;

const PROBE = `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export async function app({ requests }) {
  globalThis.qhRequests = requests
  return { app: require('../src/app.js').createApp(), identities: { member: { 'x-user-id': 'm' }, admin: { 'x-user-id': 'a' } } }
}
`;
const LEVELS = ['public', 'member', 'admin'];

function project(appSource, access = BASE_ACCESS, probe = PROBE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-routes-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","private":true}');
  fs.symlinkSync(NODE_MODULES, path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.quality'));
  fs.writeFileSync(path.join(root, 'src/app.js'), appSource);
  if (probe) fs.writeFileSync(path.join(root, '.quality/probe.mjs'), probe);
  if (access) fs.writeFileSync(path.join(root, '.quality/access.json'), JSON.stringify({ levels: LEVELS, routes: access }));
  return root;
}

const BASE_ACCESS = {
  'GET /health': 'public',
  'GET /items': 'member',
  'GET /items/:id': 'member',
  'POST /items/:id/notes': 'member',
  'GET /admin/stats': 'admin',
};

test('lists routes under mounted and nested routers and passes when guards hold', async () => {
  const r = await runRouteAccess(project(APP()));
  assert.deepStrictEqual(r.routes.sort(), Object.keys(BASE_ACCESS).sort());
  assert.deepStrictEqual(r.failures, []);
  assert.deepStrictEqual(r.undeclared, []);
  assert.strictEqual(r.ok, true);
});

test('accepts "GET|POST /path" keys', async () => {
  const access = { ...BASE_ACCESS, 'GET|POST /things': 'member' };
  delete access['GET /health'];
  const extra = "app.get('/health', (q, s) => s.end()); app.get('/things', authenticate, (q, s) => s.json([])); app.post('/things', authenticate, (q, s) => s.status(201).end());";
  const r = await runRouteAccess(project(APP(extra), { ...access, 'GET /health': 'public' }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('a new route missing from the access table is undeclared, for a person to decide', async () => {
  const r = await runRouteAccess(project(APP("app.get('/audit-logs', authenticate, (q, s) => s.json([]));")));
  assert.deepStrictEqual(r.undeclared, ['GET /audit-logs']);
  assert.strictEqual(r.ok, true);
});

test('app.all() is one ALL entry probed with POST, and an array path lists each path', async () => {
  const extra = "app.all('/jobs/:op', authenticate, requireAdmin, (q, s) => s.json({})); app.get(['/a', '/b'], (q, s) => s.end());";
  const r = await runRouteAccess(project(APP(extra), { ...BASE_ACCESS, 'ALL /jobs/:op': 'admin', 'GET /a': 'public', 'GET /b': 'public' }));
  assert.deepStrictEqual(r.undeclared, []);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('a declared admin route without the admin guard fails when a member gets 2xx', async () => {
  const extra = "app.get('/admin/export', authenticate, (q, s) => s.json([]));";
  const r = await runRouteAccess(project(APP(extra), { ...BASE_ACCESS, 'GET /admin/export': 'admin' }));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.failures, [{ route: 'GET /admin/export', as: 'member', status: 200, reason: 'allowed' }]);
});

test('a declared route the app no longer has is a stale declaration', async () => {
  const r = await runRouteAccess(project(APP(), { ...BASE_ACCESS, 'GET /gone': 'member' }));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.failures, [{ route: 'GET /gone', reason: 'stale' }]);
});

test('404 before the guard is counted as inconclusive, not as a pass', async () => {
  const extra = "app.get('/admin/item/:id', authenticate, (q, s) => s.status(404).end());";
  const r = await runRouteAccess(project(APP(extra), { ...BASE_ACCESS, 'GET /admin/item/:id': 'admin' }));
  assert.deepStrictEqual(r.inconclusive, [{ route: 'GET /admin/item/:id', as: 'member', status: 404 }]);
  assert.strictEqual(r.ok, true);
});

test('list-only mode needs no requests: undeclared and stale still show, guards are not probed', async () => {
  const extra = "app.get('/admin/export', authenticate, (q, s) => s.json([])); app.get('/audit-logs', (q, s) => s.json([]));";
  const r = await runRouteAccess(project(APP(extra), { ...BASE_ACCESS, 'GET /admin/export': 'admin', 'GET /gone': 'member' }), { requests: false });
  assert.deepStrictEqual(r.undeclared, ['GET /audit-logs']);
  assert.deepStrictEqual(r.failures, [{ route: 'GET /gone', reason: 'stale' }]);
});

test('baseline records the lowest level each route lets through, and marks non-2xx guesses', async () => {
  const r = await runRouteAccess(project(APP(), null), { baseline: true, levels: LEVELS });
  assert.deepStrictEqual(r.baseline.routes, {
    'GET /admin/stats': 'admin',
    'GET /health': 'public',
    'GET /items': 'member',
    'GET /items/:id': { level: 'member', check: 'member에서 404 (2xx 아님)' },
    'POST /items/:id/notes': 'member',
  });
  assert.deepStrictEqual(r.uncertain, ['GET /items/:id']);
});

test('routes --baseline --labels stores a Korean label per level, and refuses a count that does not match', () => {
  const { qh, repo, write } = require('./helpers');
  const root = repo({ baseRef: 'main', checks: {} }, { 'package.json': '{"name":"t","private":true}', 'src/app.js': APP(), '.quality/probe.mjs': PROBE });
  fs.symlinkSync(NODE_MODULES, path.join(root, 'node_modules'));
  write(root, '.gitignore', 'node_modules/\n');
  const bad = qh(root, ['routes', '--baseline', '--levels', 'public,member,admin', '--labels', '누구나,회원']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /이름/);
  assert.ok(!fs.existsSync(path.join(root, '.quality/access.json')));
  const ok = qh(root, ['routes', '--baseline', '--levels', 'public,member,admin', '--labels', '누구나,회원,관리자']);
  assert.strictEqual(ok.status, 0, ok.stderr + ok.stdout);
  const access = JSON.parse(fs.readFileSync(path.join(root, '.quality/access.json'), 'utf8'));
  assert.deepStrictEqual(access.labels, { public: '누구나', member: '회원', admin: '관리자' });
  assert.deepStrictEqual(access.levels, ['public', 'member', 'admin']);
});

test('a missing probe is an environment problem, not a code failure', async () => {
  await assert.rejects(runRouteAccess(project(APP(), BASE_ACCESS, null)), (err) => err.qhEnv === true && /probe\.mjs 없음/.test(err.message));
});
