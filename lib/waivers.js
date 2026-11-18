'use strict';

// Waivers that skip a human decision point only count after qh has shown that question to
// the person: the agent writing the words alone settles nothing. Three of them:
//   `grilling 불필요` (skips scope + interface picking), `qh confirm` (criteria confirmation),
//   and the secret allow marker (a person says the value is fake).
// "Shown" is the existing asked pattern (lib/stop-state.js markAsked): the Stop hook records the key
// of every question it hands over. The other task-card waivers (테스트·문서·ADR) stay the agent's,
// and `qh pr` lists them for the reviewer (declaredWaivers).

const { createHash } = require('node:crypto');
const { declaredReason, isRealReason, isOwnCode, secretWaivers } = require('./policy');

const short = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);
const criteriaKey = (fingerprint) => `waive:criteria:${fingerprint}`;

const GRILLING = 'grilling 불필요';
const AGENT_WRITABLE = ['테스트 불필요', '문서 영향 없음', 'ADR 불필요', '연동 실패 테스트 불필요'];

// Questions still owed to the person: [{ key, agent, user }]. asked: the keys already shown.
function pendingWaivers(root, { card, changed, asked }) {
  const out = [];
  const reason = declaredReason(card, GRILLING);
  if (reason !== null && isRealReason(reason) && changed.some(isOwnCode)) {
    out.push({
      key: `waive:grilling:${short(reason)}`,
      agent: `${GRILLING} 선언(이유: "${reason}")은 사용자가 정한 것이 아니다 → 사용자에게 이 작업이 작아서 하려는 일을 따로 묻지 않고 진행해도 되는지 묻는다. 안 된다고 하면 grilling으로 범위를 정한다`,
      user: '이번 작업은 작은 수정이라 하려는 일을 따로 정리하지 않고 바로 진행해도 될까요? 괜찮다고 하면 그대로 진행하고, 아니라고 하면 먼저 무엇을 왜 바꾸는지 같이 정합니다.',
    });
  }
  for (const w of secretWaivers(root, changed)) {
    out.push({
      key: `waive:secret:${short(w.text)}`,
      agent: `비밀값 면제 표시 확인 필요: ${w.where} (${w.kind}) → 사용자에게 이 값이 가짜(예시용)인지 묻는다. 진짜면 코드에서 빼고 사용자에게 키 교체를 알린다`,
      user: '비밀 키나 비밀번호처럼 보이는 값이 코드에 있는데 가짜(예시용)라고 표시되어 있습니다. 정말 실제로 쓰는 키가 아닌가요? 실제 키라면 코드에서 빼고 새 키로 바꿔야 합니다.',
    });
  }
  return out.filter((w) => !asked.has(w.key));
}

// What the agent waived by itself (the PR reviewer reads these together): ["테스트 불필요: 이유", …].
function declaredWaivers(card) {
  return AGENT_WRITABLE.flatMap((label) => {
    const reason = declaredReason(card, label);
    return reason === null ? [] : [`${label}: ${reason}`];
  });
}

module.exports = { pendingWaivers, declaredWaivers, criteriaKey };
