'use strict';

// `qh pr` and the PR status: blocked only by what this work or its person can settle.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, sh, qh, DECLARED, BASIC, QH, TEST_ENV } = require('./helpers');

const REVIEW_OK = { cmd: "node -e \"require('fs').writeFileSync(process.argv[1]+'/result.json','[]')\" {out}" };

function installed(config = { ...BASIC, review: REVIEW_OK }) {
  const root = repo(config);
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  return root;
}

test('status --base with a ref other than config.baseRef is not a criteria change', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['branch', 'other', 'main']);
  write(root, 'src/a.js', '2');
  const s = JSON.parse(qh(root, ['status', '--json', '--base', 'other']).stdout);
  assert.deepStrictEqual(s.configChanges, []);
  assert.doesNotMatch(s.policy.join('\n'), /결정 로그/);
});

test('pr does not block on a missing code map, it only warns', () => {
  const root = installed();
  fs.rmSync(path.join(root, '.code-review-graph'), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.mcp.json'), { force: true });
  const r = qh(root, ['pr']);
  assert.match(r.stdout, /\[경고\] 코드 지도 색인/);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('pr lists setup problems only a person can settle under a report-to-user heading', () => {
  const root = installed();
  write(root, 'CLAUDE.md', '# rules\n');
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 1);
  const at = r.stdout.indexOf('사용자에게 보고');
  assert.ok(at >= 0, r.stdout);
  assert.ok(r.stdout.indexOf('CLAUDE.md가 @AGENTS.md를') > at, r.stdout);
});

test('a review that cannot run is listed with the environment errors', () => {
  const root = installed({ ...BASIC, review: { cmd: 'true' } });
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /환경 오류 \(코드를 고치지 말고[^\n]*\n(?: {2}- .*\n)* {2}- AI 리뷰/);
});

test('pr passes with a check failure the decision log allows as already failing', () => {
  const root = installed({ ...BASIC, checks: { unit: { cmd: 'node -e "process.exit(1)"' } }, review: REVIEW_OK });
  write(root, 'docs/decisions.md', `${fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8')}- 2026-11-18 · 기존 실패 허용: unit · main에서도 실패하고 따로 고친다 · 고쳐지면\n`);
  const r = qh(root, ['pr']);
  assert.match(r.stdout, /경고 \(막지 않음\)[\s\S]*unit/);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('the pr pass line says how many AI findings and criteria changes were left open', () => {
  const finding = { file: 'src/a.js', line: 1, rank: 1, severity: '높음', verdict: 'confirmed', checklist: 'x', reason: '문제', nextAction: '고친다' };
  const cmd = `node -e "require('fs').writeFileSync(process.argv[1]+'/result.json', JSON.stringify([${JSON.stringify(finding).replace(/"/g, '\\"')}]))" {out}`;
  const root = installed({ ...BASIC, review: { cmd } });
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /qh pr: 통과 \(AI 리뷰 지목 1건\(높음 1건\)과 기준 변경 \d+건이 열려 있다/);
});

test('pr skips the review when the reviewer answer is "검토 생략" (C), without needing review.cmd', () => {
  const root = installed({ ...BASIC, answers: { reviewer: { choice: 'C', date: '2026-11-18' } } });
  const r = qh(root, ['pr']);
  assert.doesNotMatch(r.stdout, /review\.cmd 없음/);
  assert.match(r.stdout, /AI 리뷰: 생략/);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('review.cmd placeholders are shell-quoted: a path with a space reaches the command as one argument', () => {
  const root = installed({ ...BASIC, review: { cmd: `node -e "const fs=require('fs');const [o,w,t]=process.argv.slice(1);if(!fs.existsSync(w)||!fs.existsSync(t)||!fs.statSync(o).isDirectory())process.exit(2);fs.writeFileSync(o+'/result.json','[]')" {out} {workdir} {task}` } });
  const spaced = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'qh-sp-')), 'my project');
  fs.renameSync(root, spaced);
  assert.strictEqual(qh(spaced, ['review']).status, 0);
  assert.ok(fs.existsSync(path.join(spaced, '.quality/evidence/review/result.json')));
});

test('status --pr exits non-zero when the PR gate would block, and exits 0 when it would pass', () => {
  const root = installed({ ...BASIC, answers: { reviewer: { choice: 'C', date: '2026-11-18' } } });
  assert.strictEqual(qh(root, ['status', '--pr']).status, 1, 'the check was never run');
  assert.strictEqual(qh(root, ['check', '--pr']).status, 0);
  const ok = qh(root, ['status', '--pr']);
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.strictEqual(qh(root, ['status']).status, 0, 'plain status only reports');
});

test('review.cmd placeholders the user already wrapped in quotes are not quoted twice', () => {
  const body = "const fs=require('fs');const [o,w,t]=process.argv.slice(1);if(!fs.existsSync(w)||!fs.existsSync(t)||!fs.statSync(o).isDirectory())process.exit(2);fs.writeFileSync(o+'/result.json','[]')";
  for (const [label, args] of [['double', '"{out}" "{workdir}" "{task}"'], ['single', "'{out}' '{workdir}' '{task}'"]]) {
    const root = installed({ ...BASIC, review: { cmd: `node -e "${body}" ${args}` } });
    const spaced = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'qh-sp-')), 'my project');
    fs.renameSync(root, spaced);
    assert.strictEqual(qh(spaced, ['review']).status, 0, label);
    assert.ok(fs.existsSync(path.join(spaced, '.quality/evidence/review/result.json')), label);
  }
});

test('qh review says in one Korean line that the review is off when the person chose C', () => {
  const root = installed({ ...BASIC, answers: { reviewer: { choice: 'C', date: '2026-11-18' } } });
  const r = qh(root, ['review']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /검토 생략을 골라/);
});

test('a detached checkout still finds the task card from the changed files', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', `${DECLARED}## 판단 필요\n- [ ] 열린 질문\n`);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'work']);
  sh(root, 'git', ['checkout', '-q', '--detach']);
  const s = JSON.parse(qh(root, ['status', '--json']).stdout);
  assert.deepStrictEqual(s.decisions, ['열린 질문']);
});

for (const team of ['A', 'B']) {
  test(`pr pass guidance uses the existing team answer ${team}`, () => {
    const root = installed({ ...BASIC, review: REVIEW_OK, answers: { team: { choice: team } } });
    if (team === 'A') write(root, '.github/workflows/quality.yml', 'steps:\n  - run: node .quality/qh/bin/qh.js check --pr\n  - run: node .quality/qh/bin/qh.js status --pr --base main\n');
    const r = qh(root, ['pr']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    if (team === 'B') {
      assert.match(r.stdout, /PR 없이 기준 브랜치에 바로 합쳐도 된다/);
      assert.match(r.stdout, /완료 리뷰에서 사람이 확인/);
      assert.doesNotMatch(r.stdout, /PR 리뷰어가 확인/);
    } else assert.match(r.stdout, /PR 리뷰어가 확인/);
  });
}

test('pr appends one metrics row on each pass and none when blocked', () => {
  const root = installed();
  const file = path.join(root, '.quality/metrics.csv');
  const lines = () => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').length - 1 : 0;
  const before = lines();
  assert.strictEqual(qh(root, ['pr']).status, 0);
  assert.strictEqual(lines(), before + 1);
  assert.strictEqual(qh(root, ['pr']).status, 0);
  assert.strictEqual(lines(), before + 2);
  write(root, 'CLAUDE.md', '# rules\n');
  assert.strictEqual(qh(root, ['pr']).status, 1);
  assert.strictEqual(lines(), before + 2);
});

test('pr copies metrics and the generated report only when an export folder is set', () => {
  const root = installed();
  const dest = path.join(root, 'export with spaces');
  const run = (env) => require('node:child_process').spawnSync(process.execPath, [QH, 'pr'], {
    cwd: root, encoding: 'utf8', env: { ...TEST_ENV, VIBERAIL_METRICS_DIR: '', ...env },
  });
  assert.strictEqual(run({}).status, 0);
  assert.ok(!fs.existsSync(dest));
  const r = run({ VIBERAIL_METRICS_DIR: dest });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'metrics.csv'), 'utf8'), fs.readFileSync(path.join(root, '.quality/metrics.csv'), 'utf8'));
  const reports = fs.readdirSync(dest).filter((f) => f.endsWith('.html'));
  assert.strictEqual(reports.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(dest, reports[0]), 'utf8'), fs.readFileSync(path.join(root, '.quality/reports', reports[0]), 'utf8'));
  assert.doesNotMatch(fs.readFileSync(path.join(dest, 'metrics.csv'), 'utf8'), /export with spaces/);
  assert.doesNotMatch(fs.readFileSync(path.join(dest, reports[0]), 'utf8'), /export with spaces/);
});

test('pr keeps its passing exit code when measurement or copying fails', () => {
  for (const failure of ['measure', 'copy']) {
    const root = installed();
    const dest = path.join(root, '.quality/export');
    if (failure === 'measure') {
      fs.rmSync(path.join(root, '.quality/metrics.csv'), { force: true });
      fs.mkdirSync(path.join(root, '.quality/metrics.csv'));
    } else write(root, '.quality/export', 'a file blocks the export directory');
    const r = require('node:child_process').spawnSync(process.execPath, [QH, 'pr'], {
      cwd: root, encoding: 'utf8', env: { ...TEST_ENV, VIBERAIL_METRICS_DIR: dest },
    });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /경고/);
    assert.match(r.stderr, failure === 'measure' ? /지표.*기록/ : /복사/);
  }
});
