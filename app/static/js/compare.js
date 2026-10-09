import {charts,destroy,esc,fmt,text,CHART_TEXT,CHART_MUTED,CHART_GRID} from './visuals.js';
const $=id=>document.getElementById(id);
const DISTRICT_COLORS={'purba-medinipur':'#2563eb','bankura':'#d97706'};
const FALLBACK=['#2563eb','#d97706','#7c3aed','#db2777'];
const COURT_METRICS=['filings','mean_monthly','disposal_median','disposal_p90','hearings_median','gap_median'];
export const slug=d=>String(d||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
let data=null,metric='filings',request=0,controller=null,picked=null,lastParams=null,drill=()=>{};
const colorOf=(d,i)=>DISTRICT_COLORS[slug(d)]||FALLBACK[i%FALLBACK.length];
const metricInfo=k=>data.metrics.find(m=>m.key===k);
const names=()=>data.districts.map(d=>d.district);
/** Level 1 of the Comparison tab: courts of two districts side by side. Choosing a court drills into level 2. */
export function onDrill(fn){drill=fn;}
function fillMetrics(){
 if(!COURT_METRICS.includes(metric))metric='filings';
 $('compareMetric').replaceChildren(...COURT_METRICS.map(k=>new Option(metricInfo(k).label,k,k===metric,k===metric)));
}
function diff(a,b){
 if(a==null||b==null)return '—';
 if(a===0&&b===0)return 'No difference';
 if(a===0)return '—';
 const p=(b-a)/a*100;
 if(Math.abs(p)<0.5)return 'No difference';
 return (p>0?'+':'−')+Math.abs(p).toFixed(0)+'%';
}
function rowsFor(){
 const n=names(),base=data.courts[n[0]]||data.courts[n[1]]||[];
 return base.map(c=>({court:c.court,label:c.label,title:c.name,values:n.map(d=>(data.courts[d]||[]).find(x=>x.court===c.court)?.[metric]??null)}));
}
function drillTo(row){if(row)drill(row.court,names());}
function drawChart(rows){
 const n=names(),info=metricInfo(metric);
 destroy('compare');
 charts.compare=new Chart($('compareChart'),{type:'bar',data:{labels:rows.map(r=>r.label),datasets:n.map((d,i)=>({label:d,data:rows.map(r=>r.values[i]),backgroundColor:colorOf(d,i),borderRadius:2,maxBarThickness:36}))},
  options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},onClick:(e,els)=>{if(els.length)drillTo(rows[els[0].index]);},onHover:(e,els)=>{e.native.target.style.cursor=els.length?'pointer':'default';},
   plugins:{legend:{position:'bottom',labels:{boxWidth:12,color:CHART_TEXT}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${c.parsed.y==null?'not available':fmt(c.parsed.y)+' '+info.unit}`,footer:()=>'Click to compare its case types'}}},
   scales:{x:{ticks:{color:CHART_TEXT,autoSkip:false},grid:{display:false}},y:{beginAtZero:true,ticks:{color:CHART_MUTED},grid:{color:CHART_GRID},title:{display:true,text:info.unit,color:CHART_MUTED}}}}});
}
function drawTable(rows){
 const n=names();
 $('compareHead').innerHTML=`<tr><th>Court</th>${n.map(d=>`<th>${esc(d)}</th>`).join('')}<th>${n.length===2?`${esc(n[1])} vs ${esc(n[0])}`:'Difference'}</th><th></th></tr>`;
 $('compareBody').innerHTML=rows.map((r,i)=>`<tr class="drill-row" data-row="${i}" title="Compare case types in ${esc(r.title)}"><td>${esc(r.label)}</td>${r.values.map(v=>`<td>${fmt(v)}</td>`).join('')}<td>${n.length===2?diff(r.values[0],r.values[1]):'—'}</td><td class="drill-cell">Cases →</td></tr>`).join('');
 $('compareBody').querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',()=>drillTo(rows[+tr.dataset.row])));
}
function drawAll(){
 const n=names();
 $('compareAllHead').innerHTML=`<tr><th>Court</th><th>District</th>${COURT_METRICS.map(k=>`<th>${esc(metricInfo(k).label)}</th>`).join('')}</tr>`;
 const out=[],base=data.courts[n[0]]||data.courts[n[1]]||[];
 for(const c of base)for(const d of n){const row=(data.courts[d]||[]).find(x=>x.court===c.court);out.push(`<tr><td>${esc(c.label)}</td><td>${esc(d)}</td>${COURT_METRICS.map(k=>`<td>${fmt(row?.[k])}</td>`).join('')}</tr>`);}
 $('compareAllBody').innerHTML=out.join('');
}
export function render(){
 if(!data)return;
 fillMetrics();
 const rows=rowsFor();
 text('compareSubtitle',`${names().join(' and ')} · all courts · cases filed ${data.start} to ${data.end}`);
 drawChart(rows);drawTable(rows);drawAll();
 $('compareNotes').innerHTML=data.notes.map(n=>`<li>${esc(n)}</li>`).join('');
}
function fillPickers(all){
 const [a,b]=picked;
 $('compareA').replaceChildren(...all.map(n=>new Option(n,n,n===a,n===a)));
 const rest=all.filter(n=>n!==a);
 $('compareB').replaceChildren(...rest.map(n=>new Option(n,n,n===b,n===b)));
 $('compareB').disabled=rest.length<=1;
}
function pick(which){
 const all=data?.all_districts||[];if(all.length<2)return;
 let [a,b]=picked;
 if(which==='a'){a=$('compareA').value;if(a===b)b=all.find(n=>n!==a);}else b=$('compareB').value;
 picked=[a,b];fillPickers(all);load(lastParams);
}
export async function load(params){
 lastParams=params;
 if(!picked){const all=params.all||[];picked=[params.current,all.find(n=>n!==params.current)].filter(Boolean);}
 const id=++request;controller?.abort();controller=new AbortController();
 const card=$('compareCard');card.classList.add('component-loading');text('compareStatus','Loading comparison…');
 try{
  const q=new URLSearchParams({court:params.court,start:params.start,end:params.end});if(picked.length===2)q.set('districts',picked.join(','));
  const r=await fetch('/api/v1/compare?'+q,{signal:controller.signal}),d=await r.json();
  if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Unable to load comparison');
  if(id!==request)return;
  data=d;picked=d.districts.map(x=>x.district);fillPickers(d.all_districts);text('compareStatus','');render();
 }catch(e){if(e.name!=='AbortError'&&id===request){destroy('compare');text('compareStatus',e.message+' — change the selection or retry.');}}
 finally{if(id===request)card.classList.remove('component-loading');}
}
export function clear(message){request++;controller?.abort();data=null;destroy('compare');text('compareStatus',message||'');}
export function bind(){
 $('compareA').addEventListener('change',()=>pick('a'));$('compareB').addEventListener('change',()=>pick('b'));
 $('compareMetric').addEventListener('change',()=>{metric=$('compareMetric').value;render();});
}
