'use strict';

// `qh view interface <json>` and `qh view glossary`: local HTML under .quality/reports/,
// nothing fetched from the network.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { repo, write, qh, BASIC } = require('./helpers');

const OPTIONS = {
  title: '주문 묶기',
  options: [
    { id: 'A', name: '주문 하나로', summary: '주문과 품목을 한 객체로 묶는다 <b>', mermaid: 'graph TD\n  Cart-->Order', gain: '호출이 단순', cost: '객체가 커진다', signature: 'placeOrder(cart): Order', seam: 'src/orders' },
    { id: 'B', name: '둘로 나누기', summary: '주문과 품목을 따로 둔다', mermaid: 'graph TD\n  Cart-->Item', gain: '작게 나뉜다', cost: '호출이 늘어난다', signature: 'addItem(order, item): void', seam: 'src/items' },
  ],
};
const htmlOf = (root, r) => fs.readFileSync(r.stdout.match(/(\S+\.html)/)[1], 'utf8');
const level = (choice) => ({ ...BASIC, answers: { level: { choice } } });

function view(config, json = OPTIONS) {
  const root = repo(config);
  write(root, 'opts.json', JSON.stringify(json));
  const r = qh(root, ['view', 'interface', 'opts.json']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return { root, r, html: htmlOf(root, r) };
}

test('the interface page lands under .quality/reports/ and escapes what the agent wrote', () => {
  const { root, r, html } = view(level('A'));
  const file = r.stdout.match(/(\S+\.html)/)[1];
  assert.ok(fs.realpathSync(file).startsWith(path.join(fs.realpathSync(root), '.quality', 'reports')));
  assert.match(file, /interface-opts\.html$/);
  assert.match(html, /주문 묶기/);
  assert.match(html, /주문과 품목을 한 객체로 묶는다 &lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.strictEqual(html.match(/<textarea/g).length, 2, 'one reason box per option');
});

test('level A shows name, summary, diagram, gain, cost; level B adds signature and seam', () => {
  const a = view(level('A')).html;
  for (const t of ['주문 하나로', '호출이 단순', '객체가 커진다', 'Cart--&gt;Order']) assert.ok(a.includes(t), t);
  assert.ok(!a.includes('placeOrder'), 'no signature for level A');
  assert.ok(!a.includes('src/orders'), 'no seam for level A');
  assert.ok(view(BASIC).html.includes('주문 하나로'), 'no level answer: A');
  const b = view(level('B')).html;
  assert.ok(b.includes('placeOrder(cart): Order'));
  assert.ok(b.includes('src/orders'));
});

test('the page draws diagrams from a local Mermaid copy: no external address, source text only as fallback', () => {
  const { r, html } = view(level('A'));
  assert.doesNotMatch(html, /(src|href)\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /https?:\/\//i, 'no address the page could call');
  const src = html.match(/<script src="([^"]+)"/);
  assert.ok(src && !/^[a-z]+:|^\//i.test(src[1]), 'local relative script');
  const local = path.join(path.dirname(r.stdout.match(/(\S+\.html)/)[1]), src[1]);
  assert.match(fs.readFileSync(local, 'utf8').slice(0, 200000), /mermaid/i, 'the copy sits next to the page');
  assert.match(html, /<pre[^>]*>graph TD/, 'source stays in the page for the fallback');
  assert.match(html, /mermaid\.render/);
  assert.doesNotMatch(html, /그림 도구를 넣지 않아/);
  assert.match(html, /그림을 그리지 못하면 원본 글/);
});

test('the copy button gives "안: <id>" and "이유: <text>" on two lines and refuses a short reason', () => {
  const { html } = view(level('A'));
  const pure = html.match(/<script id="pure">([\s\S]*?)<\/script>/)[1];
  const ctx = {};
  vm.runInNewContext(pure, ctx);
  assert.strictEqual(ctx.decision('B', '  호출이   단순해서 '), '안: B\n이유: 호출이 단순해서');
  assert.strictEqual(ctx.decision('B', '짧음'), null);
  assert.strictEqual(ctx.decision('B', ''), null);
  assert.strictEqual(ctx.decision('B', '다섯글자요'), '안: B\n이유: 다섯글자요');
});

test('a malformed interface file says what is missing and writes nothing', () => {
  const root = repo(BASIC);
  write(root, 'opts.json', JSON.stringify({ title: 'x', options: [OPTIONS.options[0]] }));
  const one = qh(root, ['view', 'interface', 'opts.json']);
  assert.strictEqual(one.status, 1);
  assert.match(one.stdout, /안이 2개 이상/);
  write(root, 'opts.json', JSON.stringify({ title: 'x', options: [{ id: 'A', name: 'n' }, OPTIONS.options[1]] }));
  assert.match(qh(root, ['view', 'interface', 'opts.json']).stdout, /1번째 안[^\n]*summary[^\n]*mermaid/);
  write(root, 'opts.json', '{nope');
  assert.strictEqual(qh(root, ['view', 'interface', 'opts.json']).status, 1);
  assert.strictEqual(qh(root, ['view', 'interface', 'missing.json']).status, 1);
  assert.strictEqual(fs.existsSync(path.join(root, '.quality/reports')), false);
});

test('the glossary page renders headings, lists, bold and code, escaped, from GLOSSARY.md', () => {
  const root = repo(BASIC, { 'GLOSSARY.md': '# 주문 용어\n\n## Language\n\n**Order**:\n한 번의 구매 <script>x</script>\n_Avoid_: Purchase\n\n- `placeOrder` 로 만든다\n- 두 번째\n' });
  const r = qh(root, ['view', 'glossary']);
  assert.strictEqual(r.status, 0, r.stdout);
  const html = htmlOf(root, r);
  assert.match(html, /<h1>주문 용어<\/h1>/);
  assert.match(html, /<h2>Language<\/h2>/);
  assert.match(html, /<strong>Order<\/strong>/);
  assert.match(html, /<li><code>placeOrder<\/code> 로 만든다<\/li>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('the glossary page says so when there is no GLOSSARY.md', () => {
  const r = qh(repo(BASIC), ['view', 'glossary']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /용어집이 아직 없다/);
});

test('the reason minimum on the interface screen follows config limits', () => {
  const { html } = view({ ...BASIC, limits: { reasonChars: 12 } });
  assert.match(html, /12자 이상/);
  assert.doesNotMatch(html, /5자 이상/);
});

test('the interface page says the person may just tell the AI their pick instead of copying', () => {
  const { r, html } = view(level('A'));
  assert.match(html, /AI 창에[^<]*말해도 됩니다/);
  assert.match(r.stdout, /채팅으로 말해도/, 'the agent accepts a pick said in chat');
});

// ---------- questions beside the options ----------

const Q_KEEP = { text: '옛 주문 형식도 계속 읽을까요?', choices: ['예', '아니요'], recommended: '예' };
const Q_NAME = { text: '이름 <규칙>은?', choices: ['영어', '한국어', '섞어서'] };
const WITH_COMMON = { ...OPTIONS, questions: [Q_KEEP, Q_NAME] };
const pureOf = (html) => {
  const ctx = {};
  vm.runInNewContext(html.match(/<script id="pure">([\s\S]*?)<\/script>/)[1], ctx);
  return ctx;
};

test('common questions show once above the options, escaped, with the recommended choice marked and a free-text 기타', () => {
  const { html } = view(level('A'), WITH_COMMON);
  const top = html.slice(0, html.indexOf('<article'));
  assert.ok(top.includes('옛 주문 형식도 계속 읽을까요?'), 'common question above the first option');
  assert.ok(top.includes('이름 &lt;규칙&gt;은?'), 'escaped');
  assert.doesNotMatch(html, /<규칙>/);
  assert.strictEqual(html.match(/옛 주문 형식도 계속 읽을까요\?/g).length, 2, 'shown once, kept once as the line the copy carries');
  assert.strictEqual(top.match(/type="radio"/g).length, 2 + 1 + 3 + 1, 'each choice plus 기타 per question');
  assert.strictEqual(top.match(/추천/g).length, 1, 'only the recommended choice is marked');
  assert.strictEqual(top.match(/기타/g).length, 2);
  assert.strictEqual(top.match(/type="text"/g).length, 2, 'a free-text box per question');
});

test('the copy carries one card-ready line per common answer and names the unanswered questions', () => {
  const { decision } = pureOf(view(level('A'), WITH_COMMON).html);
  assert.strictEqual(
    decision('B', '호출이 단순해서', [[Q_KEEP.text, '예'], [Q_NAME.text, '  한국어로   하되\n 약어는 영어 ']]),
    '안: B\n이유: 호출이 단순해서\n- [x] 옛 주문 형식도 계속 읽을까요? · 예\n- [x] 이름 <규칙>은? · 한국어로 하되 약어는 영어',
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(decision('B', '호출이 단순해서', [[Q_KEEP.text, ''], [Q_NAME.text, '  ']]))), { missing: [Q_KEEP.text, Q_NAME.text] });
  assert.strictEqual(decision('B', '짧음', [[Q_KEEP.text, '']]), null, 'a short reason is refused first');
  assert.strictEqual(decision('B', '호출이 단순해서', []), '안: B\n이유: 호출이 단순해서');
});

test('a malformed question writes no page and says what to fix', () => {
  const root = repo(BASIC);
  const bad = (q, re) => {
    write(root, 'q.json', JSON.stringify({ ...OPTIONS, questions: [q] }));
    const r = qh(root, ['view', 'interface', 'q.json']);
    assert.strictEqual(r.status, 1, JSON.stringify(q));
    assert.match(r.stdout, re);
  };
  bad({ choices: ['예', '아니요'] }, /공통 1번째 질문[^\n]*text/);
  bad({ text: '두 줄\n질문', choices: ['예', '아니요'] }, /공통 1번째 질문[^\n]*한 줄/);
  bad({ text: 'q', choices: ['예'] }, /공통 1번째 질문[^\n]*2~4개/);
  bad({ text: 'q', choices: ['1', '2', '3', '4', '5'] }, /공통 1번째 질문[^\n]*2~4개/);
  bad({ text: 'q', choices: ['예', 7] }, /공통 1번째 질문[^\n]*2~4개/);
  bad({ text: 'q', choices: ['예', '아니요'], recommended: '모름' }, /공통 1번째 질문[^\n]*추천/);
  write(root, 'q.json', JSON.stringify({ ...OPTIONS, questions: [Q_KEEP, Q_KEEP] }));
  assert.match(qh(root, ['view', 'interface', 'q.json']).stdout, /같은 질문이 두 번/);
  write(root, 'q.json', JSON.stringify({ ...OPTIONS, questions: 'q' }));
  assert.match(qh(root, ['view', 'interface', 'q.json']).stdout, /questions는 목록/);
  assert.strictEqual(fs.existsSync(path.join(root, '.quality/reports')), false);
});

test('an option\'s questions show inside that option\'s card only, after its description and before the reason box', () => {
  const json = { ...WITH_COMMON, options: [OPTIONS.options[0], { ...OPTIONS.options[1], questions: [{ text: '품목 수 상한은?', choices: ['100', '없음'], recommended: '100' }] }] };
  const { html } = view(level('A'), json);
  const [a, b] = html.split('<article').slice(1);
  assert.ok(!a.includes('품목 수 상한은?'), 'not in option A');
  assert.ok(b.includes('품목 수 상한은?'));
  assert.ok(b.indexOf('품목 수 상한은?') > b.indexOf('작게 나뉜다') && b.indexOf('품목 수 상한은?') < b.indexOf('<textarea'), 'after the description, before the reason');
  assert.strictEqual(html.slice(0, html.indexOf('<article')).includes('품목 수 상한은?'), false, 'not among the common questions');
  const scriptAt = html.indexOf('answers(document.querySelector(\'section.common\')).concat(answers(a))');
  assert.ok(scriptAt > 0, 'the copy asks the common questions, then only the picked card\'s questions');
});

test('the same question in the common list and an option is rejected; the same question in two options is fine', () => {
  const root = repo(BASIC);
  const own = (q) => ({ ...OPTIONS.options[1], questions: [q] });
  write(root, 'q.json', JSON.stringify({ ...OPTIONS, questions: [Q_KEEP], options: [OPTIONS.options[0], own(Q_KEEP)] }));
  const dup = qh(root, ['view', 'interface', 'q.json']);
  assert.strictEqual(dup.status, 1);
  assert.match(dup.stdout, /같은 질문이 두 번 있다: 옛 주문 형식/);
  write(root, 'q.json', JSON.stringify({ ...OPTIONS, options: [{ ...OPTIONS.options[0], questions: [Q_NAME] }, own(Q_NAME)] }));
  assert.strictEqual(qh(root, ['view', 'interface', 'q.json']).status, 0);
  write(root, 'q.json', JSON.stringify({ ...OPTIONS, options: [OPTIONS.options[0], own({ text: 'q', choices: ['예'] })] }));
  assert.match(qh(root, ['view', 'interface', 'q.json']).stdout, /2번째 안 1번째 질문[^\n]*2~4개/);
});

test('the agent is told to write the copied answer lines under 판단 필요 unchanged', () => {
  const { r } = view(level('A'), WITH_COMMON);
  assert.match(r.stdout, /## 판단 필요/);
  assert.match(r.stdout, /- \[x\]/);
});

test('a page without questions has no question boxes', () => {
  const { html } = view(level('A'));
  assert.doesNotMatch(html, /type="radio"/);
});

// ---------- architecture candidates ----------

const CANDIDATES = {
  title: '구조 점검 후보',
  candidates: [
    { id: '1', name: '주문 묶음 합치기', problem: '주문 코드가 세 곳에 흩어져 있다 <i>', solution: '한 곳으로 모은다', gain: '고칠 곳이 하나', cost: '한 번에 많이 옮긴다', strength: '높음', mermaidBefore: 'graph TD\n  A-->B', mermaidAfter: 'graph TD\n  A-->C', detail: 'src/orders/*.js' },
    { id: '2', name: '결제 호출 감싸기', problem: '결제 서비스를 여러 곳에서 직접 부른다', solution: '입구를 하나 둔다', gain: '테스트가 쉬워진다', cost: '입구 하나가 더 생긴다', strength: '중간' },
  ],
};

function viewArchitecture(config, json = CANDIDATES) {
  const root = repo(config);
  write(root, 'cands.json', JSON.stringify(json));
  const r = qh(root, ['view', 'architecture', 'cands.json']);
  return { root, r, html: r.status === 0 ? htmlOf(root, r) : '' };
}

test('the architecture page lands under .quality/reports/ in Korean, escaped, one reason box per candidate', () => {
  const { root, r, html } = viewArchitecture(level('A'));
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const file = r.stdout.match(/(\S+\.html)/)[1];
  assert.ok(fs.realpathSync(file).startsWith(path.join(fs.realpathSync(root), '.quality', 'reports')));
  assert.match(file, /architecture-cands\.html$/);
  for (const t of ['구조 점검 후보', '주문 묶음 합치기', '고칠 곳이 하나', '한 번에 많이 옮긴다', '근거의 세기', '지금', '바꾼 뒤']) assert.ok(html.includes(t), t);
  assert.match(html, /흩어져 있다 &lt;i&gt;/);
  assert.doesNotMatch(html, /<i>/);
  assert.strictEqual(html.match(/<textarea/g).length, 2);
  assert.match(r.stdout, /아키텍처 점검:/, 'the agent is told how to record the pick');
});

test('the architecture page has no network address and carries a local Mermaid copy', () => {
  const { r, html } = viewArchitecture(level('A'));
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /cdn|tailwind/i);
  const src = html.match(/<script src="([^"]+)"/);
  assert.ok(src && !/^[a-z]+:|^\//i.test(src[1]));
  assert.ok(fs.existsSync(path.join(path.dirname(r.stdout.match(/(\S+\.html)/)[1]), src[1])));
  assert.strictEqual(html.match(/class="mermaid-src"/g).length, 2, 'before and after of the first candidate; the second has no picture');
});

test('architecture: level A hides the developer detail, level B shows it', () => {
  assert.ok(!viewArchitecture(level('A')).html.includes('src/orders/*.js'));
  assert.ok(viewArchitecture(level('B')).html.includes('src/orders/*.js'));
});

test('the architecture copy button reuses the same two-line pick with the 5-character reason rule', () => {
  const pure = viewArchitecture(level('A')).html.match(/<script id="pure">([\s\S]*?)<\/script>/)[1];
  const ctx = {};
  vm.runInNewContext(pure, ctx);
  assert.strictEqual(ctx.decision('2', '결제가 흩어져 있어서'), '안: 2\n이유: 결제가 흩어져 있어서');
  assert.strictEqual(ctx.decision('2', '짧음'), null);
});

test('a malformed architecture file says what is missing and writes nothing', () => {
  const root = repo(BASIC);
  write(root, 'c.json', JSON.stringify({ title: 'x', candidates: [] }));
  assert.match(qh(root, ['view', 'architecture', 'c.json']).stdout, /후보가 1개 이상/);
  write(root, 'c.json', JSON.stringify({ title: 'x', candidates: [{ id: '1', name: 'n' }] }));
  const r = qh(root, ['view', 'architecture', 'c.json']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /1번째 후보[^\n]*problem[^\n]*solution/);
  write(root, 'c.json', JSON.stringify({ ...CANDIDATES, candidates: [{ ...CANDIDATES.candidates[0], mermaidBefore: 5 }] }));
  assert.match(qh(root, ['view', 'architecture', 'c.json']).stdout, /mermaidBefore/);
  assert.strictEqual(qh(root, ['view', 'architecture']).status, 1);
  assert.strictEqual(fs.existsSync(path.join(root, '.quality/reports')), false);
});

test('the same id twice in an architecture or interface file is rejected', () => {
  const root = repo(BASIC);
  write(root, 'c.json', JSON.stringify({ ...CANDIDATES, candidates: [CANDIDATES.candidates[0], CANDIDATES.candidates[0]] }));
  const a = qh(root, ['view', 'architecture', 'c.json']);
  assert.strictEqual(a.status, 1);
  assert.match(a.stdout, /후보 id가 겹친다/);
  write(root, 'o.json', JSON.stringify({ ...OPTIONS, options: [OPTIONS.options[0], OPTIONS.options[0]] }));
  const i = qh(root, ['view', 'interface', 'o.json']);
  assert.strictEqual(i.status, 1);
  assert.match(i.stdout, /안 id가 겹친다/);
});

test('the architecture page shows common and per-candidate questions with the same rules as the interface page', () => {
  const json = { ...CANDIDATES, questions: [Q_KEEP], candidates: [CANDIDATES.candidates[0], { ...CANDIDATES.candidates[1], questions: [{ text: '결제 입구 이름은?', choices: ['PaymentGate', 'Pay'], recommended: 'Pay' }] }] };
  const { r, html } = viewArchitecture(level('A'), json);
  assert.strictEqual(r.status, 0, r.stdout);
  const [top, first, second] = html.split('<article');
  assert.ok(top.includes(Q_KEEP.text) && !first.includes('결제 입구 이름은?') && second.includes('결제 입구 이름은?'));
  assert.ok(second.indexOf('결제 입구 이름은?') < second.indexOf('<textarea'));
  assert.match(r.stdout, /## 판단 필요/);
  const root = repo(BASIC);
  write(root, 'c.json', JSON.stringify({ ...json, candidates: [CANDIDATES.candidates[0], { ...CANDIDATES.candidates[1], questions: [Q_KEEP] }] }));
  assert.match(qh(root, ['view', 'architecture', 'c.json']).stdout, /같은 질문이 두 번 있다/);
  write(root, 'c.json', JSON.stringify({ ...CANDIDATES, questions: [{ text: 'q', choices: ['예', '아니요'], recommended: '모름' }] }));
  assert.match(qh(root, ['view', 'architecture', 'c.json']).stdout, /공통 1번째 질문[^\n]*추천/);
});
