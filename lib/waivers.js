'use strict';

// Waivers that skip a human decision point only count once the task card records the person's
// answer: the agent writing the waiver alone settles nothing. Three of them:
//   `grilling 불필요` (skips scope + interface picking), `qh confirm` (criteria confirmation),
//   and the secret allow marker (a person says the value is fake).
// qh shows the person a plain-Korean question; the waiver counts when the card's `## 판단 필요` holds
// `- [x] <that exact question> · <answer>`. The card is committed, so CI sees the same answer.
// An unchecked `- [ ] <question>` is an open decision (the PR gate blocks on it, card.js decisions).
// A file line cannot prove a human answered: the same trust level as every other 판단 필요 item.
// The other task-card waivers (테스트·문서·ADR) stay the agent's, and `qh pr` lists them for the reviewer.

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { answerState, isYes, answerTo } = require('./card');
const { declaredReason, isRealReason, isOwnCode, secretWaivers, piiWaivers, DECISIONS_FILE } = require('./policy');

const CRITERIA_FILES = ['.quality/config.json', '.quality/access.json'];

// The criteria as they are now; a person's confirmation is bound to it.
function criteriaFingerprint(root) {
  const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : '');
  return createHash('sha256').update(CRITERIA_FILES.map(read).join('\n')).digest('hex').slice(0, 12);
}

// `qh confirm` recorded this exact version of the criteria in the decision log.
const isCriteriaRecorded = (root) => {
  const file = path.join(root, DECISIONS_FILE);
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(`기준 확인: ${criteriaFingerprint(root)}`);
};

const GRILLING = 'grilling 불필요';

// Binds a secret-waiver answer to the marked values themselves: a swapped value asks again.
const valuesCode = (secrets) => String(parseInt(createHash('sha256').update(secrets.map((w) => w.text).join('\n')).digest('hex').slice(0, 8), 16) % 10000).padStart(4, '0');
const AGENT_WRITABLE = ['테스트 불필요', '문서 영향 없음', 'ADR 불필요', '연동 실패 테스트 불필요'];

// Questions still owed to the person: [{ agent, user }]. user is the sentence the card line must carry.
function pendingWaivers(root, { card, changed }) {
  const out = [];
  const reason = declaredReason(card, GRILLING);
  if (reason !== null && isRealReason(reason) && changed.some(isOwnCode)) {
    out.push({
      agent: `${GRILLING} 선언(이유: "${reason}")은 사용자가 정한 것이 아니다 → 사용자에게 이 작업이 작아서 하려는 일을 따로 묻지 않고 진행해도 되는지 묻는다. 안 된다고 하면 grilling으로 범위를 정한다`,
      user: `이번 작업은 작은 수정(이유: ${reason})이라 하려는 일을 따로 정리하지 않고 바로 진행해도 될까요? 괜찮다고 하면 그대로 진행하고, 아니라고 하면 먼저 무엇을 왜 바꾸는지 같이 정합니다.`,
    });
  }
  const secrets = secretWaivers(root, changed);
  const asked = out.filter((w) => answerState(card, w.user) === 'none');
  if (!secrets.length) return asked;
  const where = secrets.map((w) => `${w.where} (${w.kind})`).join(', ');
  const user = `비밀 키나 비밀번호처럼 보이는 값 ${secrets.length}곳이 가짜(예시용)라고 표시되어 있습니다(확인 번호 ${valuesCode(secrets)}). 정말 실제로 쓰는 키가 아닌가요? 실제 키라면 코드에서 빼고 새 키로 바꿔야 합니다.`;
  // Only a yes counts here (decision 2026-11-23): "아니요, 운영 키예요" must not let the value through.
  const answer = answerTo(card, user);
  if (answer !== null && isYes(answer)) return asked;
  if (answer === null && answerState(card, user) === 'open') return asked;
  return [...asked, {
    agent: answer === null
      ? `비밀값 면제 표시 확인 필요: ${where} → 사용자에게 이 값이 가짜(예시용)인지 묻는다. 진짜면 코드에서 빼고 사용자에게 키 교체를 알린다`
      : `사용자가 "${answer}"라고 답했다(승인 아님): ${where} → 실제 키로 보고 코드에서 빼고 사용자에게 키 교체를 알린다`,
    user,
  }];
}

// What the agent waived by itself (the PR reviewer reads these together): ["테스트 불필요: 이유", …].
function declaredWaivers(card, root, changed = []) {
  const labelled = AGENT_WRITABLE.flatMap((label) => {
    const reason = declaredReason(card, label);
    return reason === null ? [] : [`${label}: ${reason}`];
  });
  return [...labelled, ...piiWaivers(root, changed).map((w) => `qh:allow-pii: ${w}`)];
}

module.exports = { pendingWaivers, declaredWaivers, criteriaFingerprint, isCriteriaRecorded };
