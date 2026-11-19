'use strict';

// `qh routes --baseline`: reading its options and telling the person what was recorded.

const BASELINE_EXAMPLES = 3;
const USAGE = '사용: qh routes --baseline --levels public,member,admin --labels 누구나,회원,관리자  (낮은 수준부터, 첫 수준은 비로그인. labels는 사용자에게 보여 줄 이름)';

const option = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

// { levels, labels } (labels is { level: 이름 } or absent), or { error } to print.
function parseOptions(args) {
  const levelsArg = option(args, '--levels');
  if (!levelsArg) return { error: USAGE };
  const levels = levelsArg.split(',');
  const names = option(args, '--labels')?.split(',');
  if (names && names.length !== levels.length) return { error: `수준마다 이름이 하나씩 있어야 한다: 수준 ${levels.length}개, 이름 ${names.length}개` };
  return { levels, ...(names ? { labels: Object.fromEntries(levels.map((l, i) => [l, names[i]])) } : {}) };
}

// The lines printed after the table was written.
function reportLines(file, result) {
  const total = Object.keys(result.baseline.routes).length;
  const lines = [`${file}: 라우트 ${total}개를 현재 동작으로 기록. 사람이 확인할 추정 ${result.uncertain.length}개("check" 표시):`];
  const byReason = Map.groupBy(result.uncertain, (route) => result.baseline.routes[route].check);
  for (const [reason, routes] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    const more = routes.length > BASELINE_EXAMPLES ? ` 외 ${routes.length - BASELINE_EXAMPLES}개` : '';
    lines.push(`  - ${reason}: ${routes.length}개 (${routes.slice(0, BASELINE_EXAMPLES).join(', ')}${more})`);
  }
  lines.push('"X에서 4xx/5xx"는 X가 거부되지 않았다는 뜻일 뿐, 그 뒤 역할 검사가 있는지는 모른다. 해당 라우트를 보고 수준을 고치고 check를 지운다.');
  lines.push('현재 동작이라 기존 버그도 들어 있다. 커밋 전에 사람이 한 번 훑는다.');
  return lines;
}

module.exports = { parseOptions, reportLines };
