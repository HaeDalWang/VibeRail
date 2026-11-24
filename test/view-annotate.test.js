'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { repo, write, qh, BASIC } = require('./helpers');
const vm = require('node:vm');
const { load } = require('./mini-dom');

function screen(kind, source) {
  const root = repo(BASIC);
  const name = kind === 'spec' ? 'spec.md' : 'options.json';
  write(root, name, typeof source === 'string' ? source : JSON.stringify(source));
  const r = qh(root, ['view', kind, name]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const html = fs.readFileSync(r.stdout.match(/(\S+\.html)/)[1], 'utf8');
  return { ...load(html), html, r };
}
const fields = { gain: '편함', cost: '비용', summary: '설명', mermaid: 'graph TD\nA-->B', problem: '문제', solution: '해결', strength: '근거' };
for (const kind of ['interface', 'architecture']) {
  test(`${kind} copies located annotations from all cards and omits empty annotations`, async () => {
    const source = { title: '비교', [kind === 'interface' ? 'options' : 'candidates']: ['A', 'B'].map((id) => ({ ...fields, id, name: id + ' 제목' })) };
    const { document, copied, r } = screen(kind, source);
    const cards = document.querySelectorAll('article');
    cards[0].querySelector('textarea').value = '이유가 충분합니다';
    cards[0].querySelector('textarea.annotation').value = '   ';
    cards[1].querySelector('textarea.annotation').value = ' 설명을\n더 주세요 ';
    await cards[0].querySelector('button').onclick();
    assert.match(copied[0], /주석:\n- B 제목 · 설명을 더 주세요$/);
    assert.doesNotMatch(copied[0], /- A 제목 ·/);
    assert.match(r.stdout, /주석마다 명세·티켓·카드에 반영/);
  });
}
test('spec renders heading paragraph and list units with optional annotations and no choices', async () => {
  const paragraph = '아주 긴 문단을 적어서 앞 스무 글자만 위치에 남는지 확인합니다';
  const { document, copied } = screen('spec', '# 명세 <제목>\n\n' + paragraph + '\n이어지는 줄\n\n- 첫 항목\n- 둘째 항목\n\n1. 순서 항목');
  const annotations = document.querySelectorAll('textarea.annotation');
  assert.equal(annotations.length, 5);
  assert.equal(document.querySelectorAll('input[type=radio]').length, 0);
  annotations[1].value = '문단 보완';
  annotations[4].value = '  ';
  await document.querySelector('button').onclick();
  assert.equal(copied[0], '주석:\n- ' + paragraph.slice(0, 20) + ' · 문단 보완');
  assert.ok(document.querySelector('h1').textContent.includes('명세 <제목>'));
});

for (const failure of ['network', '500', '409', 'success']) {
  test(`send ${failure} preserves annotations and copy fallback`, async () => {
    const { document, copied, html } = screen('spec', '# 제목');
    const requests = [];
    const context = {
      document, waitSession: { token: 'test-token', endpoint: '/answer' },
      navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
      fetch: async (url, options) => {
        requests.push(JSON.parse(options.body));
        if (failure === 'network') throw new Error('closed');
        return { ok: failure === 'success', status: Number(failure) || 200 };
      },
    };
    vm.createContext(context);
    for (const [, attrs, script] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) if (!/\bsrc=/.test(attrs)) vm.runInContext(script, context);
    document.querySelector('textarea.annotation').value = '주석 보존';
    const buttons = document.querySelectorAll('button');
    await buttons[1].onclick();
    assert.match(document.querySelector('.msg').textContent, failure === '409' ? /이미 보냈습니다/ : failure === 'success' ? /보냈습니다/ : /보내지 못했습니다. 복사해서 대화창에 붙여 넣어 주세요/);
    assert.equal(document.querySelector('textarea.annotation').value, '주석 보존');
    await buttons[0].onclick();
    assert.equal(requests[0].text, copied[0]);
    assert.equal(requests[0].token, 'test-token');
    if (failure === 'success') {
      await buttons[1].onclick();
      assert.match(document.querySelector('.msg').textContent, /이미 보냈습니다/);
      assert.equal(requests.length, 1);
    }
  });
}
test('invalid wait flags fail before making a page or opening a port', () => {
  const root = repo(BASIC);
  write(root, 'spec.md', '# 명세');
  for (const flags of [['--timeout', '1'], ['--wait', '--timeout'], ['--wait', '--timeout', '-1'], ['--wait', '--timeout', 'NaN'], ['--wait', '--wat'], ['--wait', '--wait']]) {
    assert.equal(qh(root, ['view', 'spec', 'spec.md', ...flags]).status, 1);
  }
});
