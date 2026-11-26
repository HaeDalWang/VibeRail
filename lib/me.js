'use strict';

// The per-person file: the person's background and word list (단어집). It stays on this
// computer (gitignored) because it describes a person; qh writes only its `## 배경` body.

const fs = require('node:fs');
const path = require('node:path');
const { section } = require('./card');

const ME_FILE = '.quality/me.md';
const EMPTY = '# 나 (이 컴퓨터에만 · 저장소에 올리지 않음)\n\n## 배경\n\n## 단어집\n| 개발 말 | 내 말 |\n|---|---|\n';

const readMe = (root) => {
  const file = path.join(root, ME_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

// Background text and word-list rows (table lines after the header and separator).
function me(root) {
  const text = readMe(root);
  if (text === null) return { background: '', rows: [] };
  const rows = (section(text, '단어집') || '').split('\n').filter((l) => /^\s*\|/.test(l)).slice(2).filter((l) => l.replace(/[|\s-]/g, ''));
  return { background: section(text, '배경') || '', rows };
}

// The ignore line goes in before the write, so the file can never be committed by accident.
function ensureIgnored(root) {
  const file = path.join(root, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === ME_FILE)) return;
  fs.writeFileSync(file, `${text.replace(/\n*$/, text ? '\n' : '')}${ME_FILE}\n`);
}

function saveBackground(root, background) {
  ensureIgnored(root);
  const text = readMe(root) ?? EMPTY;
  const base = /^## 배경[ \t]*$/m.test(text) ? text : `${text.replace(/\n*$/, '\n')}\n## 배경\n`;
  // Only the body under `## 배경` (up to the next `## ` or the end) is replaced.
  const out = base.replace(/^(## 배경[ \t]*\n)[\s\S]*?(?=^## |(?![\s\S]))/m, (_, head) => `${head}${background}\n\n`);
  fs.mkdirSync(path.join(root, '.quality'), { recursive: true });
  fs.writeFileSync(path.join(root, ME_FILE), out.replace(/\n*$/, '\n'));
}

// One session-start line for the agent, or null when the person wrote nothing.
function wordsLine(root) {
  const { background, rows } = me(root);
  if (rows.length) return `The person has a word list in ${ME_FILE} → speak to the person with the word list in everything you write to them (questions, choices, pages, reports); a development word with no match stays as is with a short gloss in brackets; when the person says a word was unclear, add a row; never replace GLOSSARY.md terms.`;
  if (background) return `The person wrote a background in ${ME_FILE} but has no word list → before the first grilling, draft about ten rows (the development words this cycle uses most, in the person's field) into its 단어집 table, show them once, and use them; a word with no match stays as is with a short gloss in brackets.`;
  return null;
}

module.exports = { ME_FILE, me, saveBackground, wordsLine };
