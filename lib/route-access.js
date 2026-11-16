'use strict';

// Built-in check "route-access": every route of an Express 5 app must be declared in the
// access table (.quality/access.json), and a caller below the declared level must be
// refused (401/403). The app and the identities come from the project's probe.
// Modes: requests=false lists routes only (no DB needed); baseline=true records what
// the app does today as a first access table.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { envError, loadProbe } = require('./probe');

const ACCESS_FILE = '.quality/access.json';
const PROBE_PARAM = 'qh-probe';
const REQUEST_TIMEOUT_MS = 5000;
const isRefused = (status) => status === 401 || status === 403;
const isAllowed = (status) => status >= 200 && status < 300;

// Express 5 keeps no mount path for sub-routers on the stack (checked 2026-11-16,
// express 5.3.0), so record it by wrapping Router.prototype.use of the project's own
// "router" package while the probe builds the app.
async function buildApp(root, requests) {
  const makeApp = await loadProbe(root, 'app');
  let routerProto;
  try {
    const projectRequire = createRequire(path.join(root, 'package.json'));
    routerProto = createRequire(projectRequire.resolve('express'))('router').prototype;
  } catch {
    throw envError('프로젝트에서 express를 찾지 못함 (npm install 필요)');
  }
  const mountPaths = new WeakMap();
  const originalUse = routerProto.use;
  routerProto.use = function use(first, ...rest) {
    if (typeof first === 'string') for (const fn of rest.flat()) mountPaths.set(fn, first);
    return originalUse.call(this, first, ...rest);
  };
  try {
    const built = await makeApp({ requests });
    if (!built?.app?.router) throw new Error('probe app()이 { app } (Express 5 앱)을 돌려주지 않음');
    return { ...built, identities: built.identities || {}, mountPaths };
  } finally {
    routerProto.use = originalUse;
  }
}

function joinPath(prefix, p) {
  const joined = `${prefix}/${p}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

// app.all() registers every method in http.METHODS one by one (express 5.3.0
// application.js); router.all() sets methods._all. Both become one "ALL /path" entry.
function routeMethods(methods) {
  const names = Object.keys(methods).filter((m) => m !== '_all');
  if (methods._all || http.METHODS.every((m) => names.includes(m.toLowerCase()))) return ['ALL'];
  return names.map((m) => m.toUpperCase());
}

function listRoutes(stack, mountPaths, prefix = '') {
  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const p of [layer.route.path].flat()) {
        for (const method of routeMethods(layer.route.methods)) routes.push(`${method} ${joinPath(prefix, String(p))}`);
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      const mount = mountPaths.get(layer.handle);
      if (mount === undefined) throw new Error('sub-router mounted without a string path; cannot list its routes');
      routes.push(...listRoutes(layer.handle.stack, mountPaths, joinPath(prefix, mount)));
    }
  }
  return routes;
}

function readAccess(root) {
  const file = path.join(root, ACCESS_FILE);
  if (!fs.existsSync(file)) throw envError(`${ACCESS_FILE} 없음 (\`qh routes --baseline\`으로 현재 동작을 기준선으로 만든다)`);
  const { levels, routes = {} } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(levels) || levels.length < 2) throw new Error(`${ACCESS_FILE}: levels는 낮은 것부터 2개 이상`);
  const table = new Map();
  for (const [key, value] of Object.entries(routes)) {
    const [methods, routePath] = key.trim().split(/\s+/);
    const level = typeof value === 'string' ? value : value.level;
    if (!levels.includes(level)) throw new Error(`${ACCESS_FILE}: ${key}의 수준 "${level}"이 levels에 없음`);
    for (const m of methods.split('|')) table.set(`${m.toUpperCase()} ${routePath}`, level);
  }
  return { levels, table };
}

// Resolves on the status line, so streaming endpoints cannot hang the probe.
// ponytail: an ALL route is probed with POST only; per-method probing if a catch-all guards GET differently.
function request(port, routeMethod, routePath, headers) {
  const method = routeMethod === 'ALL' ? 'POST' : routeMethod;
  return new Promise((resolve) => {
    const url = routePath.replace(/:\w+/g, PROBE_PARAM);
    // A body without content-length goes out chunked, and some servers answer that with a bare 400.
    const body = method === 'GET' || method === 'HEAD' ? undefined : '{}';
    const sized = body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { ...sized, ...headers } }, (res) => {
      resolve(res.statusCode);
      res.destroy();
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve(err.message === 'timeout' ? 'timeout' : 'error'));
    req.end(body);
  });
}

function identityHeaders(levels, identities, k) {
  if (k === 0) return {};
  const headers = identities[levels[k]];
  if (!headers) throw envError(`probe app()의 identities에 수준 "${levels[k]}"이 없음`);
  return headers;
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(server.address().port);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

// Each declared route is called as every identity below its level; all must be refused.
async function probeTable(port, table, levels, identities) {
  const failures = [];
  const inconclusive = [];
  for (const [route, level] of table) {
    const [method, routePath] = route.split(' ');
    for (let k = 0; k < levels.indexOf(level); k++) {
      const status = await request(port, method, routePath, identityHeaders(levels, identities, k));
      if (isRefused(status)) continue;
      if (isAllowed(status)) failures.push({ route, as: levels[k], status, reason: 'allowed' });
      else inconclusive.push({ route, as: levels[k], status });
    }
  }
  return { failures, inconclusive };
}

// Lowest level the app does not refuse. Anything but 2xx there is a guess for a person.
async function probeBaseline(port, routes, levels, identities) {
  const result = {};
  const uncertain = [];
  for (const route of routes) {
    const [method, routePath] = route.split(' ');
    let entry = { level: levels.at(-1), check: '모든 수준이 거부함' };
    for (let k = 0; k < levels.length; k++) {
      const status = await request(port, method, routePath, identityHeaders(levels, identities, k));
      if (isRefused(status)) continue;
      entry = isAllowed(status) ? levels[k] : { level: levels[k], check: `${levels[k]}에서 ${status} (2xx 아님)` };
      break;
    }
    result[route] = entry;
    if (typeof entry !== 'string') uncertain.push(route);
  }
  return { routes: result, uncertain };
}

async function runRouteAccess(root, { requests = true, baseline = false, levels: baselineLevels } = {}) {
  const built = await buildApp(root, requests || baseline);
  try {
    const routes = [...new Set(listRoutes(built.app.router.stack, built.mountPaths))].sort();
    if (baseline) {
      const levels = baselineLevels || readAccess(root).levels;
      const b = await withServer(built.app, (port) => probeBaseline(port, routes, levels, built.identities));
      return { ok: true, baseline: { levels, routes: b.routes }, uncertain: b.uncertain };
    }
    const { levels, table } = readAccess(root);
    const undeclared = routes.filter((r) => !table.has(r));
    const stale = [...table.keys()].filter((r) => !routes.includes(r)).map((route) => ({ route, reason: 'stale' }));
    for (const s of stale) table.delete(s.route);
    const probed = requests ? await withServer(built.app, (port) => probeTable(port, table, levels, built.identities)) : { failures: [], inconclusive: [] };
    const failures = [...stale, ...probed.failures];
    return { ok: failures.length === 0, routes, undeclared, failures, inconclusive: probed.inconclusive };
  } finally {
    await built.close?.();
  }
}

module.exports = { ACCESS_FILE, runRouteAccess };
