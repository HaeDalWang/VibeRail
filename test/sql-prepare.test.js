'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractLiterals, runSqlPrepare } = require('../lib/sql-prepare');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-sql-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const SCHEMA = 'CREATE TABLE tickets (id TEXT PRIMARY KEY, title TEXT, company_id TEXT);';
const opts = { migrations: 'migrations/*.sql', src: ['src/**/*.js'] };

test('extractLiterals: strings, templates, comments, regex and lines', async () => {
  const src = [
    "const a = 'one'; // 'not this'",
    '/* "nor this" */ const b = "two";',
    'const c = `three ${x + `inner`} end`;',
    "const r = /'quote'/g; const d = 'four';",
  ].join('\n');
  const lits = extractLiterals(src);
  assert.deepStrictEqual(
    lits.map((l) => [l.text, l.line, l.hasExpr]),
    [
      ['one', 1, false],
      ['two', 2, false],
      ['inner', 3, false],
      ['three ? end', 3, true],
      ['four', 4, false],
    ],
  );
});

test('passes when every SQL statement matches the migrated schema', async () => {
  const root = project({
    'migrations/001.sql': SCHEMA,
    'src/a.js': "db.prepare('SELECT id, title FROM tickets WHERE company_id = ?');\nconst label = 'Select a company';",
  });
  const r = await runSqlPrepare(root, opts);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.checked, 1);
  assert.deepStrictEqual(r.failures, []);
});

test('fails on INSERT into a column the schema does not have', async () => {
  const root = project({
    'migrations/001.sql': SCHEMA,
    'src/a.js': "\n\ndb.prepare(`INSERT INTO tickets (id, title, assignee_id) VALUES (?, ?, ?)`);",
  });
  const r = await runSqlPrepare(root, opts);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].file, 'src/a.js');
  assert.strictEqual(r.failures[0].line, 3);
  assert.match(r.failures[0].error, /assignee_id/);
});

test('a migration that renames a column breaks untouched code', async () => {
  const root = project({
    'migrations/001.sql': SCHEMA,
    'migrations/002.sql': 'ALTER TABLE tickets RENAME COLUMN title TO subject;',
    'src/a.js': "db.prepare('SELECT title FROM tickets');",
  });
  const r = await runSqlPrepare(root, opts);
  assert.strictEqual(r.ok, false);
  assert.match(r.failures[0].error, /title/);
});

test('templates: value placeholders are checked, dynamic identifiers become unchecked', async () => {
  const root = project({
    'migrations/001.sql': SCHEMA,
    'src/a.js': [
      'db.prepare(`SELECT id FROM tickets WHERE id = ${id}`);',
      'db.prepare(`SELECT id FROM ${table} WHERE id = ?`);',
      'db.prepare(`SELECT nope FROM tickets WHERE id = ${id}`);',
    ].join('\n'),
  });
  const r = await runSqlPrepare(root, opts);
  assert.strictEqual(r.checked, 2);
  assert.strictEqual(r.unchecked.length, 1);
  assert.strictEqual(r.unchecked[0].line, 2);
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].line, 3);
});

test('a broken migration is a failure, not a pass', async () => {
  const root = project({ 'migrations/001.sql': 'CREATE TABL oops;', 'src/a.js': '' });
  const r = await runSqlPrepare(root, opts);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.failures[0].file, 'migrations/001.sql');
});

test('without migrations the probe sql() prepares, and Postgres wording counts as a schema error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-sqlprobe-'));
  fs.mkdirSync(path.join(root, '.quality'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.mjs'), "q(`SELECT ok FROM t WHERE x = ${v}`); q('SELECT nope FROM t'); q(`SELECT a FROM ${tbl}`)");
  fs.writeFileSync(path.join(root, '.quality/probe.mjs'), `export async function sql() {
  return { placeholder: 'NULL', prepare: async (text) => {
    if (text.includes('nope')) throw new Error('column "nope" does not exist')
    if (/FROM NULL/.test(text)) throw new Error('syntax error at or near "NULL"')
  } }
}`);
  const r = await runSqlPrepare(root, { src: ['src/**/*.mjs'] });
  assert.strictEqual(r.checked, 2);
  assert.deepStrictEqual(r.failures.map((f) => f.error), ['column "nope" does not exist']);
  assert.deepStrictEqual(r.unchecked.map((u) => u.sql), ['SELECT a FROM NULL']);
});
