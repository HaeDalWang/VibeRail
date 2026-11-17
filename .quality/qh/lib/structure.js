'use strict';

// Structure ratchet, judged on what this work touched (never on a repo-wide total: a
// total lets one place's cleanup pay for another's new copy, and only says "worse"
// too late to point anywhere).
// - Duplicates: any copied block in a touched file blocks, new or old — whoever touches
//   a file cleans its copies. The report names the existing copy, so the agent reuses it.
//   An exception is a docs/decisions.md line with "중복 허용" and the file path.
//   duplicates: "grown" (config structure) blocks only when the touched file has more copied
//   lines than at the base; copies it already had are shown as a warning (for a repository
//   that already holds many copies).
// - Big files: a code file over the limit may not grow.
// - Root files: a new file at the repository root needs a reason in the decision log.
// - Dead links: a changed doc may not link to a file that does not exist.
// Set by the project in config `structure` (each off when its key is absent):
// - flatRoots: a new file directly under these folders needs a reason (same as the top level).
// - noGrow: these documents may not get longer.
// - forbidden: no new file under these folders.
// - patterns (in docs): a changed doc may not gain matches (ticket numbers in docs, …).
// - backtickRefs: a path in `backticks` inside a changed doc must exist.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CODE_EXT, TEST_FILE, OWN_FILES, VENDORED, MAX_SCAN_BYTES, DECISIONS_FILE } = require('./policy');

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

const lineTotal = (text) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

function normalize(line) {
  return line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, 'S')
    .replace(/\/\/.*$|\/\*.*?\*\//g, '')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/\s+/g, '');
}

// Only keys and literal values (`{id:S,label:S}`, `[S,S],`): a text table, which every entry shares once literals are S.
const isDataLine = (key) => /^[SN,;:{}[\]()]*$/.test(key.replace(/\w+:/g, '').replace(/\b(true|false|null)\b/g, 'N'));

// Meaningful lines of one file: [{ line, key }], line numbers 1-based.
function meaningful(text) {
  return text.split('\n').flatMap((raw, i) => {
    const key = normalize(raw);
    return key.length >= MIN_LINE_CHARS && !SKIP_LINE.test(key) && !isDataLine(key) ? [{ line: i + 1, key }] : [];
  });
}

function windowsFrom(file, text) {
  const lines = meaningful(text);
  const windows = [];
  for (let i = 0; i + DUP_WINDOW <= lines.length; i++) {
    const key = lines.slice(i, i + DUP_WINDOW).map((l) => l.key).join('\n');
    windows.push({ key, lines: lines.slice(i, i + DUP_WINDOW).map((l) => l.line), file, line: lines[i].line, pos: i });
  }
  return windows;
}

// ponytail: rebuilds the index of every code file on each call (fine for thousands of
// files); cache per blob hash if Stop gets slow on a big repository.
function duplicateIndex(root) {
  const files = (gitOut(root, ['ls-files', '-co', '--exclude-standard']) || '').split('\n')
    .filter((f) => CODE_EXT.test(f) && !OWN_FILES.test(f) && !VENDORED.test(f) && !TEST_FILE.test(f) && !/\.min\./.test(f));
  const index = new Map();
  const windowsOf = new Map();
  for (const f of files) {
    const text = readText(root, f);
    if (text === null) continue;
    const windows = windowsFrom(f, text);
    for (const w of windows) {
      if (!index.has(w.key)) index.set(w.key, []);
      index.get(w.key).push(w);
    }
    windowsOf.set(f, windows);
  }
  return { index, windowsOf };
}

// A window has a copy elsewhere: another file, or far enough away in the same file.
const copiesOf = (index, w) => index.get(w.key).filter((o) => o.file !== w.file || Math.abs(o.pos - w.pos) >= DUP_WINDOW);

// A copy the project accepted: a decision-log line with "중복 허용" and the file path.
const isAllowedCopy = (decisions, f) => decisions.split('\n').some((l) => l.includes('중복 허용') && l.includes(f));

// Lines of file f with a copy, from f's windows at one version, against the other files today.
// ponytail: the base side compares with other files as they are now, not at the base; a copy
// whose twin this work also edits is judged in that file too.
function copiedLineCount(index, f, windows) {
  const byKey = Map.groupBy(windows, (w) => w.key);
  const isCopied = (w) => (index.get(w.key) || []).some((o) => o.file !== f) || byKey.get(w.key).some((o) => Math.abs(o.pos - w.pos) >= DUP_WINDOW);
  return new Set(windows.filter(isCopied).flatMap((w) => w.lines)).size;
}

const capped = (out, label) => (out.length > MAX_REPORTED ? [...out.slice(0, MAX_REPORTED), `${label}: 그 밖에 ${out.length - MAX_REPORTED}쌍 더`] : out);

// { problems, warnings }. Default: every copy in a touched file blocks. grownOnly: only a file
// whose copied lines grew since the base blocks; the others are warnings.
function duplicateFindings(root, changed, decisions, { base, grownOnly }) {
  const { index, windowsOf } = duplicateIndex(root);
  const allowed = (f) => isAllowedCopy(decisions, f);
  const pairs = new Map();
  for (const f of changed) {
    if (!windowsOf.has(f) || allowed(f)) continue;
    for (const w of windowsOf.get(f)) {
      for (const other of copiesOf(index, w)) {
        const [a, b] = [w, other].sort((x, y) => (x.file + x.pos < y.file + y.pos ? -1 : 1));
        const id = `${a.file}\n${b.file}`;
        const p = pairs.get(id);
        if (!p) pairs.set(id, { a, b, windows: 1, touched: f });
        else p.windows += 1;
      }
    }
  }
  const growth = new Map();
  const grew = (f) => {
    if (!growth.has(f)) {
      const was = base ? gitOut(root, ['show', `${base}:${f}`]) : null;
      const before = was === null ? 0 : copiedLineCount(index, f, windowsFrom(f, was));
      const now = copiedLineCount(index, f, windowsOf.get(f));
      growth.set(f, now > before ? `이 파일 중복 ${before}줄 → ${now}줄` : null);
    }
    return growth.get(f);
  };
  const problems = [];
  const warnings = [];
  for (const { a, b, windows, touched } of pairs.values()) {
    const [mine, theirs] = a.file === touched ? [a, b] : [b, a];
    const where = `${mine.file}:${mine.line} ↔ ${theirs.file}:${theirs.line} (의미 있는 줄 ${windows + DUP_WINDOW - 1}줄 이상 같음)`;
    if (grownOnly && !grew(touched)) warnings.push(`중복(원래 있던 것, 막지 않음): ${where} → 이 파일을 손볼 때 합치면 좋다`);
    else problems.push(`중복: ${where}${grownOnly ? ` · ${grew(touched)}` : ''} → 기존 것을 재사용하거나 한 곳으로 합친다. 정말 둘이어야 하면 ${DECISIONS_FILE}에 \`중복 허용: ${mine.file} · 이유\``);
  }
  return { problems: capped(problems, '중복'), warnings: capped(warnings, '중복(원래 있던 것)') };
}

// Repository-wide picture for PR, init and measure (Q24): lines that have a copy somewhere,
// and the files holding most of them. Accepted copies are left out. Reported only; blocking
// stays on what the work touched.
function duplicateStats(root) {
  const { index, windowsOf } = duplicateIndex(root);
  const decisions = readText(root, DECISIONS_FILE) || '';
  const perFile = [];
  for (const [f, windows] of windowsOf) {
    if (isAllowedCopy(decisions, f)) continue;
    const copied = new Set(windows.filter((w) => copiesOf(index, w).length).flatMap((w) => w.lines));
    if (copied.size) perFile.push([f, copied.size]);
  }
  perFile.sort((a, b) => b[1] - a[1]);
  return { total: perFile.reduce((n, [, c]) => n + c, 0), perFile };
}

function duplicateTotal(root, top = 3) {
  const { total, perFile } = duplicateStats(root);
  return total ? `중복 합계(참고, 막지 않음): ${total}줄 · ${perFile.slice(0, top).map(([f, c]) => `${f} ${c}`).join(', ')}` : '중복 합계(참고, 막지 않음): 0줄';
}

// Moved, copied-in, minified and data (.sql) files are not this work growing code.
function bigFileProblems(root, changed, base, decisions) {
  const renamed = new Map((gitOut(root, ['diff', '-M', '--name-status', base]) || '').split('\n')
    .map((l) => l.split('\t')).filter(([s]) => s?.startsWith('R')).map(([, from, to]) => [to, from]));
  const out = [];
  for (const f of changed.filter((x) => CODE_EXT.test(x) && !OWN_FILES.test(x) && !VENDORED.test(x) && !/\.min\.|\.sql$/.test(x))) {
    if (decisions.split('\n').some((l) => l.includes('큰 파일 허용') && l.includes(f))) continue;
    const now = lineTotal(readText(root, f));
    if (now <= MAX_FILE_LINES) continue;
    const was = lineTotal(gitOut(root, ['show', `${base}:${renamed.get(f) || f}`]));
    if (now > was) out.push(`큰 파일: ${f}가 ${now}줄(기준 ${was || '없음'}, 한도 ${MAX_FILE_LINES}) → 늘리지 말고 기능별로 나눈다. 나누면 더 나빠지는 파일이면 ${DECISIONS_FILE}에 \`큰 파일 허용: ${f} · 이유\``);
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

// A malformed %-escape is a broken link, not a reason to crash.
const safeDecode = (s) => { try { return decodeURI(s); } catch { return s; } };

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
        const rel = safeDecode(target.split(/[#?]/)[0]);
        const file = rel.startsWith('/') ? path.join(root, rel) : path.join(root, path.dirname(f), rel);
        if (rel && !fs.existsSync(file)) out.push(`죽은 링크: ${f}:${i + 1} → ${target} 가 없다. 링크를 고치거나 지운다`);
      }
    });
  }
  return out;
}

// ---------- project-set rules (config.structure) ----------

const atBaseText = (root, base, f) => gitOut(root, ['show', `${base}:${f}`]);
const isNewFile = (root, base, f) => spawnSync('git', ['cat-file', '-e', `${base}:${f}`], { cwd: root }).status !== 0 && isPlainFile(root, f);
const underAny = (f, dirs) => dirs.some((d) => f.startsWith(`${d.replace(/\/+$/, '')}/`));
const isDoc = (f) => /\.mdx?$/.test(f) && !f.startsWith('.quality/qh/');

// Lines outside fenced code blocks: [{ line, text }].
function proseLines(text) {
  let fence = null;
  return text.split('\n').flatMap((line, i) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) { fence = marker; return []; }
    if (marker && marker[0] === fence[0] && marker.length >= fence.length) { fence = null; return []; }
    return fence ? [] : [{ line: i + 1, text: line }];
  });
}

function flatRootProblems(root, changed, base, decisions, dirs) {
  return changed
    .filter((f) => dirs.some((d) => path.posix.dirname(f) === d.replace(/\/+$/, '')) && isNewFile(root, base, f))
    .filter((f) => !decisions.split('\n').some((l) => l.includes('루트 파일') && l.includes(f)))
    .map((f) => `정리 대상 폴더: ${path.posix.dirname(f)}/ 바로 아래 새 파일 ${f} → 기능별 하위 폴더에 둔다. 꼭 여기여야 하면 ${DECISIONS_FILE}에 \`루트 파일: ${f} · 이유\``);
}

function noGrowProblems(root, changed, base, decisions, docs) {
  return changed.filter((f) => docs.includes(f)).flatMap((f) => {
    const [nowText, wasText] = [readText(root, f) || '', atBaseText(root, base, f) || ''];
    const [now, was] = [lineTotal(nowText), lineTotal(wasText)];
    const [nowBytes, wasBytes] = [Buffer.byteLength(nowText), Buffer.byteLength(wasText)];
    if ((now <= was && nowBytes <= wasBytes) || decisions.split('\n').some((l) => l.includes('문서 증가 허용') && l.includes(f))) return [];
    return [`문서 증가: ${f}가 ${was}줄 → ${now}줄(${wasBytes} → ${nowBytes}바이트) → 기존 문단을 고쳐 쓰고 지난 이력은 커밋 메시지로. 정말 늘어야 하면 ${DECISIONS_FILE}에 \`문서 증가 허용: ${f} · 이유\``];
  });
}

function forbiddenProblems(root, changed, base, dirs) {
  return changed.filter((f) => underAny(f, dirs) && isNewFile(root, base, f))
    .map((f) => `금지 위치: ${f} → 이 폴더(${dirs.find((d) => underAny(f, [d]))})에는 새 파일을 두지 않는다(프로젝트 규칙). 필요한 내용은 맞는 문서·폴더로`);
}

const patternRe = (p) => new RegExp(p.regex, 'gm');
const countIn = (lines, re) => lines.reduce((n, l) => n + (l.text.match(re) || []).length, 0);

// patterns with in: "docs". The code-comment ones live in code-shape (they need a parser).
function docPatternProblems(root, changed, base, patterns) {
  const out = [];
  for (const p of patterns.filter((x) => x.in === 'docs')) {
    const re = patternRe(p);
    for (const f of changed.filter((x) => isDoc(x) && !underAny(x, p.exclude || []))) {
      const text = readText(root, f);
      if (text === null) continue;
      const now = countIn(proseLines(text), re);
      const was = countIn(proseLines(atBaseText(root, base, f) || ''), re);
      if (now > was) out.push(`문서 규칙 "${p.name}": ${f}에서 ${was}개 → ${now}개${p.fix ? ` → ${p.fix}` : ''}`);
    }
  }
  return out;
}

// A path in `backticks` whose first folder exists at the top of the repository. Resolved from
// the top and from each extra base (`bases`, e.g. a server folder whose docs name paths from
// there). Wildcards and placeholders (`dir/*.sql`, `dir/<name>`) check the folder only; a name
// ending in - or _ is a prefix (`deploy/app-`); git-ignored paths are made at run time.
function backtickRefProblems(root, files, bases) {
  const tops = new Set(fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name));
  if (!tops.size) return [];
  const pathRe = new RegExp(`(?<![\\w./-])((?:${[...tops].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/[\\w./-]+)`, 'g');
  const exists = (p) => {
    if (fs.existsSync(path.join(root, p))) return true;
    if (!/[-_]$/.test(p)) return false;
    const dir = path.join(root, path.dirname(p));
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).some((n) => n.startsWith(path.basename(p)));
  };
  const ignored = (p) => [p, `${p}/`].some((x) => spawnSync('git', ['check-ignore', '-q', '--no-index', '--', x], { cwd: root }).status === 0);
  const out = [];
  for (const f of files.filter(isDoc)) {
    const text = readText(root, f);
    if (text === null) continue;
    const seen = new Set();
    for (const { line, text: l } of proseLines(text)) {
      for (const [, span] of l.matchAll(/`([^`\n]+)`/g)) {
        for (const m of span.matchAll(pathRe)) {
          const isPlaceholder = /[*<{]/.test(span[m.index + m[1].length] || '');
          const ref = (isPlaceholder ? path.posix.dirname(m[1]) : m[1]).replace(/[./]+$/, '');
          if (!ref.includes('/') || seen.has(ref)) continue;
          seen.add(ref);
          if (bases.some((b) => exists(path.posix.join(b, ref))) || ignored(ref)) continue;
          out.push(`죽은 링크: ${f}:${line} → \`${ref}\` 가 없다. 지금 경로로 고치거나, 지난 이야기면 문장을 지운다`);
        }
      }
    }
  }
  return out;
}

const refBases = (structure) => (structure?.backtickRefs ? ['.', ...(Array.isArray(structure.backtickRefs) ? structure.backtickRefs : [])] : null);

// Dead links and, when the project turned them on, dead `backtick` paths.
function deadRefProblems(root, files, structure) {
  const bases = refBases(structure);
  return [...deadLinkProblems(root, files), ...(bases ? backtickRefProblems(root, files, [...new Set(bases)]) : [])];
}

// A deleted or moved file leaves dead references in documents this work did not touch.
// Those documents are read only for the gone paths (old dead links there are not this work's).
function goneRefProblems(root, changed, structure) {
  const gone = changed.filter((f) => !fs.existsSync(path.join(root, f)));
  if (!gone.length) return [];
  const names = [...new Set(gone.map((f) => path.posix.basename(f)))];
  const docs = (gitOut(root, ['ls-files', '-co', '--exclude-standard', '*.md', '*.mdx']) || '').split('\n').filter((f) => f && !changed.includes(f) && isDoc(f));
  const hits = docs.filter((f) => names.some((n) => (readText(root, f) || '').includes(n)));
  return deadRefProblems(root, hits, structure).filter((p) => names.some((n) => p.includes(n)));
}

// { problems, warnings }: problems block, warnings are shown only.
function structureFindings(root, { changed, base, structure = {} }) {
  const decisions = readText(root, DECISIONS_FILE) || '';
  const dup = duplicateFindings(root, changed, decisions, { base, grownOnly: structure.duplicates === 'grown' });
  const problems = [
    ...dup.problems,
    ...bigFileProblems(root, changed, base, decisions),
    ...rootFileProblems(root, changed, base, decisions),
    ...deadRefProblems(root, changed, structure),
    ...(structure.backtickRefs ? goneRefProblems(root, changed, structure) : []),
    ...(structure.flatRoots ? flatRootProblems(root, changed, base, decisions, structure.flatRoots) : []),
    ...(structure.noGrow ? noGrowProblems(root, changed, base, decisions, structure.noGrow) : []),
    ...(structure.forbidden ? forbiddenProblems(root, changed, base, structure.forbidden) : []),
    ...(structure.patterns ? docPatternProblems(root, changed, base, structure.patterns) : []),
  ];
  return { problems, warnings: dup.warnings };
}

module.exports = { structureFindings, duplicateTotal, duplicateStats, deadLinkProblems, deadRefProblems, proseLines, MAX_FILE_LINES };
