'use strict';

// Facts the docs state about the project, checked against the project so they cannot drift quietly.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ADR = 'docs/adr/0001-pocock-karpathy-principles-over-qh.md';

test('the ADR says where the Pocock and Karpathy principles come from, and the scope lists only vendored skills', () => {
  const adr = read(ADR);
  assert.match(adr, /## 출처/);
  assert.match(adr, /mattpocock\/skills @5863806/);
  assert.match(adr, /Software Fundamentals Matter More Than Ever/);
  assert.match(adr, /How To De-Slop A Codebase/);
  assert.match(adr, /2차 출처/);
  assert.match(adr, /explainx\.ai\/blog\/karpathy-understand-llm-outputs-ste100-diagrams-html-video-2026/);
  const scope = adr.split('\n').find((l) => l.includes('범위:'));
  const vendored = fs.readdirSync(path.join(ROOT, 'skills/vendor/mattpocock-skills'));
  assert.ok(!/\bimplement\b/.test(scope), 'implement is not vendored');
  for (const name of scope.replace(/^.*범위:/, '').split('.')[0].split(',').map((x) => x.trim())) assert.ok(vendored.includes(name), `${name} is in the vendored folder`);
});

test('qh-cycle does not claim the Karpathy principles are inside the vendored skills', () => {
  assert.doesNotMatch(read('skills/qh-cycle/SKILL.md'), /Karpathy principles in the vendored skills/);
  assert.match(read('skills/qh-cycle/SKILL.md'), /docs\/adr\/0001/);
});
