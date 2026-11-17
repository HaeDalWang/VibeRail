'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MAP_LOG, sh, repo, write, qh, statusJson, stopDecision, stateOf, DECLARED, BASIC } = require('./helpers');

test('tree hash covers untracked files, skips ignored files and evidence, and leaves the real index alone', () => {
  const root = repo(BASIC, { '.gitignore': 'ignored.txt\n' });
  const h0 = statusJson(root).treeHash;
  write(root, 'ignored.txt', 'x');
  write(root, '.quality/evidence/x.json', '{}');
  assert.strictEqual(statusJson(root).treeHash, h0);
  write(root, 'new.txt', 'x');
  assert.notStrictEqual(statusJson(root).treeHash, h0);
  assert.strictEqual(sh(root, 'git', ['diff', '--cached', '--name-only']), '');
});

test('tree hash works when the evidence folder is git-ignored', () => {
  const root = repo(BASIC, { '.gitignore': '.quality/evidence/\n' });
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['check']).status, 0);
  assert.strictEqual(stateOf(statusJson(root), 'unit'), '통과');
});

test('nothing is required while the branch has no change', () => {
  const s = statusJson(repo(BASIC));
  assert.deepStrictEqual(s.checks, []);
});

test('check states: not run → passed → passed on an earlier state', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  assert.strictEqual(stateOf(statusJson(root), 'unit'), '미실행');
  assert.strictEqual(qh(root, ['check']).status, 0);
  assert.strictEqual(stateOf(statusJson(root), 'unit'), '통과');
  write(root, 'src/a.js', '3');
  assert.strictEqual(stateOf(statusJson(root), 'unit'), '이전 상태에서 통과');
});

test('a failing command is 실패 and a missing tool is 환경 오류', () => {
  const root = repo({
    baseRef: 'main',
    checks: { bad: { cmd: 'node -e "process.exit(4)"' }, gone: { cmd: 'qh-no-such-tool --x' } },
    common: ['bad', 'gone'],
  });
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['check']).status, 1);
  const s = statusJson(root);
  assert.strictEqual(stateOf(s, 'bad'), '실패');
  assert.strictEqual(stateOf(s, 'gone'), '환경 오류');
});

test('a missing base ref is reported as an environment problem, not a code problem', () => {
  const root = repo({ ...BASIC, baseRef: 'origin/main' });
  const s = statusJson(root);
  assert.match(s.env.join(' '), /origin\/main/);
  assert.strictEqual(qh(root, ['check']).status, 3);
});

test('a risk path adds its checks and requires its docs to change in the same work', () => {
  const root = repo({
    ...BASIC,
    checks: { ...BASIC.checks, authz: { cmd: 'node -e ""' } },
    risks: { authz: { paths: ['src/routes/**'], checks: ['authz'], docs: ['docs/permissions.md'] } },
  });
  write(root, 'src/routes/t.js', 'x');
  const s = statusJson(root);
  assert.deepStrictEqual(s.checks.map((c) => c.name).sort(), ['authz', 'unit']);
  assert.deepStrictEqual(s.risks, [{ risk: 'authz', files: ['src/routes/t.js'] }]);
  assert.deepStrictEqual(s.docsMissing, [{ risk: 'authz', doc: 'docs/permissions.md' }]);
});

test('a check that runs out of time is reported to the person, not handed to the agent to fix', () => {
  const root = repo({ ...BASIC, checks: { unit: { cmd: 'node -e "setTimeout(()=>{},5000)"', timeoutSec: 1 } } });
  write(root, 'src/a.js', '2');
  qh(root, ['check', 'unit']);
  const s = statusJson(root);
  assert.strictEqual(stateOf(s, 'unit'), '환경 오류');
  assert.match(s.checks[0].detail[0], /시간 초과 .*테스트를 고치지 말고 사용자에게/);
});

test('a quoted or env-prefixed command finds its tool, a missing tool is an env error', () => {
  const ok = '-e "process.exit(0)"';
  const checks = { quoted: { cmd: `${JSON.stringify(process.execPath)} ${ok}` }, prefixed: { cmd: `FOO=1 node ${ok}` }, missing: { cmd: '"qh-no-such-tool" x' } };
  const root = repo({ ...BASIC, checks, common: Object.keys(checks) });
  write(root, 'src/a.js', '2');
  qh(root, ['check']);
  const s = statusJson(root);
  assert.strictEqual(stateOf(s, 'quoted'), '통과');
  assert.strictEqual(stateOf(s, 'prefixed'), '통과');
  assert.strictEqual(stateOf(s, 'missing'), '환경 오류');
});

test('a "{tests}" check runs only the tests of this work, and is not required when there are none', () => {
  const ran = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qh-ran-')), 'ran.txt');
  const echo = `node -e "require('fs').writeFileSync(${JSON.stringify(ran).replace(/"/g, "'")}, process.argv.slice(1).join(' '))"`;
  const config = { ...BASIC, checks: { quick: { cmd: `${echo} {tests}`, on: ['stop'] } }, common: ['quick'] };
  const root = repo(config, { 'src/auth.js': '1', 'test/auth.test.js': 'x', 'test/authz.test.js': 'x', 'test/other.test.js': 'x' });
  write(root, 'README.md', 'x');
  assert.deepStrictEqual(statusJson(root).checks, [], 'no code changed, nothing to run');
  write(root, 'src/auth.js', '2');
  write(root, 'test/other.test.js', 'y');
  qh(root, ['check']);
  assert.strictEqual(fs.readFileSync(ran, 'utf8'), 'test/auth.test.js test/other.test.js');
  assert.strictEqual(stateOf(statusJson(root), 'quick'), '통과');
});

test('stop never fails on a broken config: exit 0 and one note naming the file', () => {
  const root = repo(BASIC);
  write(root, '.quality/config.json', '{ broken');
  const r = qh(root, ['hook', 'stop'], '{}');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).reason, /\.quality\/config\.json이 JSON 형식이 아니다/);
});

test('review runs the configured command and records findings bound to the tree', () => {
  const fake = `node -e "require('fs').writeFileSync('{out}/result.json', JSON.stringify([{file:'src/a.js',line:1,severity:'높음',verdict:'confirmed',reason:'r',nextAction:'n'}]))"`;
  const root = repo({ ...BASIC, review: { cmd: fake } });
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['review']).status, 0);
  const s = statusJson(root);
  assert.strictEqual(s.review.state, '완료');
  assert.strictEqual(s.review.findings.length, 1);
  const diff = fs.readFileSync(path.join(root, '.quality/evidence/review/change.diff'), 'utf8');
  assert.match(diff, /src\/a\.js/);
  write(root, 'src/a.js', '3');
  assert.strictEqual(statusJson(root).review.state, '이전 상태에서 완료');
});

test('review without a result file is an environment problem', () => {
  const root = repo({ ...BASIC, review: { cmd: 'true' } });
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['review']).status, 3);
  assert.strictEqual(statusJson(root).review.state, '환경 오류');
});

test('pr fails while a person still has to decide, even when every check passes', () => {
  const root = repo({ ...BASIC, review: { cmd: "node -e \"require('fs').writeFileSync('{out}/result.json','[]')\"" } });
  assert.strictEqual(qh(root, ['init', root]).status, 0, 'pr also runs doctor, so qh must be set up');
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', `${DECLARED}## 판단 필요\n- [ ] 열린 질문\n`);
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /열린 질문/);
  write(root, '.quality/tasks/work.md', `${DECLARED}## 판단 필요\n- [x] 열린 질문\n`);
  assert.strictEqual(qh(root, ['pr']).status, 0);
});

test('a PR-only check is neither run nor demanded at Stop, but is required by the PR status', () => {
  const root = repo({ baseRef: 'main', checks: { unit: { cmd: 'true' }, slow: { cmd: 'true', on: ['pr'] } }, common: ['unit', 'slow'] });
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  qh(root, ['check']);
  const stop = statusJson(root);
  assert.deepStrictEqual(stop.checks.map((c) => c.name), ['unit']);
  assert.deepStrictEqual(stop.later, ['slow']);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{}')), null);
  const pr = JSON.parse(qh(root, ['status', '--json', '--pr']).stdout);
  assert.strictEqual(stateOf(pr, 'slow'), '미실행');
});

test('a built-in check whose probe is missing is 환경 오류, not a code failure', () => {
  const root = repo({ baseRef: 'main', checks: { routes: { builtin: 'route-access', requests: false } }, common: ['routes'] });
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['check']).status, 3, 'only environment errors: exit 3, not a code failure');
  const s = statusJson(root);
  assert.strictEqual(stateOf(s, 'routes'), '환경 오류');
  assert.match(s.checks[0].detail.join(' '), /probe\.mjs 없음/);
});

test('a first access table shows as one summarized base change, not one line per route', () => {
  const root = repo(BASIC);
  const routes = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`GET /r${i}`, 'member']));
  write(root, '.quality/access.json', JSON.stringify({ levels: ['public', 'member'], routes }));
  const s = statusJson(root);
  assert.strictEqual(s.configChanges.length, 2);
  assert.match(s.configChanges.find((c) => c.startsWith('access.routes')), /30개 항목 바뀜/);
});

test('a first install (no config on the base) is one base-change line, not one per section', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['rm', '-q', '.quality/config.json']);
  sh(root, 'git', ['commit', '-qm', 'no qh yet']);
  sh(root, 'git', ['checkout', '-q', '-B', 'work']);
  write(root, '.quality/config.json', JSON.stringify(BASIC));
  const s = statusJson(root);
  assert.strictEqual(s.configChanges.length, 1);
  assert.match(s.configChanges[0], /qh 첫 설치/);
});

test('a person confirms the criteria once with qh confirm, and a later change asks again', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['rm', '-q', '.quality/config.json']);
  sh(root, 'git', ['commit', '-qm', 'no qh yet']);
  sh(root, 'git', ['checkout', '-q', '-B', 'work']);
  write(root, '.quality/config.json', JSON.stringify(BASIC));
  assert.match(statusJson(root).configChanges[0], /켜진 검사: 프로젝트 검사 1개.*qh confirm/, 'the person is shown what is on, in plain words');
  assert.strictEqual(qh(root, ['confirm']).status, 0);
  assert.deepStrictEqual(statusJson(root).configChanges, []);
  assert.match(fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8'), /기준 확인: [0-9a-f]{12}/);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, common: [] }));
  assert.strictEqual(statusJson(root).configChanges.length, 1, 'what was confirmed changed: ask again');
});

test('routes --baseline refuses to overwrite an access table a person may have edited', () => {
  const root = repo(BASIC, { '.quality/access.json': '{"levels":["public","member"],"routes":{}}' });
  const r = qh(root, ['routes', '--baseline', '--levels', 'public,member']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /덮어쓰지 않는다/);
});

// ---------- always-on rules ----------

const policyOf = (root) => statusJson(root).policy.join('\n');

test('a code change without a test change blocks until a test changes or the card gives a reason', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  assert.match(policyOf(root), /TDD: 코드\(src\/a\.js\)/);
  write(root, 'test/a.test.js', 'x');
  assert.doesNotMatch(policyOf(root), /TDD/);
  fs.rmSync(path.join(root, 'test'), { recursive: true });
  write(root, '.quality/tasks/work.md', '테스트 불필요: x\n');
  assert.match(policyOf(root), /TDD/, 'a reason too short to say anything does not count');
  write(root, '.quality/tasks/work.md', '- 테스트 불필요: 주석만 고침\n');
  assert.doesNotMatch(policyOf(root), /TDD/);
});

test('a code change without a doc change needs "문서 영향 없음: 이유"; a changed doc satisfies it', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  assert.match(policyOf(root), /문서 영향/);
  write(root, 'docs/usage.md', 'x');
  assert.doesNotMatch(policyOf(root), /문서 영향/);
});

test('a test-only or doc-only change asks for neither tests nor docs', () => {
  const root = repo(BASIC);
  write(root, 'src/a.test.js', 'x');
  write(root, 'README.md', 'x');
  assert.deepStrictEqual(statusJson(root).policy, []);
});

test('a risky change needs an ADR or "ADR 불필요: 이유", and a criteria change needs a decision log line', () => {
  const root = repo({ ...BASIC, risks: { db: { paths: ['migrations/**'] } } });
  write(root, 'migrations/002.sql', 'ALTER TABLE t ADD c TEXT;');
  assert.match(policyOf(root), /ADR: 위험 영역\(db\)/);
  write(root, 'docs/adr/0001-add-c.md', '# c');
  assert.doesNotMatch(policyOf(root), /ADR/);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, risks: { db: { paths: ['migrations/**', 'db/**'] } } }));
  assert.match(policyOf(root), /결정 로그/);
  write(root, 'docs/decisions.md', '- 2026-11-16 · db/도 위험 영역 · 쿼리가 거기 있음 · 폴더 이동 시\n');
  assert.doesNotMatch(policyOf(root), /결정 로그/);
});

test('secrets in changed files block without being printed; an allow marker and env templates pass', () => {
  const root = repo(BASIC, { 'src/old.js': `const k = 'AKIA${'A'.repeat(16)}'\n` });
  const key = `ghp_${'a'.repeat(36)}`;
  write(root, 'src/a.test.js', `const t = '${key}'\nconst db = 'postgres://u:pw123@localhost/x'\n`);
  write(root, 'config/.env', 'X=1\n');
  write(root, '.env.example', 'X=\n');
  const p = policyOf(root);
  assert.match(p, /비밀값 의심: src\/a\.test\.js:1 \(GitHub 토큰\)/);
  assert.doesNotMatch(p, /a\.test\.js:2/, 'a local database URL is not a leak');
  assert.match(p, /비밀값 파일: config\/\.env/);
  assert.doesNotMatch(p, /\.env\.example|old\.js/, 'templates and untouched files are not scanned');
  assert.ok(!p.includes(key));
  write(root, 'src/a.test.js', `const t = '${key}' // qh:allow-secret 테스트용 가짜\n`);
  assert.doesNotMatch(policyOf(root), /a\.test\.js/);
});

test('re-running init over an older install never offers to delete the whole install', () => {
  const root = project({ 'README.md': 'x\n' });
  qh(root, ['init', root]);
  fs.rmSync(path.join(root, '.quality/qh/lib/ask-guide.md'));
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'older qh']);
  const out = qh(root, ['init', root]).stdout;
  assert.match(out, /rm -rf [^\n]*\.quality\/qh\/lib\/ask-guide\.md/);
  assert.doesNotMatch(out, /rm -rf (\S+ )*\.quality\/qh( |$)/m);
});

test('init starts the decision log once and never overwrites it', () => {
  const root = project({ 'README.md': 'x\n', 'docs/decisions.md': '- mine\n' });
  qh(root, ['init', root]);
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8'), '- mine\n');
  const fresh = project({ 'README.md': 'x\n' });
  qh(fresh, ['init', fresh]);
  assert.match(fs.readFileSync(path.join(fresh, 'docs/decisions.md'), 'utf8'), /^- \d{4}-\d{2}-\d{2} · qh로 품질 기준/m);
});

// ---------- structure ratchet ----------

const structureOf = (root) => statusJson(root).structure.join('\n');
const BLOCK = (msg) => `function send(user) {
  if (!user.email) throw new Error('${msg}');
  const body = { to: user.email, subject: 'hello', retries: 3 };
  const res = mailer.post('/send', body, { timeout: 5000 });
  if (res.status !== 200) log.warn('mail failed', res.status);
  return res.data.messageId;
}
`;

test('a copied block in a touched file blocks and points at the existing copy, even with different literals', () => {
  const root = repo(BASIC, { 'src/mail.js': BLOCK('no email') });
  write(root, 'src/signup.js', BLOCK('이메일 없음').replace('3', '5'));
  assert.match(structureOf(root), /중복: src\/signup\.js:1 ↔ src\/mail\.js:1/);
});

test('an old copy blocks once its file is touched, and a decision-log line allows it', () => {
  const root = repo(BASIC, { 'src/mail.js': BLOCK('a'), 'src/old.js': BLOCK('b'), 'src/other.js': BLOCK('c') });
  write(root, 'src/a.js', '2');
  assert.doesNotMatch(structureOf(root), /중복/, 'copies in untouched files are not this work\'s to fix');
  write(root, 'src/old.js', `${BLOCK('b')}// touched\n`);
  assert.match(structureOf(root), /중복: src\/old\.js/);
  write(root, 'docs/decisions.md', '- 2026-11-16 · 중복 허용: src/old.js · 다음 달 삭제 예정 · 삭제 시\n');
  assert.doesNotMatch(structureOf(root), /중복/);
});

test('with duplicates "grown", an old copy in a touched file warns, and a new copy blocks', () => {
  const config = { ...BASIC, structure: { duplicates: 'grown' } };
  const root = repo(config, { 'src/mail.js': BLOCK('a'), 'src/old.js': BLOCK('b') });
  write(root, 'src/old.js', `${BLOCK('b')}// touched\n`);
  const s = statusJson(root);
  assert.doesNotMatch(s.structure.join('\n'), /중복/, 'a copy the file already had does not block');
  assert.match(s.structureWarnings.join('\n'), /중복\(원래 있던 것, 막지 않음\): src\/old\.js/);
  const stop = stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":false}'));
  assert.doesNotMatch(stop.reason, /중복/, 'the warning is not handed to the agent to fix');
  assert.match(stop.systemMessage, /경고 \(막지 않음\)\n- .*중복 코드/, 'the person hears it in plain words');
  write(root, 'src/old.js', `${BLOCK('b')}\nfunction more() {}\n${BLOCK('c')}`);
  assert.match(structureOf(root), /중복: src\/old\.js.*이 파일 중복 6줄 → 12줄/);
  write(root, 'src/new.js', BLOCK('d'));
  assert.match(structureOf(root), /중복: src\/new\.js.*0줄 → 6줄/, 'a new file starts from zero');
});

test('short or import-only similarities are not duplicates', () => {
  const imports = Array.from({ length: 8 }, (_, i) => `import { thing${i} } from './mod${i}.js'`).join('\n');
  const root = repo(BASIC, { 'src/x.js': `${imports}\n}\n}\n` });
  write(root, 'src/y.js', `${imports}\n}\n}\n`);
  assert.doesNotMatch(structureOf(root), /중복/);
});

test('init and pr report the repository-wide duplicate total without blocking on it', () => {
  const root = repo({ ...BASIC, review: { cmd: "node -e \"require('fs').writeFileSync('{out}/result.json','[]')\"" } }, { 'src/mail.js': BLOCK('a'), 'src/copy.js': BLOCK('b') });
  assert.match(qh(root, ['init', root]).stdout, /중복 합계\(참고, 막지 않음\): 12줄 · src\/(mail|copy)\.js 6/);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  const r = qh(root, ['pr']);
  assert.match(r.stdout, /중복 합계\(참고, 막지 않음\): 12줄/);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('a big file may not grow, a new root file needs a reason, a changed doc may not link to nothing', () => {
  const big = Array.from({ length: 801 }, (_, i) => `const v${i} = ${i};`).join('\n');
  const root = repo(BASIC, { 'src/big.js': big, 'docs/a.md': 'x' });
  write(root, 'src/big.js', `${big}\nconst more = 1;`);
  write(root, 'notes.js', 'x');
  write(root, '.prettierrc', '{}');
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'shared_modules'));
  write(root, 'docs/a.md', '[ok](a.md) [web](https://x.invalid/y) [gone](../src/missing.js)\n```\n[code](nope.md)\n```\n');
  const st = structureOf(root);
  assert.match(st, /큰 파일: src\/big\.js가 802줄\(기준 801/);
  assert.match(st, /루트 파일: .*notes\.js/);
  assert.doesNotMatch(st, /\.prettierrc/, 'top-level dotfiles are tool settings');
  assert.doesNotMatch(st, /shared_modules/, 'a link to a folder is not a file');
  assert.match(st, /죽은 링크: docs\/a\.md:1 → \.\.\/src\/missing\.js/);
  assert.doesNotMatch(st, /nope\.md|a\.md 가|x\.invalid/);
});

// ---------- questions ----------

test('ask writes the question page outside the repository, recommends from the code, and keeps saved answers', () => {
  const root = repo({ ...BASIC, answers: { team: { choice: 'A', reason: '<둘이서>' } } }, { 'package.json': JSON.stringify({ dependencies: { pg: '^8' } }) });
  const r = qh(root, ['ask']);
  assert.strictEqual(r.status, 0, r.stderr);
  const file = r.stdout.match(/질문 화면: (\S+)/)[1];
  assert.ok(!fs.realpathSync(file).startsWith(fs.realpathSync(root)), 'the page never lands in the repository');
  const html = fs.readFileSync(file, 'utf8');
  assert.strictEqual(html.match(/class="card"/g).length, 8);
  assert.match(html, /id="q-db" [^>]*data-rec="A"/);
  assert.match(html, /권장안: A<\/b> — package\.json에 pg/);
  assert.match(html, /name="team" value="A"[^>]* checked/);
  assert.match(html, /&lt;둘이서&gt;/);
  assert.doesNotMatch(html, /<둘이서>/);
});

test('level: ask offers A (개발을 잘 모름, recommended) and B (개발자); the answer lands in config.answers.level', () => {
  const root = repo(BASIC);
  const html = fs.readFileSync(qh(root, ['ask']).stdout.match(/질문 화면: (\S+)/)[1], 'utf8');
  assert.match(html, /id="q-level" [^>]*data-rec="A"/);
  assert.match(html, /A\. 개발을 잘 모름/);
  assert.match(html, /B\. 개발자/);
  assert.strictEqual(qh(root, ['answer'], 'qh 답\nlevel=A\n').status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).answers.level.choice, 'A');
  assert.match(qh(root, ['answer'], 'qh 답\nlevel=B\n').stdout, /저장하지 않음[\s\S]*사용자 수준: 권장안\(A\)과 다르게[\s\S]*변경 사유/);
  assert.strictEqual(qh(root, ['answer'], 'qh 답\nlevel=B 사유: 개발자라서\n').status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).answers.level.choice, 'B');
});

test('answer checks every line before saving, then stores answers and logs each change once', () => {
  const root = repo(BASIC);
  const bad = qh(root, ['answer'], 'qh 답\nlogin=A\ndb=Z\nteam=A\n');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /읽을 수 없는 줄: "db=Z"[\s\S]*협업: 권장안\(B\)과 다르게 골랐는데 변경 사유가 없다/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).answers, undefined);
  const block = 'qh 답\nlogin=B\nteam=A 사유: 둘이서 개발\n';
  assert.strictEqual(qh(root, ['answer'], block).status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8'));
  assert.strictEqual(config.answers.team.choice, 'A');
  assert.strictEqual(config.answers.team.reason, '둘이서 개발');
  const log = fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8');
  assert.match(log, /질문 협업: A 팀 협업 개발 · 둘이서 개발/);
  assert.match(log, /질문 로그인: B 로그인 기능 없음 · 권장안/);
  assert.match(qh(root, ['answer'], block).stdout, /바뀐 답 없음/);
  assert.doesNotMatch(policyOf(root), /결정 로그/, 'the saved answers carry their own decision-log lines');
});

test('doctor fails when an answer asks for something the project does not have yet', () => {
  const root = repo({ ...BASIC, answers: { login: { choice: 'A' }, reviewer: { choice: 'C', reason: '혼자 실험 중' }, deploy: { choice: 'A' } } });
  const out = qh(root, ['doctor']).stdout;
  assert.match(out, /답 "로그인 기능 있음" → 권한 검사\(route-access\)가 없다/);
  assert.match(out, /답 "로그인 기능 있음" → 위험 영역 auth가 없다/);
  assert.match(out, /docs\/operations\.md가 없다/);
  assert.doesNotMatch(out, /review\.cmd가 없다/, 'review skipped by answer');
  assert.doesNotMatch(out, /DB 변경 있음/, 'unanswered questions fall back to the recommendation (B here)');
  assert.doesNotMatch(out, /질문에 아직 답하지 않았다/);
});

test('with personal data, a changed log line naming a personal field blocks unless marked', () => {
  const root = repo({ ...BASIC, answers: { personal: { choice: 'A' } } });
  write(root, 'src/a.js', 'console.log("signup", user.email)\nconsole.log("count", n)\n');
  const p = policyOf(root);
  assert.match(p, /개인정보 로그: src\/a\.js:1/);
  assert.doesNotMatch(p, /a\.js:2/);
  write(root, 'src/a.js', 'console.log("signup", user.email) // qh:allow-pii 테스트 계정\n');
  assert.doesNotMatch(policyOf(root), /개인정보 로그/);
  const off = repo(BASIC);
  write(off, 'src/a.js', 'console.log(user.email)\n');
  assert.doesNotMatch(policyOf(off), /개인정보 로그/, 'off until the project says it keeps personal data');
});

test('with external services, a change to integration code needs a failure-case test or a reason', () => {
  const root = repo({ ...BASIC, risks: { external: { paths: ['src/pay/**'] } }, answers: { external: { choice: 'A' } } });
  write(root, 'src/pay/charge.js', 'module.exports = 2');
  assert.match(policyOf(root), /연동 실패 테스트/);
  write(root, 'src/pay/charge.test.js', "test('charge rejects on timeout', () => {})");
  assert.doesNotMatch(policyOf(root), /연동 실패 테스트/);
});

test('touching a risk area asks the person a task question; a "changes it" answer makes the ADR mandatory', () => {
  const root = repo({ ...BASIC, risks: { db: { paths: ['migrations/**'] } } });
  const card = (extra) => write(root, '.quality/tasks/work.md', `${DECLARED}${extra}`);
  write(root, 'migrations/002.sql', 'ALTER TABLE t ADD c TEXT;');
  card('');
  const d = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.match(d.reason, /작업 질문\(db, migrations\/002\.sql\): "이 작업이 이미 쌓인 데이터를 바꾸거나 지우나요\?"/);
  card('ADR 불필요: 컬럼 추가만 함\n작업 질문 db: B 새 컬럼만\n');
  assert.deepStrictEqual(statusJson(root).taskQuestions, []);
  assert.doesNotMatch(policyOf(root), /ADR/);
  card('ADR 불필요: 컬럼 추가만 함\n작업 질문 db: A 기존 값 옮김\n');
  assert.match(policyOf(root), /ADR: .*작업 질문에서 db 변경 있음이라 ADR 불필요는 안 됨/);
});

// ---------- init ----------

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-init-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.invalid']);
  sh(root, 'git', ['config', 'user.name', 't']);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'init']);
  return root;
}

const EXISTING_HOOK = { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool status' }] }] } };
const ESM_EXPRESS = {
  'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' }, dependencies: { express: '^5', pg: '^8' } }),
  '.claude/settings.json': JSON.stringify(EXISTING_HOOK, null, 2),
  'AGENTS.md': '# Rules\n\nkeep me\n',
  'CLAUDE.md': '@AGENTS.md\n',
  'src/server.mjs': 'export {}\n',
};

test('init installs qh into the project, keeps existing hooks and rules, and drafts config and probe', () => {
  const root = project(ESM_EXPRESS);
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.strictEqual(settings.hooks.SessionStart[0].hooks[0].command, 'other-tool status');
  assert.match(settings.hooks.SessionStart[1].hooks[0].command, /\.quality\/qh\/bin\/qh\.js" hook session-start$/);
  assert.match(settings.hooks.Stop[0].hooks[0].command, /hook stop$/);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /keep me[\s\S]*<!-- qh:start -->[\s\S]*품질 게이트[\s\S]*<!-- qh:end -->/);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8'));
  assert.deepStrictEqual(config.common, ['test', 'sql', 'routes', 'access']);
  assert.deepStrictEqual(config.checks.access.on, ['pr']);
  assert.deepStrictEqual(config.checks.test.on, ['pr'], 'the full suite runs at PR, not at each Stop');
  assert.match(fs.readFileSync(path.join(root, '.quality/probe.mjs'), 'utf8'), /export async function sql/);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.quality\/evidence\/$/m);
  assert.match(r.stdout, /되돌리기 \(저장소 루트에서\): git checkout -- .*\.claude\/settings\.json/);
});

test('the installed hooks pass where the checkout has no qh (older-branch worktree, no git)', () => {
  const root = project(ESM_EXPRESS);
  qh(root, ['init', root]);
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  const kiro = JSON.parse(fs.readFileSync(path.join(root, '.kiro/hooks/qh.json'), 'utf8'));
  const cmds = [settings.hooks.Stop[0].hooks[0].command, settings.hooks.SessionStart[1].hooks[0].command, ...kiro.hooks.map((h) => h.action.command)];
  const bare = project({ 'a.txt': 'x\n' });
  const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-nogit-'));
  for (const cwd of [bare, noGit]) {
    for (const c of cmds) {
      const r = spawnSync('sh', ['-c', c], { cwd, input: '{}', encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `${c} in ${cwd}: ${r.stderr}`);
      assert.strictEqual(r.stderr, '');
    }
  }
});

test('the installed copy runs inside a "type": "module" project', () => {
  const root = project(ESM_EXPRESS);
  qh(root, ['init', root]);
  write(root, 'src/server.mjs', 'export const x = 1\n');
  const r = spawnSync(process.execPath, [path.join(root, '.quality/qh/bin/qh.js'), 'status', '--json'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).checks.map((c) => c.name), ['routes'], 'test is PR-only in the draft');
});

test('init is idempotent', () => {
  const root = project(ESM_EXPRESS);
  qh(root, ['init', root]);
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /바뀐 것 없음/);
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.strictEqual(settings.hooks.Stop.length, 1);
});

test('init stops before touching a file with uncommitted edits', () => {
  const root = project(ESM_EXPRESS);
  write(root, 'AGENTS.md', '# Rules\n\nhalf-written edit\n');
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /AGENTS\.md/);
  assert.strictEqual(fs.existsSync(path.join(root, '.quality')), false);
});

test('init in a new folder creates rules and a test-free draft without failing', () => {
  const root = project({ 'README.md': 'x\n' });
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).checks, {});
  assert.strictEqual(fs.existsSync(path.join(root, '.quality/probe.mjs')), false);
});

test('express only in devDependencies is a test tool, not the app: no probe draft', () => {
  const root = project({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' }, devDependencies: { express: '^5' } }) });
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /express=아니오/);
  assert.strictEqual(fs.existsSync(path.join(root, '.quality/probe.mjs')), false);
});

test('init outside a git repository is an environment problem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-nogit-'));
  const r = qh(dir, ['init', dir]);
  assert.strictEqual(r.status, 3);
  assert.match(r.stdout, /git 저장소가 아니다/);
});

test('init refuses to build on a rule that CLAUDE.md and AGENTS.md both carry', () => {
  const rule = 'Before writing a new helper, search the code map for an existing one and reuse it when it fits.';
  const root = project({ ...ESM_EXPRESS, 'AGENTS.md': `# Rules\n\n${rule}\n`, 'CLAUDE.md': `@AGENTS.md\n\n${rule}\n` });
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /같은 규칙 1단락/);
  assert.strictEqual(fs.existsSync(path.join(root, '.quality')), false);
});

test('init sets up the code map without its own rule copy, and doctor then only asks for the probe', () => {
  fs.rmSync(MAP_LOG, { force: true });
  const root = project(ESM_EXPRESS);
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0, r.stdout);
  const calls = fs.readFileSync(MAP_LOG, 'utf8');
  assert.match(calls, /^install -y --no-instructions --platform claude-code/m);
  assert.match(calls, /^build /m);
  assert.match(r.stdout, /qh doctor: 실패 1, 경고 1\n.*probe\.mjs에 아직 채우지 않은[\s\S]*질문에 아직 답하지 않았다/);
});

test('doctor flags a second qh Stop hook and a code map that serves another folder', () => {
  const root = project(ESM_EXPRESS);
  qh(root, ['init', root]);
  const stop = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8')).hooks.Stop;
  write(root, '.claude/settings.local.json', JSON.stringify({ hooks: { Stop: stop } }));
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { 'code-review-graph': { cwd: '/somewhere/else' } } }));
  const r = qh(root, ['doctor']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /Stop hook에 qh가 2번/);
  assert.match(r.stdout, /다른 폴더를 가리킨다 \(\/somewhere\/else\)/);
});

test('a broken config is reported at Stop as a setup problem, not as code to fix', () => {
  const root = repo({ ...BASIC, common: ['unit', 'lint'] });
  write(root, 'src/a.js', '2');
  const d = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.match(d.reason, /환경 오류[\s\S]*설정: common의 "lint"이 checks에 없다/);
  assert.doesNotMatch(d.reason, /고칠 일/);
});

// ---------- measure ----------

const metricsRows = (root) => {
  const [head, ...rest] = fs.readFileSync(path.join(root, '.quality/metrics.csv'), 'utf8').trim().split('\n');
  const keys = head.split(',');
  return rest.map((l) => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v])));
};
function commitAt(root, message, secondsAgo) {
  const when = `@${Math.floor(Date.now() / 1000) - secondsAgo} +0000`;
  sh(root, 'git', ['add', '-A']);
  const r = spawnSync('git', ['commit', '-qm', message], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  assert.strictEqual(r.status, 0, String(r.stderr));
}

test('measure adds a row per run, backfills past weeks without touching the repository, and keeps evidence current', () => {
  const root = repo(BASIC);
  write(root, 'src/mail.js', BLOCK('a'));
  write(root, 'src/copy.js', BLOCK('b'));
  commitAt(root, 'chore: copy', 21 * 86400);
  fs.rmSync(path.join(root, 'src/copy.js'));
  write(root, 'src/b.js', '1');
  commitAt(root, 'feat: drop the copy', 0);
  const head = sh(root, 'git', ['rev-parse', 'HEAD']);
  qh(root, ['check', 'unit']);

  const r = qh(root, ['measure', '--backfill', '2']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const page = r.stdout.match(/결과지: (.+)/)[1];
  assert.match(fs.readFileSync(page, 'utf8'), /품질 리포트/);
  assert.strictEqual(path.relative(fs.realpathSync(root), fs.realpathSync(page)), path.join('.quality', 'reports', `${new Date().toISOString().slice(0, 10)}-${head.slice(0, 7)}.html`), 'the page is kept in the project, named by date and commit');
  const rows = metricsRows(root);
  assert.deepStrictEqual(rows.map((x) => [x.backfill, x.duplicated_lines]), [['1', '12'], ['', '0']], 'one past week (the copy), then now');
  assert.strictEqual(rows[1].feat_median_files_60d, '2');
  assert.strictEqual(sh(root, 'git', ['rev-parse', 'HEAD']), head);
  assert.strictEqual(sh(root, 'git', ['status', '--short', '--', '.', ':!.quality/evidence']), '?? .quality/metrics.csv\n?? .quality/reports/', 'only the history and its pages are new (evidence is gitignored by init)');
  assert.strictEqual(stateOf(statusJson(root), 'unit'), '통과', 'writing a measurement does not make evidence stale');

  qh(root, ['measure']);
  assert.strictEqual(metricsRows(root).length, 3, 'rows are added, never replaced');
  assert.strictEqual(qh(root, ['measure', '--backfill', 'x']).status, 1);
});

test('measure judges copies as a share of code and leaves out accepted copies, vendored code and dot-folder docs', () => {
  const root = repo(BASIC);
  write(root, 'src/mail.js', BLOCK('a'));
  write(root, 'src/copy.js', BLOCK('b'));
  write(root, 'docs/decisions.md', '# 결정 로그\n- 중복 허용: src/copy.js · 외부 계약이라 따로 둔다\n');
  write(root, '.agents/skill/README.md', '[x](./missing.md)\n');
  write(root, 'public/vendor/lib.js', BLOCK('a'));
  commitAt(root, 'chore: accepted copy', 0);
  qh(root, ['measure']);
  const [row] = metricsRows(root);
  assert.strictEqual(row.duplicated_lines, '6', 'only the copy in mail.js counts; a vendored copy is not ours');
  assert.strictEqual(Number(row.duplicated_pct), Math.round((6 / Number(row.code_lines)) * 10000) / 100);
  assert.strictEqual(row.dead_doc_links, '0', 'copied-in skills are not the project docs');
});

test('measure leaves out files accepted without tests and splits the page at the commit that added qh', () => {
  const root = repo(BASIC);
  write(root, 'src/glue.js', 'module.exports = 1;\n');
  write(root, 'test/a.test.js', "require('../src/a');\n");
  commitAt(root, 'chore: before qh', 14 * 86400);
  write(root, 'src/glue.js', 'module.exports = 2;\n');
  commitAt(root, 'chore: right before qh', 86400);
  write(root, '.quality/qh/bin/qh.js', '// installed\n');
  write(root, 'docs/decisions.md', '# 결정 로그\n- 테스트 없음 허용: src/glue.js · 상수만 내보낸다\n');
  commitAt(root, 'chore: add qh', 0);
  const r = qh(root, ['measure', '--backfill', '1']);
  const rows = metricsRows(root);
  assert.strictEqual(rows.at(-1).untested_pct, '0', 'src/a.js has its test, src/glue.js is accepted (50 without the line)');
  const data = JSON.parse(fs.readFileSync(r.stdout.match(/결과지: (.+)/)[1], 'utf8').match(/const D=(\{.*?\});\n/)[1]);
  assert.deepStrictEqual(data.rows.map((x) => x.withQh), [false, false, true], 'a past week, the commit right before qh (backfilled as the baseline), then now');
  assert.ok(rows.every((x) => x.rules === '3'), 'each row says which counting rules made it');
});

test('a Stop that turns the agent back is counted by reason in the next measurement', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  assert.ok(stopDecision(qh(root, ['hook', 'stop'], '{}')));
  qh(root, ['measure']);
  const [row] = metricsRows(root);
  assert.strictEqual(row.stop_blocks_30d, '1');
  assert.strictEqual(row.block_tdd, '1');
  assert.strictEqual(row.block_docs, '1');
});
