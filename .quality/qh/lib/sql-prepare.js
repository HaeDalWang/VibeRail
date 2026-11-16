'use strict';

// Built-in check "sql-prepare": prepare() every SQL literal found in the source against
// an empty, schema-loaded database. Catches SQL that names a table/column the schema
// does not have, before that code path ever runs.
// SQLite: `migrations` (glob of .sql files) is applied to an in-memory DB.
// Anything else (Postgres…): the project's probe sql() gives the prepare function.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { loadProbe } = require('./probe');

const SQL_RE = /^\s*(select\b[\s\S]*\bfrom\b|insert\s+into\b|update\s+\S+\s+set\b|delete\s+from\b|with\s+\S+\s+as\s*\()/i;
// Placeholders are "?", so a schema-reference error always names an identifier written
// in the literal itself. Anything else (syntax errors from dynamic identifiers or SQL
// fragments joined with +) cannot be judged and is reported as unchecked.
// SQLite and Postgres wording.
const SCHEMA_ERR_RE = /no such (table|column)|has no column named|(column|relation) "[^"]+" (of relation "[^"]+" )?does not exist/i;
const REGEX_PREFIX = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const ESCAPES = { n: '\n', t: '\t', r: '\r' };

// ponytail: hand-rolled JS scanner (comments, strings, nested templates, regex by
// previous-char heuristic; `return /re/` is misread as division). Switch to acorn if
// the scan misses literals in a real project.
function extractLiterals(src, placeholder = '?') {
  const out = [];
  const templates = []; // stack of open templates whose ${…} we are currently inside
  let i = 0;
  let line = 1;
  let lastSig = '';

  const readEscaped = () => {
    const next = src[i + 1];
    if (next === '\n') line++;
    i += 2;
    return ESCAPES[next] ?? next;
  };

  // Reads template text from i until the closing backtick or the next "${".
  const readTemplate = (ctx) => {
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { ctx.text += readEscaped(); continue; }
      if (ch === '`') {
        i++;
        templates.pop();
        out.push({ text: ctx.text, line: ctx.line, hasExpr: ctx.hasExpr });
        return;
      }
      if (ch === '$' && src[i + 1] === '{') {
        i += 2;
        ctx.text += placeholder;
        ctx.hasExpr = true;
        ctx.depth = 0;
        return;
      }
      if (ch === '\n') line++;
      ctx.text += ch;
      i++;
    }
  };

  const readString = (quote) => {
    const start = line;
    let text = '';
    i++;
    while (i < src.length && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') { text += readEscaped(); continue; }
      text += src[i++];
    }
    i++;
    out.push({ text, line: start, hasExpr: false });
  };

  const skipRegex = () => {
    let inClass = false;
    i++;
    while (i < src.length && src[i] !== '\n') {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) { i++; return; }
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i];
    const top = templates[templates.length - 1];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] === '\n') line++;
      continue;
    }
    if (ch === '/' && (lastSig === '' || REGEX_PREFIX.has(lastSig))) {
      skipRegex();
      lastSig = 'a';
      continue;
    }
    if (ch === '"' || ch === "'") {
      readString(ch);
      lastSig = 'a';
      continue;
    }
    if (ch === '`') {
      const ctx = { text: '', line, hasExpr: false, depth: 0 };
      templates.push(ctx);
      i++;
      readTemplate(ctx);
      lastSig = 'a';
      continue;
    }
    if (top && ch === '{') top.depth++;
    if (top && ch === '}') {
      if (top.depth === 0) {
        i++;
        readTemplate(top);
        lastSig = 'a';
        continue;
      }
      top.depth--;
    }
    lastSig = ch;
    i++;
  }
  return out;
}

function globFiles(root, patterns) {
  const files = new Set();
  for (const pattern of [].concat(patterns)) {
    for (const f of fs.globSync(pattern, { cwd: root })) {
      if (!f.split(path.sep).includes('node_modules')) files.add(f.split(path.sep).join('/'));
    }
  }
  return [...files].sort();
}

function sqliteAdapter(root, migrations) {
  const db = new DatabaseSync(':memory:');
  for (const file of globFiles(root, migrations)) {
    try {
      db.exec(fs.readFileSync(path.join(root, file), 'utf8'));
    } catch (err) {
      db.close();
      return { migrationFailure: { file, line: 1, error: `migration failed: ${err.message}` } };
    }
  }
  return { prepare: (sql) => db.prepare(sql), close: () => db.close() };
}

async function runSqlPrepare(root, { migrations, src }) {
  const adapter = migrations ? sqliteAdapter(root, migrations) : await (await loadProbe(root, 'sql'))();
  if (adapter.migrationFailure) return { ok: false, checked: 0, failures: [adapter.migrationFailure], unchecked: [] };
  const failures = [];
  const unchecked = [];
  let checked = 0;
  try {
    for (const file of globFiles(root, src)) {
      const literals = extractLiterals(fs.readFileSync(path.join(root, file), 'utf8'), adapter.placeholder);
      for (const lit of literals.filter((l) => SQL_RE.test(l.text))) {
        const sql = lit.text.trim();
        try {
          await adapter.prepare(sql);
          checked++;
        } catch (err) {
          if (SCHEMA_ERR_RE.test(err.message)) {
            checked++;
            failures.push({ file, line: lit.line, sql, error: err.message });
          } else {
            unchecked.push({ file, line: lit.line, sql, error: err.message });
          }
        }
      }
    }
  } finally {
    await adapter.close?.();
  }
  return { ok: failures.length === 0, checked, failures, unchecked };
}

module.exports = { extractLiterals, runSqlPrepare };
