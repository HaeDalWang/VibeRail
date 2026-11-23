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
