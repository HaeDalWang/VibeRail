'use strict';

// Child-process entry for built-in checks, so project code never loads into qh itself.
// Usage: node run-builtin.js <builtin> <root> <json-options>
// Prints the result JSON. Exit 0 = ok, 1 = check failed (code problem), 3 = environment
// problem ({envError}: probe missing, no database…), never judged as a code failure.
// A probe that cannot reach its database or service is that too, even without qhEnv.
// Required as a module, it only lends serviceDown() to command checks.

// A database, a host or docker that is not there: nothing in the code to fix.
const UNREACHABLE = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b|\bspawn \S+ ENOENT\b|Cannot connect to the Docker daemon/;
const isEnvironment = (err) => err.qhEnv || UNREACHABLE.test(`${err.code} ${err.message}`);
// ponytail: the last lines only and an assertion veto, read the runner's report format if a code bug hides here.
const LOG_TAIL_LINES = 40;
const MAX_REASON_CHARS = 200;

// The line of a failed command's log that says a service was unreachable, or null.
// A failing assertion means the code was judged, whatever else the log says
// (node:assert, chai and vitest print AssertionError; a Jest matcher prints expect(received)).
const ASSERTION = /AssertionError|expect\(received\)/;
function serviceDown(log) {
  const tail = String(log || '').split('\n').slice(-LOG_TAIL_LINES);
  if (tail.some((l) => ASSERTION.test(l))) return null;
  const hit = tail.find((l) => UNREACHABLE.test(l));
  return hit ? hit.trim().slice(0, MAX_REASON_CHARS) : null;
}

async function run() {
  const { denyExternalNetwork } = require('./probe');
  const BUILTINS = { 'sql-prepare': require('./sql-prepare').runSqlPrepare, 'route-access': require('./route-access').runRouteAccess };
  const [name, root, json] = process.argv.slice(2);
  const builtin = BUILTINS[name];
  if (!builtin) throw Object.assign(new Error(`unknown builtin: ${name}`), { qhEnv: true });
  denyExternalNetwork();
  const result = await builtin(root, JSON.parse(json));
  return { out: result, code: result.ok ? 0 : 1 };
}

if (require.main === module) {
  run()
    .catch((err) => (isEnvironment(err) ? { out: { ok: false, envError: err.message }, code: 3 } : { out: { ok: false, error: err.stack || String(err) }, code: 1 }))
    // Exit explicitly once the result is flushed: probe resources (pools, timers) may
    // keep the event loop alive.
    .then(({ out, code }) => process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(code)));
}

module.exports = { serviceDown };
