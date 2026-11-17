'use strict';

// The big-file limit and dead links: a moved, copied-in or accepted file is not this work growing code.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, sh, statusJson, BASIC } = require('./helpers');

const structureOf = (root) => statusJson(root).structure.join('\n');
const linesOf = (n) => `${Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n')}\n`;

test('a renamed big file is compared with its old path, not counted as new', () => {
  const root = repo(BASIC, { 'src/big.js': linesOf(900) });
  sh(root, 'git', ['mv', 'src/big.js', 'src/renamed.js']);
  assert.doesNotMatch(structureOf(root), /큰 파일/);
});

test('vendored, minified and .sql files are left out of the big-file limit', () => {
  const root = repo(BASIC);
  write(root, 'vendor/lib.js', linesOf(900));
  write(root, 'public/app.min.js', linesOf(900));
  write(root, 'db/seed.sql', linesOf(900));
  assert.doesNotMatch(structureOf(root), /큰 파일/);
});

test('a decision-log line allows one big file', () => {
  const root = repo(BASIC);
  write(root, 'src/table.js', linesOf(900));
  assert.match(structureOf(root), /큰 파일: src\/table\.js.*큰 파일 허용: src\/table\.js · 이유/);
  write(root, 'docs/decisions.md', '- 2026-11-18 · 큰 파일 허용: src/table.js · 생성된 표라 나누면 더 읽기 어렵다 · 생성기를 바꾸면\n');
  assert.doesNotMatch(structureOf(root), /큰 파일/);
});

test('a file of exactly 800 lines with a final newline is within the limit', () => {
  const root = repo(BASIC);
  write(root, 'src/full.js', linesOf(800));
  assert.doesNotMatch(structureOf(root), /큰 파일/);
});

test('a malformed percent link is reported as is instead of crashing qh', () => {
  const root = repo(BASIC);
  write(root, 'README.md', '[x](100%zz.md)\n');
  assert.match(structureOf(root), /죽은 링크: README\.md:1 → 100%zz\.md/);
  assert.ok(!fs.existsSync(path.join(root, '100%zz.md')));
});

test('a table of text entries is data, not copied code', () => {
  const entry = (i) => `  {\n    id: 'q${i}',\n    title: '질문 ${i}',\n    options: [\n      { id: 'A', label: '예 ${i}', on: '켜짐 ${i}', gain: '이득 ${i}', cost: '비용 ${i}' },\n      { id: 'B', label: '아니오 ${i}', on: '꺼짐 ${i}', gain: '없음 ${i}', cost: '나중 ${i}' },\n    ],\n  },\n`;
  const root = repo(BASIC);
  write(root, 'src/questions.js', `const QUESTIONS = [\n${Array.from({ length: 6 }, (_, i) => entry(i)).join('')}];\nmodule.exports = { QUESTIONS };\n`);
  assert.doesNotMatch(structureOf(root), /중복/);
});
