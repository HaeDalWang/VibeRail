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
  assert.match(html, /qh 설치 직전/);
});
