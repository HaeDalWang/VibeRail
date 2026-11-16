'use strict';

// The project side of qh: `.quality/probe.mjs` knows how to build the app, log in, and
// reach a schema-loaded database. qh only calls it, inside a child process.
//
//   export async function app({ requests })  → { app, identities?: { level: headers }, close? }
//       requests=false: qh only lists routes, so no database is needed.
//   export async function sql()              → { prepare: async (text) => void, placeholder?, close? }
//
// Throw an error with `qhEnv: true` when something outside the code is missing
// (docker, a database): qh then reports 환경 오류 instead of a code failure.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PROBE_FILE = '.quality/probe.mjs';
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i;

function envError(message) {
  return Object.assign(new Error(message), { qhEnv: true });
}

async function loadProbe(root, exportName) {
  const file = path.join(root, PROBE_FILE);
  if (!fs.existsSync(file)) throw envError(`${PROBE_FILE} 없음 (qh init이 만든 틀을 프로젝트에 맞게 채워야 한다)`);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod[exportName] !== 'function') throw envError(`${PROBE_FILE}에 export ${exportName}() 없음`);
  return mod[exportName];
}

// Probing runs real handlers (as admin, during a baseline). Refuse every connection that
// is not loopback or a unix socket, so a handler cannot reach AWS, Slack, or anything else.
function denyExternalNetwork() {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const opts = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : undefined };
    const host = opts.host ?? 'localhost';
    if (opts.path || LOOPBACK.test(host)) return original.apply(this, args);
    process.nextTick(() => this.destroy(new Error(`qh probe: external network blocked (${host}:${opts.port})`)));
    return this;
  };
}

module.exports = { PROBE_FILE, envError, loadProbe, denyExternalNetwork };
