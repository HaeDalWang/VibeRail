'use strict';

// Unknown formats retain check-wide waivers; readable failure counts expose incomplete lists.
const fs = require('node:fs');
const path = require('node:path');
const { isRealReason, DECISIONS_FILE } = require('./policy');
const { readBaseline } = require('./repo-tools');

const UNNAMED_FAILURES = Symbol('unnamed failures');

function parseFailingTests(log) {
  const names = [];
  let jestPath;
  let failedCount = 0;
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of clean.split('\n')) {
    const suite = line.match(/^\s*FAIL\s+(\S+)/);
    if (suite) jestPath = suite[1];
    const count = line.match(/^\s*(?:#|ℹ) fail (\d+)\b/) || line.match(/^\s*Tests:\s*(\d+) failed\b/) || line.match(/^=+ .*?\b(\d+) failed\b.* =+$/);
    if (count) failedCount = Math.max(failedCount, Number(count[1]));
    if (jestPath && /^\s*● Test suite failed to run\s*$/.test(line)) names.push(`${jestPath} › Test suite failed to run`);
    const match = line.match(/^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/)
      || line.match(/^\s*[✖✕]\s+(.+?)(?:\s+\([\d.]+\s*m?s\))?$/)
      || line.match(/^\s*●\s+(.+\s›\s.+)$/)
      || line.match(/^FAILED\s+(\S+::\S+)/)
      || line.match(/^(ERROR\s+\S+)/)
      || line.match(/^FAIL\s+(\S+\s+\[(?:build|setup) failed\])/)
      || line.match(/^\s*--- FAIL:\s+(\S+)/);
    if (match && match[1] !== 'failing tests:') names.push(match[1].trim());
  }
  const unique = [...new Set(names)];
  // ponytail: compares raw name lines; a reporter that prints each failure twice may hide one unnamed failure.
  if (failedCount > names.length) return UNNAMED_FAILURES;
  return unique.length ? unique : null;
}

function allowedFailures(root) {
  const file = path.join(root, DECISIONS_FILE);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return [...text.matchAll(/기존 실패 허용:\s*`?([^\s`·]+)`?\s*(?:·\s*([^·\n]*))?/g)].filter((m) => isRealReason((m[2] || '').trim())).map((m) => m[1]);
}

function failureNames(root, logPath) {
  if (typeof logPath !== 'string') return null;
  const file = path.resolve(root, logPath);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return parseFailingTests(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function failureScope(root, name, logPath) {
  const names = failureNames(root, logPath);
  const baseline = readBaseline(root)?.failingTests?.[name];
  const hasBaseline = Array.isArray(baseline) && baseline.every((n) => typeof n === 'string');
  if (names === UNNAMED_FAILURES) return { newFailures: hasBaseline ? ['(unnamed failures)'] : [], missingFailureBaseline: !hasBaseline };
  return { newFailures: names && hasBaseline ? names.filter((n) => !baseline.includes(n)) : [], missingFailureBaseline: Boolean(names && !hasBaseline) };
}

const isAllowedFailure = (c, allowed) => c.state === '실패' && allowed.includes(c.name) && !c.newFailures?.length;

function baselineFailures(root) {
  const entries = allowedFailures(root).flatMap((name) => {
    const file = path.join(root, '.quality/evidence', `${name}.json`);
    let ev;
    try { ev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
      if (err.code === 'ENOENT' || err instanceof SyntaxError) return [];
      throw err;
    }
    const names = ev && Number.isInteger(ev.exit) && ev.exit !== 0 && !ev.envError && !ev.timedOut ? failureNames(root, ev.logPath) : null;
    return Array.isArray(names) ? [[name, names]] : [];
  });
  return Object.fromEntries(entries);
}

module.exports = { parseFailingTests, allowedFailures, failureScope, isAllowedFailure, baselineFailures };
