'use strict';

// The results page for `qh measure`: a summary line, first → now tiles, and every item's
// history with a date column added per measurement (like a body-composition sheet).
// One local file, no fonts or scripts from the network.

const { LIMITS } = require('./policy');
const { esc } = require('./ask');

const TILES = [['files_over_800', '개'], ['duplicated_pct', '%'], ['untested_pct', '%'], ['dead_doc_links', '개'], ['flat_root_files', '개']];

function page(project, rows, groups) {
  const data = JSON.stringify({ rows, groups, tiles: TILES }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>품질 리포트</title>
<style>
:root{--bg:#f6f7f9;--surface:#fff;--ink:#1b2430;--muted:#5b6573;--line:#dde2e8;--grid:#eef1f4;--accent:#1f5fa8;--good:#1e7a4c;--warn:#a8640a;--bad:#b3261e;--num:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--surface:#1a2029;--ink:#e6eaf0;--muted:#9aa5b3;--line:#2c3540;--grid:#222a34;--accent:#6ea8ee;--good:#5cc28f;--warn:#e0a24a;--bad:#f08079;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;padding:0 16px}
main{max-width:1040px;margin:0 auto;padding:40px 0 64px;display:grid;gap:28px}main>*{min-width:0}
h1,h2{margin:0;line-height:1.3}h1{font-size:28px}h2{font-size:18px;padding-bottom:8px;border-bottom:1px solid var(--line)}
p{margin:0;max-width:72ch}.meta{color:var(--muted);font-size:13px}
.verdict{background:var(--surface);border-left:4px solid var(--accent);padding:18px 20px;border-radius:4px;display:grid;gap:6px}.verdict strong{font-size:17px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px;display:grid;gap:4px;align-content:start}
.tile .label{font-weight:600}.tile .num{font-family:var(--num);font-size:28px;font-variant-numeric:tabular-nums;line-height:1.2}
.tile .from{color:var(--muted);font-size:16px}.tile .note{color:var(--muted);font-size:13px}
section{display:grid;gap:12px}
.wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:13px;color:var(--muted);font-weight:600;white-space:nowrap}tr:last-child td{border-bottom:none}
td.n,th.n{font-family:var(--num);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.hist{min-width:900px}.hist td:first-child,.hist th:first-child{min-width:220px;word-break:keep-all}.hist td:nth-child(2){min-width:150px}.hist td:nth-child(3){min-width:120px}body{word-break:keep-all}.hist .group td{background:var(--grid);font-weight:700;font-size:13px;padding-block:6px}
.name{font-weight:600}.desc{display:block;color:var(--muted);font-size:12px;font-weight:400}
.latest{background:color-mix(in srgb,var(--accent) 8%,transparent)}th small{display:block;font-weight:400}
th.before{color:var(--muted);font-style:italic}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.pill.ref{color:var(--muted)}
.delta{display:block;font-size:12px;color:var(--muted);font-family:var(--num)}
svg.spark{display:block;overflow:visible}.ln{fill:none;stroke:var(--muted);stroke-width:2;stroke-linejoin:round}
.pt{fill:var(--muted);stroke:var(--surface);stroke-width:2}.end{fill:var(--accent);stroke:var(--surface);stroke-width:2}
th.qhstart,td.qhstart{border-left:2px solid var(--accent)}
@media (max-width:640px){#why thead{display:none}#why tr,#why td{display:block}#why tr{padding:10px 0;border-bottom:1px solid var(--line)}#why tr:last-child{border-bottom:none}#why td{border:0;padding:4px 14px}#why td::before{content:attr(data-l);display:block;font-size:12px;font-weight:600;color:var(--muted)}#why td.name{font-size:16px}#why td.name::before{content:none}.hist{min-width:0}.hist td:nth-child(2),.hist th:nth-child(2){display:none}.hist td:first-child,.hist th:first-child{min-width:140px;position:sticky;left:0;background:var(--surface);z-index:1}.hist .group td{background:var(--grid)}}
.foot{color:var(--muted);font-size:12px;display:grid;gap:4px}code{font-family:var(--num);font-size:13px}
</style></head><body><main>
<header style="display:grid;gap:6px"><h1>품질 리포트: ${esc(project)}</h1><p class="meta" id="meta"></p></header>
<div class="verdict" id="verdict"></div>
<section aria-label="처음과 지금"><div class="tiles" id="tiles"></div></section>
<section><h2>지표 뜻</h2>
<p class="meta">아래 <span id="judged">4</span>개 지표의 뜻과 보는 법입니다. 변화는 VibeRail 설치 직전(설치 전 기록이 없으면 첫 측정)부터 지금까지의 숫자입니다. 좋고 나쁨은 VibeRail이 판정하지 않고, 목표치는 프로젝트가 정합니다.</p>
<div class="wrap"><table id="why"></table></div></section>
<section><h2>측정 이력</h2>
<p class="meta">측정마다 오른쪽에 날짜 열이 추가됩니다. 같은 날은 마지막 값, 기울어진 날짜는 과거 버전을 소급 측정한 값입니다.</p>
<div class="wrap"><table class="hist" id="hist"></table></div></section>
<footer class="foot">
<span>측정 기준: 측정할 때마다 지금 저장한 버전을 재서 기록 파일에 한 줄씩 더합니다(지우지 않음). 소급 값은 과거 주별 버전 하나를 임시 복사본에서 같은 방식으로 잰 것입니다.</span>
<span>코드 수치는 버전 관리에 올라간 파일만, 테스트와 DB 변경 파일은 코드에서 뺍니다(중복 비율도 같은 기준). 중복은 의미 있는 ${LIMITS.duplicateLines}줄 이상 같은 덩어리만 셈, 한 줄짜리 중복은 못 봄. 테스트는 함수 몸통 하나라도 실행된 파일을 셉니다. 소급 행은 테스트를 돌리지 않아 잴 수 없음입니다.</span>
<span>품질 검사 작동 수치는 이 컴퓨터에 남은 "AI가 답을 끝낼 때" 기록(저장한 버전에는 안 올라감)에서 셉니다. 소급 구간에는 없습니다. 차단이 많다는 건 나쁜 게 아니라 품질 검사가 일을 했다는 뜻입니다.</span>
</footer></main>
<script>
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const D=${data};
const all=D.rows.map(r=>{const o={...r};for(const k in o)if(!['date','sha','backfill','withQh'].includes(k))o[k]=o[k]==null?null:Number(o[k]);o.rules=o.rules||1;return o});
// Only rows counted by today's rules are compared; older ones stay in the file.
const rules=Math.max(...all.map(r=>r.rules));const rows=all.filter(r=>r.rules===rules);const older=all.length-rows.length;
// One column per day, kept apart on the day qh came in (before / after are different columns).
const byDay=new Map();rows.forEach(r=>{const key=r.date+(r.withQh?'+':'');const e=byDay.get(key);byDay.set(key,{date:r.date,row:r,n:(e?e.n:0)+1})});
const days=[...byDay.values()];const last=days[days.length-1];
const qhAt=days.findIndex(d=>d.row.withQh);
// Judged from the last column before qh (or the first column if qh was there from the start).
const base=qhAt>0?qhAt-1:0;
const fmt=v=>v==null?'잴 수 없음':v.toLocaleString('ko-KR',{maximumFractionDigits:2});
const md=d=>{const[,m,dd]=d.split('-');return (+m)+'/'+(+dd)};
const series=(k,lo=0,hi=days.length-1)=>days.slice(lo,hi+1).map(d=>({date:d.date,v:d.row[k]})).filter(p=>p.v!=null);
const items=D.groups.flatMap(([,xs])=>xs);
function change(k,lo=base,hi=days.length-1){const s=series(k,lo,hi);if(s.length<2)return{first:s[0],last:s[0],pill:'<span class="pill ref">'+(s.length?'한 번 측정':'측정 없음')+'</span>',delta:'',d:0};
const first=s[0],lst=s[s.length-1],d=lst.v-first.v,pct=first.v?Math.round(d/first.v*100):null,sign=d>0?'+':d<0?'−':'±';
const delta=sign+fmt(Math.abs(d))+(pct?' ('+sign+Math.abs(pct)+'%)':'');
return{first,last:lst,pill:'',delta,d}}
const W=132,H=34,P=5,t0=Date.parse(days[0].date),t1=Date.parse(last.date);
function spark(k,label){const s=series(k);if(!s.length)return'';const lo=Math.min(...s.map(p=>p.v)),hi=Math.max(...s.map(p=>p.v));
const x=p=>P+(t1===t0?(W-2*P)/2:(Date.parse(p.date)-t0)/(t1-t0)*(W-2*P)),y=p=>hi===lo?H/2:P+(hi-p.v)/(hi-lo)*(H-2*P);
const d=s.map((p,i)=>(i?'L':'M')+x(p).toFixed(1)+','+y(p).toFixed(1)).join('');
const pts=s.map((p,i)=>'<circle class="'+(i===s.length-1?'end':'pt')+'" cx="'+x(p).toFixed(1)+'" cy="'+y(p).toFixed(1)+'" r="'+(i===s.length-1?4:3)+'"><title>'+md(p.date)+' · '+fmt(p.v)+'</title></circle>').join('');
return'<svg class="spark" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+label+' 추이"><path class="ln" d="'+d+'"></path>'+pts+'</svg>'}
const before=days.filter(d=>d.row.backfill==='1'||d.row.backfill===1).length;
document.getElementById('meta').textContent='측정 이력: '+rows.length+'회'+(before?' (소급 '+before+'회)':'')+(older?' | 측정 방식이 바뀌기 전 기록 '+older+'회는 비교에서 뺌'+(before?'':' (같은 방식으로 다시 보려면 AI에게 "지난 8주도 다시 재 줘"라고 하세요)'):'')+' | 기간: '+md(days[0].date)+' ~ '+md(last.date);
// Plain first -> now numbers per metric; nothing here calls a change good or bad.
const moved=(lo,hi)=>items.filter(([k,,,dir])=>dir==='lower'&&series(k,lo,hi).length>1).map(([k,l])=>({l,c:change(k,lo,hi)})).filter(x=>x.c.d!==0);
const names=xs=>xs.map(x=>x.l+' '+fmt(x.c.first.v)+' → '+fmt(x.c.last.v)).join(', ');
const v=document.getElementById('verdict');
if(days.length<2){v.innerHTML='<strong>첫 측정입니다. 다음 측정부터 비교합니다.</strong><p>품질 검사를 넣기 전 흐름도 보려면 AI에게 "지난 8주도 재 줘"라고 하세요. 지난 8주를 거슬러 재서 함께 보여 줍니다.</p>'}
else{const since=qhAt>0?'VibeRail 설치 후 ('+md(days[base].date)+' 설치 직전 → '+md(last.date)+')':(qhAt<0?'VibeRail 설치 전 기록만 있음 ('+md(days[0].date)+' → '+md(last.date)+')':md(days[0].date)+' 대비');
let h='<strong>'+since+' — 숫자가 달라진 주요 지표</strong>';
const m=moved(base,days.length-1);h+='<p>'+(m.length?names(m):'주요 지표 '+items.filter(x=>x[3]==='lower').length+'개는 그대로입니다. 참고 지표의 변화는 아래 측정 이력 표에 있습니다.')+'</p>';
if(qhAt>0&&base>0){const b=moved(0,base);h+='<p class="meta">VibeRail 넣기 전 흐름 ('+md(days[0].date)+' → '+md(days[base].date)+'): '+(b.length?names(b):'주요 지표 그대로')+'</p>'}
if(qhAt<0)h+='<p class="meta">VibeRail이 저장된 뒤 측정하면 설치 후 변화를 따로 보여 줍니다.</p>';
v.innerHTML=h}
const label=k=>(items.find(([x])=>x===k)||[k,k])[1];
document.getElementById('tiles').innerHTML=D.tiles.filter(([k])=>items.some(([key])=>key===k)).map(([k,unit])=>{const c=change(k);if(!c.first||last.row[k]==null)return '<div class="tile"><span class="label">'+label(k)+'</span><span class="num">잴 수 없음</span></div>';
return'<div class="tile"><span class="label">'+label(k)+'</span><span class="num">'+(c.first!==c.last?'<span class="from">'+fmt(c.first.v)+' →</span> ':'')+fmt(c.last.v)+'<small> '+unit+'</small></span><span class="note">'+(c.first===c.last?md(c.last.date):(qhAt>0?'설치 직전 ':'')+md(c.first.date)+' → '+md(c.last.date))+(c.delta?' · '+c.delta:'')+c.pill+'</span></div>'}).join('');
document.getElementById('judged').textContent=items.filter(x=>x[3]==='lower').length;
const tick=t=>esc(t).replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
document.getElementById('why').innerHTML='<thead><tr><th>지표</th><th>뜻</th><th>나빠지면</th><th>좋아지면</th><th>기준과 받아들이는 법</th></tr></thead><tbody>'+
items.filter(x=>x[4]).map(([,l,,,w])=>'<tr><td class="name">'+esc(l)+'</td>'+w.map((t,i)=>'<td data-l="'+['뜻','나빠지면','좋아지면','기준과 받아들이는 법'][i]+'">'+tick(t)+'</td>').join('')+'</tr>').join('')+'</tbody>';
const li=days.length-1;
const head='<thead><tr><th>항목</th><th>추이</th><th>변화 ('+(qhAt>0?'설치 직전':'처음')+'→최근)</th>'+days.map((d,i)=>'<th class="n'+(i===li?' latest':'')+(d.row.backfill==1?' before':'')+(i===qhAt&&qhAt>0?' qhstart':'')+'">'+md(d.date)+(i===qhAt&&qhAt>0?'<small>VibeRail 설치 후</small>':'')+(d.n>1?'<small>'+d.n+'회 중 마지막</small>':'')+'</th>').join('')+'</tr></thead>';
const body=D.groups.map(([g,xs])=>'<tr class="group"><td colspan="'+(3+days.length)+'">'+g+'</td></tr>'+xs.map(([k,l,desc])=>{const c=change(k);
return'<tr><td><span class="name">'+l+'</span><span class="desc">'+desc+'</span></td><td>'+spark(k,l)+'</td><td>'+c.pill+'<span class="delta">'+c.delta+'</span></td>'+days.map((d,i)=>'<td class="n'+(i===li?' latest':'')+(i===qhAt&&qhAt>0?' qhstart':'')+'">'+fmt(d.row[k])+'</td>').join('')+'</tr>'}).join('')).join('');
document.getElementById('hist').innerHTML=head+'<tbody>'+body+'</tbody>';
</script></body></html>
`;
}

module.exports = { page };
