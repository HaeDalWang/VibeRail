'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROBE_LIB = path.join(__dirname, '..', 'lib', 'probe.js');

// Run in a child: the guard patches net for the whole process.
test('the network guard refuses non-loopback hosts and keeps loopback working', () => {
  const script = `
    const http = require('node:http');
    require(${JSON.stringify(PROBE_LIB)}).denyExternalNetwork();
    const server = http.createServer((q, s) => s.end('ok')).listen(0, '127.0.0.1', async () => {
      const local = await (await fetch('http://127.0.0.1:' + server.address().port)).text();
      const outside = await fetch('http://192.0.2.1:8080/').then(() => 'reached', (e) => String(e.cause?.message || e.message));
      console.log(JSON.stringify({ local, outside }));
      server.close();
    });`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.local, 'ok');
  assert.match(out.outside, /external network blocked \(192\.0\.2\.1:8080\)/);
});
