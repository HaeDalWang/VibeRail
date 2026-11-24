'use strict';

// The measure report shows each metric's first -> now numbers only: no verdict made by
// counting changes, no 개선/악화 label that fires on any change.

const test = require('node:test');
const assert = require('node:assert');
const { page } = require('../lib/measure-page');

const html = page('demo', [{ date: '2026-11-01', sha: 'abc', files_over_800: '1' }, { date: '2026-11-10', sha: 'def', files_over_800: '0' }], [['코드', [['files_over_800', '800줄 넘는 파일', '설명', 'lower', null]]]]);

test('the report does not tally metrics into 개선/악화/유지 counts or label changes good or bad', () => {
  assert.doesNotMatch(html, /개선 '\+|악화 '\+|유지 '\+|건 \//, 'no count verdict');
  assert.doesNotMatch(html, /pill (good|bad)|>개선<|>악화<|>유지<|>참고</, 'no per-metric good/bad pill');
  assert.doesNotMatch(html, /verdict '\+|verdict\.good|verdict\.bad/, 'no good/bad verdict colour');
});

test('the report still shows first -> now with the delta text and the before/after-qh split', () => {
  assert.match(html, /class="from"/);
  assert.match(html, /class="delta"/);
  assert.match(html, /VibeRail 설치 직전/);
});

// Runs the page script against stub elements and returns what it wrote into each id.
function rendered(rows, groups) {
  const out = {};
  const el = (id) => (out[id] ||= { innerHTML: '', textContent: '' });
  const script = page('demo', rows, groups).match(/<script>([\s\S]*)<\/script>/)[1];
  require('node:vm').runInNewContext(script, { document: { getElementById: el } });
  return out;
}

const GROUPS = [['코드', [['files_over_800', '800줄 넘는 파일', '설명', 'lower', null], ['decision_lines', '결정 로그 줄 수', '설명', null, null]]]];

test('a metric measured once shows no earlier value in its tile, even when other days exist', () => {
  const r = rendered([{ date: '2026-11-01', sha: 'a', decision_lines: '3' }, { date: '2026-11-10', sha: 'b', decision_lines: '5', files_over_800: '2', withQh: '1' }], GROUPS);
  assert.doesNotMatch(r.tiles.innerHTML, /class="from"/, 'one measurement has no "before →"');
});

test('the summary names the judged metrics it compares, so a changed reference row does not contradict it', () => {
  const r = rendered([{ date: '2026-11-01', sha: 'a', files_over_800: '1', decision_lines: '3' }, { date: '2026-11-10', sha: 'b', files_over_800: '1', decision_lines: '12' }], GROUPS);
  assert.match(r.verdict.innerHTML, /주요 지표/);
  assert.doesNotMatch(r.verdict.innerHTML, /달라진 항목 없음/);
});


test('report shows short interface reasons share and repeated blocks by kind as reference metrics', () => {
  const { repo, write, BASIC } = require('./helpers');
  const { measure, logStop, GROUPS } = require('../lib/measure');
  const root = repo(BASIC);
  const cards = [
    '## interface 결정\n안: A\n',
    '## interface 결정\n이유:   \n## 다음\n이유: 여기만 길게 적음\n',
    '## interface 결정\n- **이유:** 짧다\n',
    '## interface 결정\n이유: 다섯글자임\n',
    '## 의도\n작은 변경은 interface 선택 없음\n',
  ];
  cards.forEach((card, i) => write(root, `.quality/tasks/feat/card-${i}.md`, card));
  logStop(root, { aiFix: ['TDD: a', 'TDD: b'], human: [] });
  logStop(root, { aiFix: ['TDD: a', '문서 영향: a'], human: [] });
  const result = measure(root);
  assert.strictEqual(result.now.interface_reason_short_pct, 75);
  assert.strictEqual(result.now.block_tdd, 2);
  assert.strictEqual(result.now.block_docs, 1);
  const shown = rendered([result.now], GROUPS);
  assert.match(shown.hist.innerHTML, /이유가 없거나 5자 미만인 카드/);
  assert.match(shown.hist.innerHTML, /75/);
  assert.match(shown.hist.innerHTML, /같은 종류로 막힌 횟수/);
  assert.ok(GROUPS.flatMap(([, items]) => items).filter(([k]) => k === 'interface_reason_short_pct' || k.startsWith('block_')).every((item) => item[3] === 'ref'));
});

test('interface reason share is unmeasured when no card has an interface decision', () => {
  const { repo, BASIC } = require('./helpers');
  assert.strictEqual(require('../lib/measure').measure(repo(BASIC)).now.interface_reason_short_pct, null);
});

test('interface reason share counts only cards still present in the working tree', () => {
  const { repo, write, BASIC } = require('./helpers');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = repo(BASIC, { '.quality/tasks/removed.md': '## interface 결정\n이유:\n' });
  fs.rmSync(path.join(root, '.quality/tasks/removed.md'));
  write(root, '.quality/tasks/current.md', '## interface 결정\n이유: 다섯글자임\n');
  assert.strictEqual(require('../lib/measure').measure(root).now.interface_reason_short_pct, 0);
});

test('unavailable coverage is explicit in the latest tile and historical cells', () => {
  const groups = [['테스트', [['untested_pct', '테스트가 안 붙은 코드 파일', '%', 'lower']]]];
  const r = rendered([{ date: '2026-11-01', rules: 5, untested_pct: 20 }, { date: '2026-11-10', rules: 5, untested_pct: null }], groups);
  assert.match(r.tiles.innerHTML, /잴 수 없음/);
  assert.doesNotMatch(r.tiles.innerHTML, /20/);
  assert.match(r.hist.innerHTML, /잴 수 없음/);
});
