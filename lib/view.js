'use strict';

// `qh view interface <json>`, `qh view architecture <json>` and `qh view glossary`: local HTML under .quality/reports/
// for the person to read and choose (nothing is fetched or uploaded). The agent writes
// the interface options as JSON; the person picks one, gives a reason, and pastes the
// copied line into the chat. Level A (default) sees what each option does; level B also
// sees the signature and the test seam. `config.answers.level` holds the level.
//
// Interface JSON: { title, options: [{ id, name, summary, mermaid, gain, cost, signature?, seam? }] }
// Architecture JSON (the periodic check; replaces the HTML report step of improve-codebase-architecture):
//   { title, candidates: [{ id, name, problem, solution, gain, cost, strength, mermaidBefore?, mermaidAfter?, detail? }] }

const fs = require('node:fs');
const path = require('node:path');
const { esc } = require('./ask');
const { REPORTS_DIR } = require('./measure');
const { LIMITS } = require('./policy');

const REQUIRED = ['id', 'name', 'summary', 'mermaid', 'gain', 'cost'];
const LABELS = { gain: '장점', cost: '비용 / 리스크' };
// Mermaid is a pinned local copy (lib/mermaid.min.js, MIT, see lib/mermaid.LICENSE) written next
// to the page; nothing is fetched. The source text stays in the page and shows only if drawing fails.
const MERMAID_FILE = 'mermaid.min.js';
const MERMAID_NOTE = '그림은 이 컴퓨터 안에서 그립니다. 그림을 그리지 못하면 원본 글이 대신 보이니, AI에게 말로 풀어 달라고 하면 됩니다.';

const STYLE = `.diagram svg{max-width:100%;height:auto}.diagram{overflow-x:auto}:root{--bg:#f6f6f3;--fg:#1d1d1b;--mute:#6b6b66;--card:#fff;--line:#e2e1dc;--acc:#2f6f4f;--warn:#b2441f}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mute:#a09f98;--card:#21211f;--line:#34332f;--acc:#7cc39b;--warn:#f0936d}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px}h1{font-size:22px}h2{font-size:18px}.mute{color:var(--mute);font-size:14px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:0 0 18px}
dt{color:var(--mute);font-size:13px}dd{margin:0 0 6px}pre{white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:6px;font-size:13px}
textarea{width:100%;min-height:44px;box-sizing:border-box;background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:7px;font:inherit}
button{background:var(--acc);color:var(--bg);border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}.msg{font-size:13px;min-height:1em}.msg.warn{color:var(--warn)}`;

const shell = (title, body, script = '') => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${script}</body></html>
`;

function optionCard(o, level) {
  const rows = Object.entries(LABELS).map(([k, l]) => `<dt>${l}</dt><dd>${esc(o[k])}</dd>`).join('');
  const dev = level === 'B' ? `<dt>signature</dt><dd><pre>${esc(o.signature || '-')}</pre></dd><dt>테스트 위치(seam)</dt><dd><pre>${esc(o.seam || '-')}</pre></dd>` : '';
  return `<article data-id="${esc(o.id)}"><h2>${esc(o.id)}. ${esc(o.name)}</h2><p>${esc(o.summary)}</p>
<div class="diagram"></div><pre class="mermaid-src">${esc(o.mermaid)}</pre><dl>${rows}${dev}</dl>
<label>고른 이유 <span class="mute">(${LIMITS.reasonChars}자 이상)</span><textarea></textarea></label>
<p><button type="button">이 안으로 정하고 복사</button></p><p class="msg"></p></article>`;
}

// decision() is the one place the copied line is built, so a test can run it without a browser.
const PURE = `<script id="pure">
function decision(id,reason){var r=String(reason).trim().replace(/\\s+/g,' ');return r.length<${LIMITS.reasonChars}?null:'안: '+id+'\\n이유: '+r}
</script>`;
const DRAW = `<script src="${MERMAID_FILE}"></script>
<script>
(function(){
  if(typeof mermaid==='undefined')return;
  var dark=matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:dark?'dark':'default'});
  document.querySelectorAll('.mermaid-src').forEach(function(pre,i){
    var box=pre.previousElementSibling;
    try{mermaid.render('d'+i,pre.textContent).then(function(r){box.innerHTML=r.svg;pre.hidden=true}).catch(function(){})}catch(e){}
  });
})();
</script>`;
const WIRE = `<script>
document.querySelectorAll('article').forEach(function(a){
  var msg=a.querySelector('.msg');
  a.querySelector('button').onclick=async function(){
    var text=decision(a.dataset.id,a.querySelector('textarea').value);
    msg.className='msg'+(text?'':' warn');
    if(!text){msg.textContent='이유를 ${LIMITS.reasonChars}자 이상 적어 주세요. 이유 없이는 정할 수 없습니다.';return}
    try{await navigator.clipboard.writeText(text)}catch(e){var t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();document.execCommand('copy');t.remove()}
    msg.textContent='복사됨 — AI 창에 붙여 넣으세요';
  };
});
</script>`;

// Problems with the agent's JSON, in words the agent can fix; [] when fine.
function optionProblems(spec) {
  if (!spec || typeof spec.title !== 'string' || !Array.isArray(spec.options)) return ['{ title, options: [...] } 모양이어야 한다'];
  const out = spec.options.length < 2 ? ['안이 2개 이상이어야 한다 (codebase-design의 DESIGN-IT-TWICE)'] : [];
  spec.options.forEach((o, i) => {
    const missing = REQUIRED.filter((k) => typeof o?.[k] !== 'string' || !o[k].trim());
    if (missing.length) out.push(`${i + 1}번째 안에 빠진 항목: ${missing.join(', ')}`);
  });
  return out;
}

function interfacePage(spec, level) {
  const intro = `<h1>${esc(spec.title)}</h1><p class="mute">안을 읽고 하나를 고른 뒤, 고른 이유를 적고 복사해서 AI 창에 붙여 넣으세요. 복사가 번거로우면 AI 창에 "B안, 이유는 …"처럼 말해도 됩니다. ${esc(MERMAID_NOTE)}</p>`;
  return shell(spec.title, intro + spec.options.map((o) => optionCard(o, level)).join(''), PURE + DRAW + WIRE);
}

// ---------- architecture candidates ----------

const CANDIDATE_REQUIRED = ['id', 'name', 'problem', 'solution', 'gain', 'cost', 'strength'];
const CANDIDATE_LABELS = { problem: '문제', solution: '바꾸는 방향', gain: '장점', cost: '비용 / 리스크', strength: '근거의 세기' };
const isText = (v) => typeof v === 'string' && v.trim() !== '';

function candidateProblems(spec) {
  if (!spec || typeof spec.title !== 'string' || !Array.isArray(spec.candidates)) return ['{ title, candidates: [...] } 모양이어야 한다'];
  const out = spec.candidates.length < 1 ? ['후보가 1개 이상이어야 한다'] : [];
  spec.candidates.forEach((c, i) => {
    const missing = CANDIDATE_REQUIRED.filter((k) => !isText(c?.[k]));
    if (missing.length) out.push(`${i + 1}번째 후보에 빠진 항목: ${missing.join(', ')}`);
    for (const k of ['mermaidBefore', 'mermaidAfter', 'detail']) if (c?.[k] !== undefined && !isText(c[k])) out.push(`${i + 1}번째 후보의 ${k}는 비어 있지 않은 글이어야 한다`);
  });
  return out;
}

const picture = (label, src) => (src ? `<h3>${label}</h3><div class="diagram"></div><pre class="mermaid-src">${esc(src)}</pre>` : '');

function candidateCard(c, level) {
  const rows = Object.entries(CANDIDATE_LABELS).map(([k, l]) => `<dt>${l}</dt><dd>${esc(c[k])}</dd>`).join('');
  const dev = level === 'B' && c.detail ? `<dt>개발자용 세부</dt><dd><pre>${esc(c.detail)}</pre></dd>` : '';
  return `<article data-id="${esc(c.id)}"><h2>${esc(c.id)}. ${esc(c.name)}</h2><dl>${rows}${dev}</dl>${picture('지금', c.mermaidBefore)}${picture('바꾼 뒤', c.mermaidAfter)}
<label>고른 이유 <span class="mute">(${LIMITS.reasonChars}자 이상)</span><textarea></textarea></label>
<p><button type="button">이 후보로 정하고 복사</button></p><p class="msg"></p></article>`;
}

function architecturePage(spec, level) {
  const intro = `<h1>${esc(spec.title)}</h1><p class="mute">후보를 읽고 하나를 고른 뒤, 고른 이유를 적고 복사해서 AI 창에 붙여 넣으세요. 복사가 번거로우면 AI 창에 "1번, 이유는 …"처럼 말해도 됩니다. ${esc(MERMAID_NOTE)}</p>`;
  return shell(spec.title, intro + spec.candidates.map((c) => candidateCard(c, level)).join(''), PURE + DRAW + WIRE);
}

// Headings, lists, bold, italics and code; blank lines split paragraphs. Escaped first.
function markdownToHtml(md) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');
  const out = [];
  let para = [];
  let list = false;
  const flush = () => {
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
    para = [];
    if (list) out.push('</ul>');
    list = false;
  };
  for (const line of md.split('\n')) {
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*[-*+]\s+(.*)$/);
    if (head) { flush(); out.push(`<h${head[1].length}>${inline(head[2])}</h${head[1].length}>`); }
    else if (item) {
      if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; }
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(item[1])}</li>`);
    } else if (!line.trim()) flush();
    else para.push(inline(line.trim()));
  }
  flush();
  return out.join('\n');
}

function write(root, name, html) {
  const dir = path.join(root, REPORTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

const KINDS = {
  interface: { problems: optionProblems, page: interfacePage, label: 'interface 선택', record: '카드 `## interface 결정`' },
  architecture: { problems: candidateProblems, page: architecturePage, label: '아키텍처 점검', record: '`docs/decisions.md`의 `아키텍처 점검: <날짜> · <후보> · <이유>` 줄' },
};

function run(root, args, config) {
  const [what, jsonFile] = args;
  if (what === 'glossary') {
    const src = path.join(root, 'GLOSSARY.md');
    if (!fs.existsSync(src)) {
      console.log('용어집이 아직 없다: GLOSSARY.md는 domain-modeling이 첫 용어를 정할 때 만든다');
      return 1;
    }
    const file = write(root, 'glossary.html', shell('용어집', markdownToHtml(fs.readFileSync(src, 'utf8'))));
    console.log(`용어집 화면: ${file}\n브라우저로 연다 (파일은 이 컴퓨터에만 있다).`);
    return 0;
  }
  const kind = KINDS[what];
  if (!kind || !jsonFile) {
    console.log('사용: qh view interface <옵션.json> | qh view architecture <후보.json> | qh view glossary');
    return 1;
  }
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(path.resolve(jsonFile), 'utf8'));
  } catch (err) {
    console.log(`읽을 수 없다: ${jsonFile} (${err.code || 'JSON 형식 아님'})`);
    return 1;
  }
  const problems = kind.problems(spec);
  if (problems.length) {
    console.log(['화면을 만들지 않음:', ...problems.map((p) => `  - ${p}`)].join('\n'));
    return 1;
  }
  const level = config.answers?.level?.choice === 'B' ? 'B' : 'A';
  const file = write(root, `${what}-${path.basename(jsonFile, '.json')}.html`, kind.page(spec, level));
  fs.copyFileSync(path.join(__dirname, MERMAID_FILE), path.join(path.dirname(file), MERMAID_FILE));
  console.log(`${kind.label} 화면: ${file}\n사용자에게 이 파일을 브라우저로 열어 달라고 한다. 사용자가 고른 것과 이유를 붙여 넣거나 채팅으로 말해도 받아서 ${kind.record}에 그대로 적는다.`);
  return 0;
}

module.exports = { run };
