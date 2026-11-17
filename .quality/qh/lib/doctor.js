'use strict';

// `qh doctor`: is qh installed and set up so the gate can actually work here?
// Full mode (init end, PR) looks at every layer; light mode (each Stop) only at the
// config, which is cheap. Each problem names the file and the fix.
// Levels: 실패 = the gate is broken or rules are duplicated; 경고 = works, but slower or
// weaker than decided (Stop under 10 s, the code map present: a fresh clone or CI has none).
// isHuman: only a person may settle it (config, probe, access table, CLAUDE.md); the agent reports it.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PHASES = ['stop', 'pr'];
const BUILTINS = ['sql-prepare', 'route-access'];
const PROBE_FILE = '.quality/probe.mjs';
const STOP_BUDGET_MS = 10_000;
const MAP_TOOL = 'code-review-graph';
const MAP_DB = '.code-review-graph/graph.db';
const QH_HOOK = /qh\.js"? hook (stop|session-start)\b/;
const MARK_START = '<!-- qh:start -->';
// A paragraph counts as a rule worth comparing when it has this much text.
const MIN_RULE_CHARS = 80;

const read = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);
const json = (root, rel) => {
  const text = read(root, rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const fail = (msg, fix, isDuplicate = false) => ({ level: '실패', msg, fix, isDuplicate });
const warn = (msg, fix) => ({ level: '경고', msg, fix });
const ask = (problem) => ({ ...problem, isHuman: true });
const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

function configProblems(config) {
  const out = [];
  if (typeof config.baseRef !== 'string') out.push(fail('config.baseRef가 없다', '기준 브랜치 이름(main 등)을 적는다'));
  const checks = config.checks || {};
  for (const [name, def] of Object.entries(checks)) {
    if (Boolean(def?.cmd) === Boolean(def?.builtin)) out.push(fail(`검사 ${name}: cmd와 builtin 중 정확히 하나가 있어야 한다`, `.quality/config.json checks.${name}`));
    if (def?.builtin && !BUILTINS.includes(def.builtin)) out.push(fail(`검사 ${name}: 모르는 builtin "${def.builtin}"`, `가능한 값: ${BUILTINS.join(', ')}`));
    if (def?.on !== undefined && !(isStringList(def.on) && def.on.length && def.on.every((p) => PHASES.includes(p)))) out.push(fail(`검사 ${name}: on은 ${PHASES.join('/')} 중에서 고른 목록`, `checks.${name}.on`));
  }
  for (const n of config.common || []) if (!checks[n]) out.push(fail(`common의 "${n}"이 checks에 없다`, 'checks에 정의하거나 common에서 뺀다'));
  for (const [risk, def] of Object.entries(config.risks || {})) {
    if (!isStringList(def?.paths) || !def.paths.length) out.push(fail(`위험 ${risk}: paths(파일 패턴 목록)가 없다`, `risks.${risk}.paths`));
    for (const n of def?.checks || []) if (!checks[n]) out.push(fail(`위험 ${risk}의 검사 "${n}"이 checks에 없다`, 'checks에 정의한다'));
  }
  return out;
}

const STRUCTURE_LISTS = ['flatRoots', 'noGrow', 'forbidden'];
const FUNCTION_LIMITS = ['maxLines', 'componentMaxLines', 'complexity', 'maxDepth', 'maxParams', 'maxNestedCallbacks'];

// config.structure: right shapes, and the tools it turns on are installed in the project.
function structureConfigProblems(root, structure) {
  if (structure === undefined) return [];
  const out = [];
  const at = (key) => `.quality/config.json structure.${key}`;
  for (const key of STRUCTURE_LISTS) if (structure[key] !== undefined && !isStringList(structure[key])) out.push(fail(`structure.${key}는 경로 문자열 목록이어야 한다`, at(key)));
  for (const [i, p] of (structure.patterns || []).entries()) {
    let isRegex = true;
    try { new RegExp(p?.regex); } catch { isRegex = false; }
    if (typeof p?.name !== 'string' || typeof p?.regex !== 'string' || !isRegex || !['docs', 'comments'].includes(p?.in) || (p.exclude !== undefined && !isStringList(p.exclude))) {
      out.push(fail(`structure.patterns[${i}]: name·regex(올바른 정규식)·in("docs"|"comments")이 필요하고 exclude는 경로 목록`, at(`patterns[${i}]`)));
    }
  }
  if (structure.duplicates !== undefined && structure.duplicates !== 'grown') out.push(fail('structure.duplicates는 "grown"만 받는다(빼면 만진 파일의 중복을 모두 막음)', at('duplicates')));
  const refs = structure.backtickRefs;
  if (refs !== undefined && refs !== true && refs !== false && !isStringList(refs)) out.push(fail('structure.backtickRefs는 true 또는 추가 기준 폴더 목록', at('backtickRefs')));
  const limits = structure.functions;
  if (limits !== undefined) {
    const bad = Object.entries(limits || {}).filter(([k, v]) => (k === 'componentDirs' ? !isStringList(v) : !FUNCTION_LIMITS.includes(k) || !(Number.isInteger(v) && v > 0)));
    if (!limits || bad.length) out.push(fail(`structure.functions: ${FUNCTION_LIMITS.join('·')}는 양의 정수, componentDirs는 경로 목록 (${bad.map(([k]) => k).join(', ')})`, at('functions')));
  }
  const usesEslint = limits || structure.unused === true || (structure.patterns || []).some((p) => p?.in === 'comments');
  if (usesEslint && !fs.existsSync(path.join(root, 'node_modules', 'eslint'))) out.push(fail('structure.functions·주석 규칙·unused는 프로젝트의 ESLint로 읽는데 node_modules/eslint가 없다', '`npm i -D eslint` 하거나 그 설정을 뺀다'));
  const repoTools = require('./repo-tools');
  for (const kind of repoTools.KINDS) {
    if (structure[kind] !== undefined && typeof structure[kind] !== 'boolean') out.push(fail(`structure.${kind}는 true/false`, at(kind)));
    if (structure[kind] === true && !fs.existsSync(repoTools.toolPath(root, kind))) out.push(fail(`structure.${kind}가 켜졌는데 ${path.relative(root, repoTools.toolPath(root, kind))}가 없다`, 'devDependencies에 넣고 설치하거나 끈다'));
  }
  if (repoTools.enabled(structure).length && !fs.existsSync(path.join(root, repoTools.BASELINE_FILE))) out.push(fail(`${repoTools.BASELINE_FILE}이 없어 PR 구조 검사가 환경 오류로 멈춘다`, '`qh baseline` 실행 후 커밋'));
  return out;
}

// Light mode: what each Stop can afford.
function lightProblems(root) {
  const config = json(root, '.quality/config.json');
  if (config === null) return [fail('.quality/config.json 없음', '`qh init`')];
  if (config === undefined) return [fail('.quality/config.json이 JSON 형식이 아니다', '파일을 고친다')];
  return configProblems(config);
}

function claudeHookProblems(root) {
  const out = [];
  const files = ['.claude/settings.json', '.claude/settings.local.json'];
  for (const event of ['Stop', 'SessionStart']) {
    const where = files.flatMap((rel) => {
      const s = json(root, rel);
      const entries = s?.hooks?.[event] || [];
      return entries.flatMap((e) => e.hooks || []).filter((h) => QH_HOOK.test(String(h.command))).map(() => rel);
    });
    if (where.length === 0) out.push(fail(`Claude Code ${event} hook에 qh가 없다`, '`qh init` 다시 실행'));
    if (where.length > 1) out.push(fail(`Claude Code ${event} hook에 qh가 ${where.length}번 걸려 있다 (${where.join(', ')})`, '하나만 남긴다 — 두 번 돌면 판정이 겹친다', true));
  }
  return out;
}

function kiroHookProblems(root) {
  const dir = path.join(root, '.kiro', 'hooks');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const stops = files.filter((f) => (json(root, path.join('.kiro', 'hooks', f))?.hooks || []).some((h) => h.trigger === 'Stop' && QH_HOOK.test(String(h.action?.command))));
  if (stops.length === 0) return [fail('Kiro Stop hook에 qh가 없다', '`qh init` 다시 실행')];
  if (stops.length > 1) return [fail(`Kiro Stop hook에 qh가 ${stops.length}곳 (${stops.join(', ')})`, '.kiro/hooks/qh.json 하나만 남긴다', true)];
  return [];
}

const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => p.trim().replace(/\s+/g, ' ')).filter((p) => p.length >= MIN_RULE_CHARS && !p.startsWith('@'));

// CLAUDE.md that imports AGENTS.md shows the agent both files: a paragraph in both is
// read twice, and the two copies drift apart when one is edited.
function ruleProblems(root) {
  const out = [];
  const agents = read(root, 'AGENTS.md');
  const claude = read(root, 'CLAUDE.md');
  const blocks = agents === null ? 0 : agents.split(MARK_START).length - 1;
  if (blocks !== 1) out.push(fail(`AGENTS.md의 qh 규칙 블록이 ${blocks}개`, blocks ? '하나만 남긴다' : '`qh init` 다시 실행', blocks > 1));
  if (claude === null || !claude.includes('@AGENTS.md')) out.push(ask(fail('CLAUDE.md가 @AGENTS.md를 불러오지 않아 Claude Code가 qh 규칙을 못 본다', 'CLAUDE.md에 `@AGENTS.md` 한 줄')));
  else if (agents !== null) {
    const shared = new Set(paragraphs(agents));
    const dup = paragraphs(claude).filter((p) => shared.has(p));
    if (dup.length) out.push(ask(fail(`CLAUDE.md와 AGENTS.md에 같은 규칙 ${dup.length}단락 (CLAUDE.md가 AGENTS.md를 불러오므로 두 번 읽힘). 예: "${dup[0].slice(0, 60)}…"`, 'CLAUDE.md 쪽을 지운다', true)));
  }
  return out;
}

function probeProblems(root, config) {
  const needs = Object.values(config?.checks || {}).some((d) => d?.builtin);
  if (!needs) return [];
  const probe = read(root, PROBE_FILE);
  if (probe === null) return [ask(fail(`내장 검사가 있는데 ${PROBE_FILE}이 없다`, '`qh init`이 초안을 만든다'))];
  if (/throw todo\(/.test(probe)) return [ask(fail(`${PROBE_FILE}에 아직 채우지 않은 부분(todo)이 있다`, '앱·로그인·DB 부분을 채운다'))];
  return [];
}

function mapProblems(root) {
  if (spawnSync('sh', ['-c', `command -v ${MAP_TOOL}`]).status !== 0) return [warn(`코드 지도 도구(${MAP_TOOL})가 없다`, `\`uv tool install ${MAP_TOOL}\` 후 \`qh init\``)];
  const out = [];
  if (!fs.existsSync(path.join(root, MAP_DB))) out.push(warn('코드 지도 색인이 아직 없다', `\`${MAP_TOOL} build --repo .\``));
  const server = json(root, '.mcp.json')?.mcpServers?.[MAP_TOOL];
  if (!server) out.push(warn('.mcp.json에 코드 지도 MCP 서버가 없다', `\`${MAP_TOOL} install --repo . -y --no-instructions\` (안내 블록은 qh 규칙이 대신한다)`));
  else if (server.cwd && fs.realpathSync(root) !== (fs.existsSync(server.cwd) ? fs.realpathSync(server.cwd) : server.cwd)) {
    out.push(warn(`.mcp.json의 코드 지도가 다른 폴더를 가리킨다 (${server.cwd})`, `cwd를 이 저장소로 고치거나 \`${MAP_TOOL} install --repo . -y --no-instructions\` (안내 블록은 qh 규칙이 대신한다) 다시 실행`));
  }
  return out;
}

// What the project's answers require to exist. Without it the answer is only words.
function answerProblems(root, config) {
  const { effectiveAnswers } = require('./questions');
  const a = effectiveAnswers(root, config);
  if (!a) return [warn('프로젝트 질문에 아직 답하지 않았다 (최소 안전선만 켜짐)', '.quality/qh/lib/ask-guide.md대로 질문 세션 (`qh ask` → 사용자 선택 → `qh answer`)')];
  const out = [];
  const checks = Object.values(config.checks || {});
  const hasBuiltin = (b) => checks.some((c) => c?.builtin === b);
  const hasRisk = (r) => isStringList(config.risks?.[r]?.paths) && config.risks[r].paths.length > 0;
  // Config, access table, risks and review.cmd are the person's; docs and CI the agent may write.
  const need = (isMissing, msg, fix) => isMissing && out.push(ask(fail(`답 ${msg}`, fix)));
  const write = (isMissing, msg, fix) => isMissing && out.push(fail(`답 ${msg}`, fix));
  const docs = (rel, label, what) => write(!fs.existsSync(path.join(root, rel)), `"${label}" → ${rel}가 없다`, `${what}을 적는 문서를 만든다`);
  if (a.login === 'A') {
    need(!hasBuiltin('route-access'), '"로그인 기능 있음" → 권한 검사(route-access)가 없다', 'checks에 route-access 검사 추가 (Express가 아니면 사용자와 방법을 정한다)');
    need(!fs.existsSync(path.join(root, '.quality/access.json')), '"로그인 기능 있음" → 권한 표(.quality/access.json)가 없다', '`qh routes --baseline --levels …` 후 사람이 훑는다');
    need(!hasRisk('auth'), '"로그인 기능 있음" → 위험 영역 auth가 없다', 'risks.auth.paths에 로그인·권한 코드 경로 (바꾸면 ADR이 필요해진다)');
  }
  if (a.personal === 'A') {
    docs('docs/personal-data.md', '개인정보 취급함', '어떤 개인정보를 어디에 두고 누가 보는지');
    need(a.login !== 'A' && !fs.existsSync(path.join(root, '.quality/access.json')), '"개인정보 취급함" → 권한 표가 없다', '`qh routes --baseline …`');
  }
  if (a.db === 'A') {
    need(!hasBuiltin('sql-prepare'), '"DB 변경 있음" → SQL 검사(sql-prepare)가 없다', 'checks에 sql-prepare 검사 추가');
    need(!hasRisk('db'), '"DB 변경 있음" → 위험 영역 db가 없다', 'risks.db.paths에 마이그레이션·스키마 경로');
  }
  if (a.external === 'A') need(!hasRisk('external'), '"외부 API 연동 있음" → 위험 영역 external이 없다', 'risks.external.paths에 외부 서비스를 부르는 코드 경로');
  if (a.reviewer !== 'C') need(!config.review?.cmd, `"${a.reviewer === 'B' ? '다른' : '현재'} 에이전트 리뷰 적용" → review.cmd가 없다`, 'config.review.cmd에 리뷰 명령 ({workdir} {task} {out} 사용)');
  if (a.team === 'A') {
    const dir = path.join(root, '.github/workflows');
    const ci = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /qh\.js/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    write(!ci, '"팀 협업 개발" → CI에서 qh를 돌리지 않는다', '.github/workflows/에 `node .quality/qh/bin/qh.js check`를 PR마다 돌리는 단계');
  }
  if (a.deploy === 'A') docs('docs/operations.md', '운영 배포 대상', '배포 전 확인 목록과 장애 회고 방법');
  return out;
}

// A Stop that the agent is told to wait on must stay fast (decision: under 10 s).
function stopSpeedProblems(root, config) {
  const out = [];
  for (const name of config?.common || []) {
    const def = config.checks?.[name];
    if (!def || !(def.on || PHASES).includes('stop')) continue;
    const ev = json(root, `.quality/evidence/${name}.json`);
    const ms = ev?.finishedAt ? Date.parse(ev.finishedAt) - Date.parse(ev.startedAt) : 0;
    if (ms > STOP_BUDGET_MS) out.push(warn(`검사 ${name}이 Stop에서 요구되는데 마지막 실행이 ${Math.round(ms / 1000)}초`, `checks.${name}.on을 ["pr"]로 (Stop은 10초 이내)`));
  }
  return out;
}

function doctor(root, { light = false } = {}) {
  const base = lightProblems(root);
  if (light) return base;
  const human = base.map(ask);
  const config = json(root, '.quality/config.json') || null;
  const gitignore = read(root, '.gitignore') || '';
  return [
    ...(fs.existsSync(path.join(root, '.quality/qh/bin/qh.js')) ? [] : [fail('.quality/qh/에 qh가 설치되어 있지 않다', '`qh init`')]),
    ...human,
    ...claudeHookProblems(root),
    ...kiroHookProblems(root),
    ...ruleProblems(root),
    ...(gitignore.split('\n').some((l) => l.trim() === '.quality/evidence/') ? [] : [fail('.gitignore에 .quality/evidence/가 없다', '한 줄 추가')]),
    ...probeProblems(root, config),
    ...mapProblems(root),
    ...stopSpeedProblems(root, config),
    ...(config ? structureConfigProblems(root, config.structure).map(ask) : []),
    ...(config ? answerProblems(root, config) : []),
  ];
}

// What init must refuse to build on: the same rule or hook in two places.
const duplicateProblems = (root) => [...claudeHookProblems(root), ...kiroHookProblems(root), ...ruleProblems(root)].filter((p) => p.isDuplicate);

function formatDoctor(problems) {
  if (!problems.length) return 'qh doctor: 이상 없음';
  return [`qh doctor: 실패 ${problems.filter((p) => p.level === '실패').length}, 경고 ${problems.filter((p) => p.level === '경고').length}`, ...problems.map((p) => `  [${p.level}] ${p.msg}\n         → ${p.fix}`)].join('\n');
}

module.exports = { doctor, duplicateProblems, formatDoctor, MAP_TOOL, MAP_DB };
