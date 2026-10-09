/* Side-by-side court comparison: one graph per court, each showing the median and the 90th
   percentile together. Used by the compare panel in every tab and by level 2 of the Comparison tab.
   Numbers come from the comparison API and the existing complexity component API. */
import {charts,destroy,esc,fmt,text} from './visuals.js';
import {render as renderComplexity} from './components/complexity.js?v=20261009-comparison-bubble';
import {mountFilingComparison} from './filingComparison.js?v=20261009-filing-flow';
const $=id=>document.getElementById(id);
const LABELS={filings:'Monthly filings',arrival_rate:'Monthly arrival rate',disposal:'Time to disposal',gap:'Filing-to-first-listing gap',hearings:'Hearings per disposed case',monthly_rate:'Monthly hearing rate',case_rate_mo:'Case-wise hearing rate'};
const TAB_METRICS={overview:['hearings','filings'],trends:['filings','arrival_rate'],timeliness:['disposal','gap'],hearingRates:['monthly_rate','case_rate_mo'],complexity:['hearings','case_rate_mo'],register:['filings','disposal']};
const COLORS={a:['#2563eb','rgba(37,99,235,0.35)'],b:['#b45309','rgba(180,83,9,0.35)']};
const MAX_TYPES=12;
let districts=[],current=()=>({}),target=null,enabled=false;
const courtCache=new Map(),panels=new Map();
const same=(x,y)=>x&&y&&x.district===y.district&&x.court===y.court;
async function courtsOf(district){
 if(!courtCache.has(district))courtCache.set(district,fetch('/api/v1/metadata?district='+encodeURIComponent(district)).then(r=>r.json()).then(m=>m.courts));
 return courtCache.get(district);
}
const fill=(sel,items,value)=>sel.replaceChildren(...items.map(([v,l])=>new Option(l,v,v===value,v===value)));
async function defaultTarget(a){
 const district=districts.find(d=>d!==a.district)||a.district,courts=await courtsOf(district);
 const court=courts.some(c=>c.id===a.court)?a.court:courts.find(c=>!(district===a.district&&c.id===a.court))?.id||courts[0].id;
 return {district,court};
}
async function pickCourt(district,wanted){const courts=await courtsOf(district);return courts.some(c=>c.id===wanted)?wanted:courts[0].id;}

/* ---------- fetching and drawing ---------- */
async function fetchPair(metric,req,signal){
 const q=new URLSearchParams({metric,start:req.start,end:req.end,a_district:req.a.district,a_court:req.a.court,b_district:req.b.district,b_court:req.b.court,side:req.side||'all',limit:req.limit||6});
 (req.names||[]).forEach(n=>q.append('type',n));
 const r=await fetch('/api/v1/compare/measure?'+q,{signal}),d=await r.json();
 if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Unable to load comparison');
 return d;
}
function destroyGroup(key){Object.keys(charts).filter(k=>k.startsWith('pair:'+key+':')).forEach(destroy);}
function block(d){
 const el=document.createElement('div');el.className='pair-block';
 el.innerHTML=`<h4 class="pair-title">${esc(d.label)}<span>${esc(d.about)} · ${esc(d.unit)}</span></h4><div class="pair-grid">${['a','b'].map(s=>`<div class="pair-plot pair-plot-${s}"><h5>${esc(d[s].label)}</h5><div class="pair-canvas"><canvas></canvas></div></div>`).join('')}</div>${d.notes.length?`<ul class="compare-notes">${d.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}`;
 return el;
}
function paint(el,d,key){
 const all=[...d.a.rows,...d.b.rows].flatMap(r=>[r.median,r.p90]).filter(v=>v!=null);
 const max=all.length?Math.max(...all)*1.08||1:1;
 el.querySelectorAll('.pair-plot').forEach(plot=>{
  const s=plot.classList.contains('pair-plot-a')?'a':'b',side=d[s],rows=side.rows,[solid,light]=COLORS[s];
  if(!side.available||!rows.some(r=>r.median!=null||r.p90!=null)){plot.querySelector('.pair-canvas').innerHTML='<p class="component-status">'+(side.available?'No eligible observations for this selection.':'No data in the selected months.')+'</p>';return;}
  const k=`pair:${key}:${d.metric}:${s}`;destroy(k);
  charts[k]=new Chart(plot.querySelector('canvas'),{type:'bar',data:{labels:rows.map(r=>r.case_type),datasets:[
   {label:'Median',data:rows.map(r=>r.median),backgroundColor:solid,borderRadius:3,maxBarThickness:26},
   {label:'90th percentile',data:rows.map(r=>r.p90),backgroundColor:light,borderColor:solid,borderWidth:1,borderRadius:3,maxBarThickness:26}]},
   options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{position:'bottom',labels:{boxWidth:12}},tooltip:{callbacks:{title:i=>rows[i[0].dataIndex].case_type,label:c=>`${c.dataset.label}: ${c.parsed.y==null?'not available':fmt(c.parsed.y)+' '+d.unit}`,footer:i=>{const r=rows[i[0].dataIndex];return r.n?`${fmt(r.n)} observations`:'';}}}},
    scales:{x:{ticks:{autoSkip:false,maxRotation:35,minRotation:35,callback(v){const l=this.getLabelForValue(v);return l.length>16?l.slice(0,15)+'…':l;}},grid:{display:false}},y:{beginAtZero:true,max,title:{display:true,text:d.unit}}}}});
 });
}
async function drawPairs(host,metrics,req,key,holder){
 holder.ctrl?.abort();const ctrl=holder.ctrl=new AbortController();
 destroyGroup(key);host.innerHTML='<p class="component-status">Loading comparison…</p>';
 try{
  const data=await Promise.all(metrics.map(m=>fetchPair(m,req,ctrl.signal)));
  if(holder.ctrl!==ctrl)return null;
  const blocks=data.map(block);host.replaceChildren(...blocks);blocks.forEach((el,i)=>paint(el,data[i],key));
  return data;
 }catch(e){if(e.name!=='AbortError'){host.innerHTML=`<p class="component-status error">${esc(e.message)}</p>`;}return null;}
}
const activeTab=()=>document.querySelector('.tab-pane.active')?.id;

/* ---------- compare panel inside every tab ---------- */
const COMPLEXITY_KEY='pair:tab-complexity:bubble:b';
function clearComplexity(p){
 if(!p.bubbleHost)return;
 p.bubbleController?.abort();p.bubbleController=null;
 destroy(COMPLEXITY_KEY);p.bubbleHost.replaceChildren();
}
async function drawComparisonComplexity(p,other,range){
 clearComplexity(p);
 const controller=p.bubbleController=new AbortController();
 const host=p.bubbleHost;
 host.innerHTML='<p class="component-status" role="status">Loading other court’s case complexity…</p>';
 try{
  const metaResponse=await fetch('/api/v1/metadata?district='+encodeURIComponent(other.district),{signal:controller.signal});
  if(!metaResponse.ok)throw new Error('Unable to load the comparison court.');
  const meta=await metaResponse.json();
  if(p.bubbleController!==controller)return;
  const start=range.start>meta.start?range.start:meta.start,end=range.end<meta.end?range.end:meta.end;
  if(start>end){host.innerHTML='<p class="component-status" role="status">No data for the other court in the selected months.</p>';return;}
  // Court-local type codes must not be copied from the primary court. Use the same
  // default as its standalone chart: the top four eligible types by filing volume.
  const q=new URLSearchParams({district:other.district,court:other.court,start,end});
  const response=await fetch('/api/v1/components/complexity?'+q,{signal:controller.signal});
  const data=await response.json();
  if(p.bubbleController!==controller)return;
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Unable to load case complexity.');
  const court=meta.courts.find(c=>c.id===other.court);
  const title=other.district+' · '+(court?.name||other.court);
  host.innerHTML=`<h4 class="pair-title">Case complexity — ${esc(title)}</h4>
   <p class="chart-subtitle">Cases filed ${esc(start)}–${esc(end)} · Top four eligible case types by filing volume at this court. Axis, colour and bubble-size scales are specific to each court; compare values using the axes, legends and tooltips.</p>
   <p class="chart-subtitle" id="comparisonComplexitySubtitle"></p>`;
  const notes=[...(data.meta?.data_quality_warnings||[])];
  if(data.meta?.listing_cutoff)notes.push(`Hearing and case-wise rate measures exclude cases filed before ${data.meta.listing_cutoff}.`);
  if(start!==range.start||end!==range.end)notes.push('Date range limited to the other district’s available data.');
  if(notes.length)host.insertAdjacentHTML('beforeend',`<ul class="compare-notes">${notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`);
  if(!data.points.length){host.insertAdjacentHTML('beforeend','<p class="component-status" role="status">Not enough eligible hearing, rate and disposal observations for a bubble chart.</p>');return;}
  host.insertAdjacentHTML('beforeend',`<div class="complexity-layout">
   <div><div class="complexity-plot"><canvas id="comparisonComplexityChart" role="img" aria-label="Case complexity for ${esc(title)}"></canvas></div>
    <div class="complexity-takeaways"><h4>Key takeaways</h4><ul id="comparisonComplexityTakeawaysList"></ul></div></div>
   <div class="complexity-side-panels">
    <div class="side-panel"><h4>Mean time to disposal (working days)</h4><div class="color-scale-bar"></div><div class="color-scale-labels" id="comparisonComplexityColorLabels"></div></div>
    <div class="side-panel"><h4>Throughput (hearings / working day)</h4><div class="bubble-size-legend" id="comparisonComplexityBubbleLegend"></div><p class="side-panel-note">Bubble area is proportional to throughput.</p></div>
    <div class="side-panel"><h4>Reference lines</h4><p class="side-panel-note">Mean hearings divided by mean case-wise rate: implied duration, not observed mean disposal time.</p></div>
   </div></div>`);
  renderComplexity(data,{prefix:'comparisonComplexity',key:COMPLEXITY_KEY});
 }catch(error){
  if(error.name!=='AbortError'&&p.bubbleController===controller)host.innerHTML=`<p class="component-status error" role="status">${esc(error.message)} — change the comparison selection or toggle Show comparison to retry.</p>`;
 }
}
function drawPanel(tab){
 const p=panels.get(tab);if(!enabled||!p||!target)return;
 p.stale=false;const a=current();
 if(same(a,target)){p.holder.ctrl?.abort();p.filingView?.clear();clearComplexity(p);destroyGroup('tab-'+tab);p.host.innerHTML='<p class="component-status">Choose a different district or court to compare with.</p>';return;}
 drawPairs(p.host,TAB_METRICS[tab],{start:a.start,end:a.end,a:{district:a.district,court:a.court},b:target},'tab-'+tab,p.holder);
 if(tab==='complexity')drawComparisonComplexity(p,{...target},a);
 if(tab==='trends')p.filingView.load({start:a.start,end:a.end,a_district:a.district,a_court:a.court,b_district:target.district,b_court:target.court});
}
let bar=null;
async function fillPicks(){
 const courts=await courtsOf(target.district);
 fill(bar.selD,districts.map(d=>[d,d]),target.district);fill(bar.selC,courts.map(c=>[c.id,c.name]),target.court);
}
function setEnabled(on){
 enabled=on;bar.toggle.checked=on;bar.picks.hidden=!on;
 panels.forEach((p,tab)=>{p.stale=true;p.sec.hidden=!on;if(!on){p.holder.ctrl?.abort();p.filingView?.clear();clearComplexity(p);destroyGroup('tab-'+tab);p.host.innerHTML='';}});
 if(on)drawPanel(activeTab());
}
function refreshPanels(){panels.forEach((p,tab)=>{p.stale=true;if(enabled){p.holder.ctrl?.abort();p.filingView?.clear();clearComplexity(p);destroyGroup('tab-'+tab);p.host.innerHTML='';}});if(enabled)drawPanel(activeTab());}
function mountPanels(){
 // One shared bar above the tabs' content; each tab gets its own results section at the end of its pane.
 const bs=document.createElement('section');bs.className='chart-card pair-panel pair-bar';
 bs.innerHTML='<div class="pair-panel-head"><h3 class="chart-title">Compare with another court</h3><label class="pair-toggle"><input type="checkbox"> Show comparison</label><span class="pair-picks" hidden><label>District <select class="filter-select" data-role="d"></select></label><label>Court <select class="filter-select" data-role="c"></select></label><a href="#" class="pair-jump">Jump to comparison ↓</a></span></div>';
 document.querySelector('.tab-content').prepend(bs);
 bar={sec:bs,picks:bs.querySelector('.pair-picks'),toggle:bs.querySelector('input'),selD:bs.querySelector('[data-role=d]'),selC:bs.querySelector('[data-role=c]')};
 bar.toggle.addEventListener('change',()=>setEnabled(bar.toggle.checked));
 bar.selD.addEventListener('change',async()=>{target={district:bar.selD.value,court:await pickCourt(bar.selD.value,target.court)};await fillPicks();refreshPanels();});
 bar.selC.addEventListener('change',()=>{target={...target,court:bar.selC.value};refreshPanels();});
 bs.querySelector('.pair-jump').addEventListener('click',e=>{e.preventDefault();panels.get(activeTab())?.sec.scrollIntoView({behavior:'smooth',block:'start'});});
 for(const tab of Object.keys(TAB_METRICS)){
  const pane=$(tab);if(!pane)continue;
  const sec=document.createElement('section');sec.className='chart-card pair-panel pair-results';sec.hidden=true;
  sec.innerHTML='<h3 class="chart-title">Side-by-side comparison</h3><div class="pair-host"></div>';
  let bubbleHost=null;
  let filingView=null;
  if(tab==='trends'){
   const filingHost=document.createElement('div');filingHost.className='pair-block filing-flow-comparison';
   sec.insertBefore(filingHost,sec.querySelector('.pair-host'));
   filingView=mountFilingComparison(filingHost);
  }
  if(tab==='complexity'){
   bubbleHost=document.createElement('div');bubbleHost.className='pair-block comparison-complexity';
   sec.insertBefore(bubbleHost,sec.querySelector('.pair-host'));
  }
  pane.append(sec);
  panels.set(tab,{sec,host:sec.querySelector('.pair-host'),bubbleHost,filingView,stale:true,holder:{}});
 }
}

/* ---------- Comparison tab, level 2: cases within the chosen courts ---------- */
const cs={a:null,b:null,metric:'disposal',side:'all',names:[],stale:true,holder:{},data:null};
const holderKey='cases';
function crumb(){
 if(!cs.a||!cs.b)return;
 const l=s=>`${s.district} · ${(courtCache.get(s.district)&&cs._courts?.[s.district]?.find(c=>c.id===s.court)?.label)||s.court}`;
 text('casePairCrumb',`${l(cs.a)}  vs  ${l(cs.b)} · ${LABELS[cs.metric]} · matched by case-type name`);
}
async function fillCaseSelectors(){
 cs._courts={};
 for(const d of new Set([cs.a.district,cs.b.district]))cs._courts[d]=await courtsOf(d);
 for(const s of ['a','b']){
  const k=s.toUpperCase();
  fill($('case'+k+'_district'),districts.map(d=>[d,d]),cs[s].district);
  fill($('case'+k+'_court'),cs._courts[cs[s].district].map(c=>[c.id,c.name]),cs[s].court);
 }
 fill($('caseMetric'),Object.entries(LABELS),cs.metric);
 $('caseSide').value=cs.side;
 crumb();
}
function caseTypesUI(d){
 const shown=new Set([...d.a.rows,...d.b.rows].map(r=>r.case_type)),box=$('caseTypesList');
 box.replaceChildren(...d.case_type_options.map(o=>{
  const label=document.createElement('label'),input=document.createElement('input');
  input.type='checkbox';input.value=o.case_type;input.checked=shown.has(o.case_type);
  label.append(input,document.createTextNode(`${o.case_type} (${o.a_filings??'—'} / ${o.b_filings??'—'})`));
  if(!o.in_both)label.classList.add('one-sided');
  return label;
 }));
 const n=shown.size;
 text('caseTypesSummary',`Case types · ${cs.names.length?'custom selection':'top matched'} · ${n} shown (filings A / B in brackets)`);
 limitTypes();
}
function limitTypes(){const boxes=[...$('caseTypesList').querySelectorAll('input')],n=boxes.filter(i=>i.checked).length;boxes.forEach(i=>{i.disabled=!i.checked&&n>=MAX_TYPES;});}
function caseTable(d){
 const a=Object.fromEntries(d.a.rows.map(r=>[r.case_type,r])),b=Object.fromEntries(d.b.rows.map(r=>[r.case_type,r]));
 const order=[...new Set([...d.a.rows,...d.b.rows].map(r=>r.case_type))];
 const diff=(x,y)=>x==null||y==null||x===0?'—':(Math.abs((y-x)/x)<0.005?'No difference':((y>x?'+':'−')+Math.abs((y-x)/x*100).toFixed(0)+'%'));
 $('casePairHead').innerHTML=`<tr><th rowspan="2">Case type</th><th colspan="2">${esc(d.a.label)}</th><th colspan="2">${esc(d.b.label)}</th><th colspan="2">B vs A</th></tr><tr><th>Median</th><th>90th</th><th>Median</th><th>90th</th><th>Median</th><th>90th</th></tr>`;
 $('casePairBody').innerHTML=order.map(n=>{const x=a[n]||{},y=b[n]||{};return `<tr><td>${esc(n)}</td><td>${fmt(x.median)}</td><td>${fmt(x.p90)}</td><td>${fmt(y.median)}</td><td>${fmt(y.p90)}</td><td>${diff(x.median,y.median)}</td><td>${diff(x.p90,y.p90)}</td></tr>`;}).join('');
}
async function loadCases(){
 if(!cs.a||!cs.b)return;
 cs.stale=false;const cur=current();
 const host=$('casePairHost');
 if(same(cs.a,cs.b)){destroyGroup(holderKey);host.innerHTML='<p class="component-status">Side A and Side B are the same court — pick a different district or court for one side.</p>';$('casePairHead').innerHTML='';$('casePairBody').innerHTML='';return;}
 const data=await drawPairs(host,[cs.metric],{start:cur.start,end:cur.end,a:cs.a,b:cs.b,side:cs.side,names:cs.names,limit:6},holderKey,cs.holder);
 if(!data)return;
 cs.data=data[0];caseTypesUI(cs.data);caseTable(cs.data);crumb();
}
async function setCases(a,b,{load=true}={}){
 cs.a=a;cs.b=b;cs.names=[];await fillCaseSelectors();
 if(load)loadCases();else cs.stale=true;
}
function bindCases(){
 for(const s of ['a','b']){
  const k=s.toUpperCase();
  $('case'+k+'_district').addEventListener('change',async e=>{cs[s]={district:e.target.value,court:await pickCourt(e.target.value,cs[s].court)};cs.names=[];await fillCaseSelectors();loadCases();});
  $('case'+k+'_court').addEventListener('change',e=>{cs[s]={...cs[s],court:e.target.value};cs.names=[];crumb();loadCases();});
 }
 $('caseMetric').addEventListener('change',e=>{cs.metric=e.target.value;crumb();loadCases();});
 $('caseSide').addEventListener('change',e=>{cs.side=e.target.value;cs.names=[];loadCases();});
 $('caseTypesList').addEventListener('change',()=>{limitTypes();const picked=[...$('caseTypesList').querySelectorAll('input:checked')].map(i=>i.value);cs.names=picked;loadCases();});
 $('caseTypesReset').addEventListener('click',()=>{cs.names=[];loadCases();});
}

/* ---------- public API ---------- */
export async function init(options){
 districts=options.districts;current=options.current;
 target=await defaultTarget(current());
 mountPanels();await fillPicks();bindCases();
 await setCases(current(),target,{load:false});
}
/** The sidebar selection changed: refresh every comparison that depends on it. */
export async function invalidate(){
 if(!target)return;
 const a=current();
 if(same(a,target))target=await defaultTarget(a);
 await fillPicks();refreshPanels();
 const b=cs.b&&!same(cs.b,a)?cs.b:target;
 await setCases(a,b,{load:activeTab()==='comparison'});
}
export function onTab(tab){
 if(bar)bar.sec.hidden=!panels.has(tab);
 if(panels.get(tab)?.stale)drawPanel(tab);
 if(tab==='comparison'&&cs.stale)loadCases();
}
/** Drill-down from the courts overview: same court in each chosen district. */
export async function drillInto(court,pair){
 const [a,b]=[pair[0],pair[1]||pair[0]];
 await setCases({district:a,court},{district:b,court});
 $('casePairCard').scrollIntoView({behavior:'smooth',block:'start'});
}
