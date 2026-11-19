'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isAllowedBy } = require('../lib/policy');

const dec = '- 2026-11-18 · 큰 파일 허용: src/data.js · 이 파일은 표라서 나눌 수 없음 · 표를 바꾸면\n';

test('an allow line names one exact path, not any substring of the line', () => {
  assert.strictEqual(isAllowedBy(dec, '큰 파일 허용', 'src/data.js'), true);
  for (const f of ['a.js', 'ta.js', 'src/dat', 'data.js']) assert.strictEqual(isAllowedBy(dec, '큰 파일 허용', f), false, f);
});

test('an allow line without the dot separator still reads the first word as the path', () => {
  assert.strictEqual(isAllowedBy('- 중복 허용: src/a.js 외부 계약이라 따로 둔다\n', '중복 허용', 'src/a.js'), true);
  assert.strictEqual(isAllowedBy('- 중복 허용: src/a.js 외부 계약이라 따로 둔다\n', '중복 허용', 'a.js'), false);
});

test('an allow line may name several paths separated by commas, each exactly', () => {
  const multi = '- 큰 파일 허용: a.js, src/b.js · 표 데이터라 나눌 수 없음\n';
  assert.strictEqual(isAllowedBy(multi, '큰 파일 허용', 'a.js'), true);
  assert.strictEqual(isAllowedBy(multi, '큰 파일 허용', 'src/b.js'), true);
  assert.strictEqual(isAllowedBy(multi, '큰 파일 허용', 'b.js'), false);
});
