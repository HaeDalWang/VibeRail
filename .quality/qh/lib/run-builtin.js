'use strict';

// Child-process entry for built-in checks, so project code never loads into qh itself.
// Usage: node run-builtin.js <builtin> <root> <json-options>
// Prints the result JSON. Exit 0 = ok, 1 = check failed (code problem), 3 = environment
// problem ({envError}: probe missing, no database…), never judged as a code failure.
// A probe that cannot reach its database or service is that too, even without qhEnv.

const { denyExternalNetwork } = require('./probe');
const { runSqlPrepare } = require('./sql-prepare');
const { runRouteAccess } = require('./route-access');

const BUILTINS = { 'sql-prepare': runSqlPrepare, 'route-access': runRouteAccess };
const UNREACHABLE = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/;
const isEnvironment = (err) => err.qhEnv || UNREACHABLE.test(`${err.code} ${err.message}`);

async function run() {
  const [name, root, json] = process.argv.slice(2);
  const builtin = BUILTINS[name];
  if (!builtin) throw Object.assign(new Error(`unknown builtin: ${name}`), { qhEnv: true });
  denyExternalNetwork();
  const result = await builtin(root, JSON.parse(json));
  return { out: result, code: result.ok ? 0 : 1 };
}

run()
  .catch((err) => (isEnvironment(err) ? { out: { ok: false, envError: err.message }, code: 3 } : { out: { ok: false, error: err.stack || String(err) }, code: 1 }))
  // Exit explicitly once the result is flushed: probe resources (pools, timers) may
  // keep the event loop alive.
  .then(({ out, code }) => process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(code)));
