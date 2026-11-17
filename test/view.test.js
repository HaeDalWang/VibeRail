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

test('the page works offline: no external address, mermaid shown as text with a note', () => {
  const { html } = view(level('A'));
  assert.doesNotMatch(html, /(src|href)\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.match(html, /<pre[^>]*>graph TD/);
  assert.match(html, /인터넷 없이[^<]*그림 도구를 넣지 않아/);
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
