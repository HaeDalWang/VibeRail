'use strict';

// `qh ask`: write the project questions as one local HTML page (a temp folder outside the
// repository; nothing is uploaded). The person picks, presses "프롬프트 복사", and pastes the
// short block into the agent chat; the agent validates and saves it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QUESTIONS, ALWAYS_ON, recommend } = require('./questions');
const { DECISIONS_FILE } = require('./policy');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Plain words for the three facts every option must state.
const LABELS = { on: '동작 방식', gain: '장점', cost: '비용 / 리스크' };

function card(q, n, rec, saved) {
  const [recId, recWhy] = rec;
  const picked = saved?.choice || recId;
  const options = q.options.map((o) => `
        <label class="opt">
          <input type="radio" name="${q.id}" value="${o.id}" data-label="${esc(o.label)}"${o.id === picked ? ' checked' : ''}>
          <span class="body">
            <span class="head"><b>${o.id}. ${esc(o.label)}</b>${o.id === recId ? '<span class="rec">권장</span>' : ''}</span>
            <dl>${Object.entries(LABELS).map(([k, l]) => `<dt>${l}</dt><dd>${esc(o[k])}</dd>`).join('')}</dl>
          </span>
        </label>`).join('');
  return `
    <section class="card" id="q-${q.id}" data-id="${q.id}" data-short="${esc(q.short)}" data-rec="${recId}">
      <p class="num">질문 ${n} · ${esc(q.short)}</p>
      <h2>${esc(q.title)}</h2>
      <p class="why"><b>확인 배경</b> ${esc(q.why)}</p>
      <p class="hint"><b>권장안: ${recId}</b> — ${esc(recWhy)}</p>
      <div class="opts">${options}</div>
      <label class="reason">변경 사유 <span>(권장안 미선택 시 필수 입력)</span>
        <textarea>${esc(saved?.reason || '')}</textarea></label>
    </section>`;
}

function page(project, rec, saved) {
  const always = ALWAYS_ON.map(([name, what]) => `<li><b>${esc(name)}</b> ${esc(what)}</li>`).join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>품질 질문</title>
<style>
:root{--bg:#f6f6f3;--fg:#1d1d1b;--mute:#6b6b66;--card:#fff;--line:#e2e1dc;--acc:#2f6f4f;--accbg:#e7f2ec;--warn:#b2441f}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mute:#a09f98;--card:#21211f;--line:#34332f;--acc:#7cc39b;--accbg:#1e3328;--warn:#f0936d}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px 16px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:28px;align-items:start}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mute);margin:0 0 20px}
.always{border:1px dashed var(--line);border-radius:10px;padding:12px 16px;margin-bottom:22px;font-size:14px}.always h2{font-size:14px;margin:0 0 4px;color:var(--mute)}.always ul{margin:0;padding-left:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:18px;scroll-margin-top:16px}
.num{margin:0;font-size:13px;font-weight:600;color:var(--acc)}.card h2{font-size:19px;margin:2px 0 8px}
.why,.hint{margin:0 0 6px;font-size:14px}.why{color:var(--mute)}.why b{color:var(--fg);font-weight:600}.hint{color:var(--acc);margin-bottom:12px}
.opts{display:grid;gap:10px}.opt{display:flex;gap:10px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer}
.opt:has(input:checked){border-color:var(--acc);background:var(--accbg)}.opt input{margin-top:5px;accent-color:var(--acc)}
.head{display:flex;gap:8px;align-items:center;margin-bottom:4px}.rec{font-size:12px;color:var(--acc);border:1px solid var(--acc);border-radius:99px;padding:0 8px}
dl{display:grid;grid-template-columns:96px 1fr;gap:3px 10px;margin:0;font-size:14px}dt{color:var(--mute);font-size:13px}dd{margin:0}
.reason{display:block;margin-top:12px;font-size:13px;color:var(--mute)}.reason span{font-size:12px}
textarea{display:block;width:100%;margin-top:4px;min-height:40px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg);padding:7px 9px;font:inherit;font-size:14px}
textarea.need{border-color:var(--warn);border-width:2px}
aside{position:sticky;top:16px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
aside h2{font-size:15px;margin:0 0 8px}aside ol{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:2px}
aside a{display:grid;grid-template-columns:1fr auto;gap:6px;padding:6px 8px;border-radius:6px;color:inherit;text-decoration:none;font-size:14px}
aside a:hover{background:var(--bg)}aside a.here{background:var(--accbg)}aside a .ans{font-weight:600;color:var(--acc);text-align:right}aside a.need .ans{color:var(--warn)}
aside button{width:100%;background:var(--acc);color:var(--bg);border:0;border-radius:8px;padding:10px;font:inherit;font-weight:600;cursor:pointer}
aside button:disabled{opacity:.5;cursor:not-allowed}.msg{font-size:13px;margin:8px 0 0;min-height:1em}.msg.warn{color:var(--warn)}
details{margin-top:10px;font-size:13px}pre{margin:6px 0 0;white-space:pre-wrap;font-size:12px;background:var(--bg);padding:8px;border-radius:6px}
@media (max-width:820px){.wrap{grid-template-columns:1fr}aside{order:-1;position:sticky;top:0;z-index:1;border-radius:0 0 12px 12px}aside ol{grid-template-columns:1fr 1fr;max-height:30vh;overflow:auto}}
</style></head><body><div class="wrap"><main>
<h1>품질 질문 — ${esc(project)}</h1>
<p class="sub">선택한 답에 맞춰 qh가 검사를 켭니다. 미선택 시 권장안이 기본 적용됩니다. 설정 완료 후 우측 "프롬프트 복사"를 눌러 에이전트에 전달하세요.</p>
<section class="always"><h2>기본 활성 규칙</h2><ul>${always}</ul></section>
${QUESTIONS.map((q, i) => card(q, i + 1, rec[q.id], saved[q.id])).join('')}
</main>
<aside><h2>선택 요약</h2><ol id="nav"></ol><button id="copy" type="button">프롬프트 복사</button><p class="msg" id="msg"></p>
<details><summary>생성된 프롬프트 미리보기</summary><pre id="out"></pre></details></aside></div>
<script>
const cards=[...document.querySelectorAll('.card')];const nav=document.getElementById('nav');
nav.innerHTML=cards.map((c,i)=>'<li><a href="#'+c.id+'" data-for="'+c.id+'"><span>'+(i+1)+'. '+c.dataset.short+'</span><span class="ans"></span></a></li>').join('');
const link=(c)=>nav.querySelector('[data-for="'+c.id+'"]');
function state(){
  const missing=[];const lines=['qh 답'];
  for(const c of cards){
    const i=c.querySelector('input:checked');const t=c.querySelector('textarea');const r=t.value.trim().replace(/\\s+/g,' ');
    const need=i.value!==c.dataset.rec&&!r;t.classList.toggle('need',need);if(need)missing.push(c.dataset.short);
    const a=link(c);a.classList.toggle('need',need);a.querySelector('.ans').textContent=i.value+' '+i.dataset.label+(need?' · 변경 사유 필요':'');
    lines.push(c.dataset.id+'='+i.value+(r?' 사유: '+r:''));
  }
  document.getElementById('out').textContent=lines.join('\\n');
  const m=document.getElementById('msg');m.className='msg'+(missing.length?' warn':'');m.textContent=missing.length?'변경 사유가 필요한 질문: '+missing.join(', '):'';
  document.getElementById('copy').disabled=missing.length>0;
  return lines.join('\\n');
}
document.addEventListener('input',state);state();
const io=new IntersectionObserver((es)=>es.forEach((e)=>{if(e.isIntersecting){nav.querySelectorAll('a').forEach((a)=>a.classList.remove('here'));link(e.target).classList.add('here')}}),{rootMargin:'-40% 0px -55% 0px'});cards.forEach((c)=>io.observe(c));
document.getElementById('copy').onclick=async()=>{
  const text=state();
  try{await navigator.clipboard.writeText(text)}catch{const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();document.execCommand('copy');t.remove()}
  const m=document.getElementById('msg');m.className='msg';m.textContent='복사됨 — 에이전트 창에 붙여 넣으세요';
};
</script></body></html>
`;
}

function ask(root, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-ask-'));
  const file = path.join(dir, 'questions.html');
  fs.writeFileSync(file, page(path.basename(root), recommend(root), config.answers || {}));
  return file;
}


// `qh answer`: the agent pipes the pasted block in. Every line is checked before anything
// is written; each changed answer becomes one decision-log line.
function answer(root, text, today = new Date().toISOString().slice(0, 10)) {
  const configFile = path.join(root, '.quality/config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const rec = recommend(root);
  const errors = [];
  const picked = [];
  for (const raw of text.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'qh 답')) {
    const m = raw.match(/^([a-z]+)=([A-Z])(?:\s+사유:\s*(.+))?$/);
    const q = m && QUESTIONS.find((x) => x.id === m[1]);
    const option = q?.options.find((o) => o.id === m[2]);
    if (!option) {
      errors.push(`읽을 수 없는 줄: "${raw}"`);
      continue;
    }
    if (m[2] !== rec[q.id][0] && !m[3]) errors.push(`${q.short}: 권장안(${rec[q.id][0]})과 다르게 골랐는데 변경 사유가 없다`);
    picked.push({ q, option, reason: m[3]?.trim() });
  }
  if (!picked.length && !errors.length) errors.push('답이 없다 (질문 화면의 "프롬프트 복사" 내용을 붙여 넣는다)');
  if (errors.length) return { errors };
  const answers = { ...config.answers };
  const log = [];
  for (const { q, option, reason } of picked) {
    if (answers[q.id]?.choice === option.id && answers[q.id]?.reason === reason) continue;
    answers[q.id] = { choice: option.id, ...(reason ? { reason } : {}), date: today };
    log.push(`- ${today} · 질문 ${q.short}: ${option.id} ${option.label} · ${reason || '권장안'} · 제품 성격이 바뀌면 \`qh ask\`로 다시`);
  }
  if (log.length) {
    fs.writeFileSync(configFile, `${JSON.stringify({ ...config, answers }, null, 2)}\n`);
    const decisions = path.join(root, DECISIONS_FILE);
    const before = fs.existsSync(decisions) ? fs.readFileSync(decisions, 'utf8') : '# 결정 로그\n';
    fs.mkdirSync(path.dirname(decisions), { recursive: true });
    fs.writeFileSync(decisions, `${before.replace(/\n*$/, '\n')}${log.join('\n')}\n`);
  }
  return { errors: [], log };
}

module.exports = { ask, answer };
