'use strict';

// Structure ratchet, judged on what this work touched (never on a repo-wide total: a
// total lets one place's cleanup pay for another's new copy, and only says "worse"
// too late to point anywhere).
// - Duplicates: any copied block in a touched file blocks, new or old — whoever touches
//   a file cleans its copies. The report names the existing copy, so the agent reuses it.
//   An exception is a docs/decisions.md line with "중복 허용" and the file path.
// - Big files: a code file over the limit may not grow.
// - Root files: a new file at the repository root needs a reason in the decision log.
// - Dead links: a changed doc may not link to a file that does not exist.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CODE_EXT, TEST_FILE, OWN_FILES, MAX_SCAN_BYTES, DECISIONS_FILE } = require('./policy');

// A copy is this many consecutive meaningful lines that read the same once whitespace,
// comments and literal values are set aside.
const DUP_WINDOW = 6;
const MIN_LINE_CHARS = 8;
const MAX_FILE_LINES = 800;
const MAX_REPORTED = 5;
const SKIP_LINE = /^(import\b|export\b.*\bfrom\b|const\b.*=require\(|#|\/\/|\/?\*)/;

const gitOut = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};
const readText = (root, f) => {
  const file = path.join(root, f);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_SCAN_BYTES) return null;
  const text = fs.readFileSync(file, 'utf8');
  return text.includes('\0') ? null : text;
};

function normalize(line) {
  return line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, 'S')
    .replace(/\/\/.*$|\/\*.*?\*\//g, '')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/\s+/g, '');
}

// Meaningful lines of one file: [{ line, key }], line numbers 1-based.
function meaningful(text) {
  return text.split('\n').flatMap((raw, i) => {
    const key = normalize(raw);
    return key.length >= MIN_LINE_CHARS && !SKIP_LINE.test(key) ? [{ line: i + 1, key }] : [];
  });
}

// ponytail: rebuilds the index of every code file on each call (fine for thousands of
// files); cache per blob hash if Stop gets slow on a big repository.
function duplicateProblems(root, changed, decisions) {
  const files = (gitOut(root, ['ls-files', '-co', '--exclude-standard']) || '').split('\n')
    .filter((f) => CODE_EXT.test(f) && !OWN_FILES.test(f) && !TEST_FILE.test(f) && !/\.min\./.test(f));
  const index = new Map();
  const windowsOf = new Map();
  for (const f of files) {
    const text = readText(root, f);
    if (text === null) continue;
    const lines = meaningful(text);
    const windows = [];
    for (let i = 0; i + DUP_WINDOW <= lines.length; i++) {
      const key = lines.slice(i, i + DUP_WINDOW).map((l) => l.key).join('\n');
      const at = { file: f, line: lines[i].line, pos: i };
      windows.push({ key, ...at });
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(at);
    }
    windowsOf.set(f, windows);
  }
  const allowed = (f) => decisions.split('\n').some((l) => l.includes('중복 허용') && l.includes(f));
  const pairs = new Map();
  for (const f of changed) {
    if (!windowsOf.has(f) || allowed(f)) continue;
    for (const w of windowsOf.get(f)) {
      for (const other of index.get(w.key)) {
        if (other.file === f && Math.abs(other.pos - w.pos) < DUP_WINDOW) continue;
        const [a, b] = [w, other].sort((x, y) => (x.file + x.pos < y.file + y.pos ? -1 : 1));
        const id = `${a.file}\n${b.file}`;
        const p = pairs.get(id);
        if (!p) pairs.set(id, { a, b, windows: 1, touched: f });
        else p.windows += 1;
      }
    }
  }
  const out = [...pairs.values()].map(({ a, b, windows, touched }) => {
    const [mine, theirs] = a.file === touched ? [a, b] : [b, a];
    return `중복: ${mine.file}:${mine.line} ↔ ${theirs.file}:${theirs.line} (의미 있는 줄 ${windows + DUP_WINDOW - 1}줄 이상 같음) → 기존 것을 재사용하거나 한 곳으로 합친다. 정말 둘이어야 하면 ${DECISIONS_FILE}에 \`중복 허용: ${mine.file} · 이유\``;
  });
  return out.length > MAX_REPORTED ? [...out.slice(0, MAX_REPORTED), `중복: 그 밖에 ${out.length - MAX_REPORTED}쌍 더 (위를 고친 뒤 다시 본다)`] : out;
}

function bigFileProblems(root, changed, base) {
  const out = [];
  for (const f of changed.filter((x) => CODE_EXT.test(x) && !OWN_FILES.test(x))) {
    const text = readText(root, f);
    if (text === null) continue;
    const now = text.split('\n').length;
    if (now <= MAX_FILE_LINES) continue;
    const before = gitOut(root, ['show', `${base}:${f}`]);
    const was = before === null ? 0 : before.split('\n').length;
    if (now > was) out.push(`큰 파일: ${f}가 ${now}줄(기준 ${was || '없음'}, 한도 ${MAX_FILE_LINES}) → 늘리지 말고 기능별로 나눈다`);
  }
  return out;
}

// A link to a folder (a shared node_modules) is not a file someone put at the top.
const isPlainFile = (root, f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile();

function rootFileProblems(root, changed, base, decisions) {
  const atBase = new Set((gitOut(root, ['ls-tree', '--name-only', base]) || '').split('\n'));
  return changed
    // Dotfiles at the top are tool settings (.gitignore, .mcp.json) that have to live there.
    .filter((f) => !f.includes('/') && !f.startsWith('.') && !atBase.has(f) && isPlainFile(root, f) && !OWN_FILES.test(f))
    .filter((f) => !decisions.split('\n').some((l) => l.includes('루트 파일') && l.includes(f)))
    .map((f) => `루트 파일: 저장소 맨 위에 새 파일 ${f} → 맞는 폴더로 옮기거나, 맨 위에 둘 이유를 ${DECISIONS_FILE}에 \`루트 파일: ${f} · 이유\``);
}

function deadLinkProblems(root, changed) {
  const out = [];
  for (const f of changed.filter((x) => /\.mdx?$/.test(x) && !x.startsWith('.quality/qh/'))) {
    const text = readText(root, f);
    if (text === null) continue;
    let isFence = false;
    text.split('\n').forEach((line, i) => {
      if (/^\s*```/.test(line)) isFence = !isFence;
      if (isFence) return;
      for (const [, target] of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        if (/^([a-z]+:|#)/i.test(target)) continue;
        const rel = decodeURI(target.split(/[#?]/)[0]);
        const file = rel.startsWith('/') ? path.join(root, rel) : path.join(root, path.dirname(f), rel);
        if (rel && !fs.existsSync(file)) out.push(`죽은 링크: ${f}:${i + 1} → ${target} 가 없다. 링크를 고치거나 지운다`);
      }
    });
  }
  return out;
}

function structureProblems(root, { changed, base }) {
  const decisions = readText(root, DECISIONS_FILE) || '';
  return [
    ...duplicateProblems(root, changed, decisions),
    ...bigFileProblems(root, changed, base),
    ...rootFileProblems(root, changed, base, decisions),
    ...deadLinkProblems(root, changed),
  ];
}

module.exports = { structureProblems };
