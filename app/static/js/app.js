import {charts,destroy,text} from './visuals.js';
import {setupChartControls} from './controls.js';
import {setupChartZoomModal} from './zoom.js';
import * as compare from './compare.js';
import * as pairs from './pairs.js?v=20261009-filing-flow';
const $=id=>document.getElementById(id);
let metadata,revision=0,page=0,validSelection=false;
const selections={filing:[],hearing:[],complexity:[]};
const requests=new Map(),versions=new Map(),results=new Map();
const targets={kpis:'.stats-grid',ranking:'#topPerformers',filingObservations:'#filingObservations',delayFlags:'#outliersList',hearingObservations:'#hearingRateObservations',register:'#registerBody'};
const groups={filing:['trendCaseTypes','trendSelectionStatus',5],hearing:['hearingRateCaseTypes','hearingRateSelectionStatus',5],complexity:['complexityCaseTypes','complexitySelectionStatus',Infinity]};
Chart.defaults.color='#5b4636';Chart.defaults.font.family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel=m=>{const [y,n]=String(m).split('-');return MONTHS[+n-1]+' '+y;};
const dateLabel=d=>{const [y,m,day]=String(d||'').split('-');return y&&m&&day?`${+day} ${MONTHS[+m-1]} ${y}`:'—';};
function applyDistrictTheme(){
 const name=metadata.district;
 document.body.dataset.district=compare.slug(name);
 document.title=name+' District Courts — Case Statistics';
 text('govOrg',metadata.organisation||'');$('govOrg').hidden=!metadata.organisation;
 text('govTitle',name+' District Courts');
 text('districtChip',name);
}
function updateContext(){
 const court=metadata.courts.find(c=>c.id===$('courtFilter').value);
 const start=$('startMonth').value,end=$('endMonth').value;
 text('contextBar',[metadata.district+' district',court?court.name:'',start&&end?`Cases filed ${monthLabel(start)} to ${monthLabel(end)}`:'',`Data as on ${dateLabel(metadata.extracted_on)}`].filter(Boolean).join('  ·  '));
}
function params(key){const q=new URLSearchParams({district:$('districtFilter').value,court:$('courtFilter').value,start:$('startMonth').value,end:$('endMonth').value});const group=metadata.components[key]?.group;if(group&&selections[group]?.length)q.set('types',selections[group].join(','));if(group==='filing')q.set('smoothing',$('trendSmoothing').value==='ma12'?'ma12':'actual');if(key==='register'){q.set('side',$('registerSideFilter').value);q.set('search',$('registerSearch').value);q.set('page',page);}return q;}
async function get(url,signal){const r=await fetch(url,{signal});const d=await r.json();if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Unable to load this selection');return d;}
function panel(key){const item=metadata.components[key];const el=item?.canvas?$(item.canvas):document.querySelector(targets[key]||'__missing');return el?.closest('.chart-card,.table-card,.stats-grid')||el;}
function status(key,message,error=false){const p=panel(key);if(!p)return;let el=p.querySelector(`[data-status="${key}"]`);if(!el){el=document.createElement('p');el.dataset.status=key;el.setAttribute('role','status');p.append(el);}el.className='component-status'+(error?' error':'');el.textContent=message;}
async function load(key){
 const item=metadata.components[key];if(!item)return;
 if(!validSelection)return;
 requests.get(key)?.abort();const controller=new AbortController();requests.set(key,controller);
 const version=(versions.get(key)||0)+1;versions.set(key,version);const rev=revision;
 results.delete(key);destroy(key);panel(key)?.classList.remove('component-failed');panel(key)?.classList.add('component-loading');status(key,'Loading selected cohort…');
 try{
  const [d,module]=await Promise.all([get('/api/v1/components/'+key+'?'+params(key),controller.signal),import(item.renderer)]);
  if(rev!==revision||version!==versions.get(key))return;
  module.render(d);results.set(key,d);
  if(key==='register')page=d.page;
  if(key==='complexity'&&!selections.complexity.length)populate('complexity',d.available,4);
  status(key,d.rows?.length===0||d.series?.length===0?(key==='delayFlags'?'No delay flags in this selection.':'No eligible observations in this selection.'):'');
  const p=panel(key);if(p)p.title=`${d.meta.start}–${d.meta.end}; ${d.meta.filing_cohort_n} cases filed in this range. Events through ${d.meta.observation_end}.`;
 }catch(e){if(e.name!=='AbortError'&&rev===revision&&version===versions.get(key)){panel(key)?.classList.add('component-failed');status(key,e.message+' — change filters or retry.',true);}}
 finally{if(rev===revision&&version===versions.get(key))panel(key)?.classList.remove('component-loading');}
}
function populate(group,rows,defaults=3){const [container]=groups[group];const available=new Set(rows.map(r=>r.code));selections[group]=selections[group].filter(c=>available.has(c));if(!selections[group].length)selections[group]=rows.slice(0,defaults).map(r=>r.code);$(container).replaceChildren(...rows.map(r=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=r.code;input.checked=selections[group].includes(r.code);label.append(input,document.createTextNode(r.case_type+(group==='complexity'?` (${r.filings} filed)`:'')));return label;}));selectionStatus(group);}
function selectionStatus(group){const [container,id,limit]=groups[group];$(container).querySelectorAll('input').forEach(i=>{i.disabled=(!i.checked&&selections[group].length>=limit)||(i.checked&&selections[group].length===1);});text(id,selections[group].length?`${selections[group].length}${Number.isFinite(limit)?' of '+limit:''} selected`:'No eligible case types in this range.');}
function reloadGroup(group){for(const [key,item] of Object.entries(metadata.components))if(item.group===group)load(key);}
function showSourceWarning(){const warnings=metadata.data_quality_warnings||[];text('dataQualityWarning',warnings.join(' '));$('dataQualityWarning').hidden=!warnings.length;}
async function refresh(){
 const rev=++revision;requests.forEach(c=>c.abort());page=0;validSelection=false;$('exportBtn').disabled=true;
 const start=$('startMonth').value,end=$('endMonth').value;
 $('filterError').hidden=true;
 if(!start||!end||start>end||start<metadata.start||end>metadata.end){$('filterError').textContent='Choose an ordered range within the available complete months.';$('filterError').hidden=false;for(const key of Object.keys(metadata.components)){destroy(key);panel(key)?.classList.add('component-failed');status(key,'Invalid month range.',true);}compare.clear('Invalid month range.');return;}
 for(const g of Object.keys(selections))selections[g]=[];
 for(const key of Object.keys(metadata.components)){destroy(key);status(key,'Loading selected cohort…');panel(key)?.classList.add('component-loading');}
 try{
  const d=await get('/api/v1/options?'+params('options'));if(rev!==revision)return;
  validSelection=true;$('exportBtn').disabled=false;populate('filing',d.types);populate('hearing',d.types);populate('complexity',[],4);
  const c=metadata.courts.find(c=>c.id===$('courtFilter').value);text('registerCourtName',c.name);
  text('footnoteText',`Cases filed ${start}–${end}; events through ${d.meta.observation_end}. ${d.meta.cutoff_note||'No historical filing cut-offs apply to this court.'} Duration statistics include observed events only.`);
  text('extractedOn',dateLabel(metadata.extracted_on));updateContext();compare.load({court:$('courtFilter').value,start,end,all:metadata.districts,current:metadata.district});pairs.invalidate();
  for(const key of ['hearings','gap','casewiseHearingRate','complexity']){const sub=document.querySelector(`[data-component="${key}"] .chart-subtitle`);if(!sub)continue;sub.querySelector('.cutoff-tag')?.remove();if(d.meta.listing_cutoff){const tag=document.createElement('span');tag.className='cutoff-tag';tag.textContent=` Cases filed on/after ${d.meta.listing_cutoff} only.`;sub.append(tag);}}
  const source=d.meta.monthly_rate_denominators.arrival_rate;
  text('arrivalRateCaption',`Monthly filings ÷ court working days in that month. Source: ${source.sheet?'working-day Excel workbook':'CSV activity calendar'}.`);
  await Promise.allSettled(Object.keys(metadata.components).map(load));
 }catch(e){if(rev===revision){$('filterError').textContent=e.message;$('filterError').hidden=false;for(const key of Object.keys(metadata.components)){panel(key)?.classList.remove('component-loading');panel(key)?.classList.add('component-failed');status(key,e.message,true);}}}
}

async function switchDistrict(){
 const rev=++revision;
 for(const id of ['courtFilter','startMonth','endMonth'])$(id).disabled=true;
 validSelection=false;requests.forEach(c=>c.abort());$('exportBtn').disabled=true;
 for(const key of Object.keys(metadata.components)){destroy(key);panel(key)?.classList.add('component-loading');status(key,'Loading district…');}
 try{
  const next=await get('/api/v1/metadata?district='+encodeURIComponent($('districtFilter').value));
  if(rev!==revision)return;
  metadata=next;showSourceWarning();applyDistrictTheme();
  $('courtFilter').replaceChildren(...metadata.courts.map(c=>new Option(c.label,c.id)));
  for(const id of ['startMonth','endMonth']){$(id).min=metadata.start;$(id).max=metadata.end;}
  $('startMonth').value=metadata.start;$('endMonth').value=metadata.end;
  for(const id of ['courtFilter','startMonth','endMonth'])$(id).disabled=false;
  await refresh();
 }catch(e){if(rev===revision){$('filterError').hidden=false;$('filterError').textContent=e.message;for(const key of Object.keys(metadata.components)){panel(key)?.classList.remove('component-loading');panel(key)?.classList.add('component-failed');status(key,e.message,true);}}}
}

function bind(){
 $('districtFilter').addEventListener('change',switchDistrict);
 for(const id of ['courtFilter','startMonth','endMonth'])$(id).addEventListener('change',refresh);
 for(const [group,[container]] of Object.entries(groups))$(container).addEventListener('change',()=>{selections[group]=Array.from($(container).querySelectorAll('input:checked'),i=>i.value);selectionStatus(group);reloadGroup(group);});
 $('trendSmoothing').addEventListener('change',()=>{const smooth=$('trendSmoothing').value==='ma12';text('trendCaption',smooth?'Trailing 12-month average. Requires 12 consecutive selected months; incomplete windows remain blank.':'Actual monthly filings. Hover to compare case types; click a legend to hide a trace.');reloadGroup('filing');});
 $('complexityReset').addEventListener('click',()=>{selections.complexity=[];load('complexity');});
 $('registerSideFilter').addEventListener('change',()=>{page=0;load('register');});
 $('registerSearch').addEventListener('input',()=>{page=0;load('register');});
 $('registerPrev').addEventListener('click',()=>{page=Math.max(0,page-1);load('register');});
 $('registerNext').addEventListener('click',()=>{page++;load('register');});
 document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab-btn,.tab-pane').forEach(e=>e.classList.remove('active'));btn.classList.add('active');$(btn.dataset.tab).classList.add('active');Object.values(charts).forEach(c=>c.resize());pairs.onTab(btn.dataset.tab);}));
 $('exportBtn').addEventListener('click',()=>window.location.assign('/api/v1/exports/court?'+params('court')));
 compare.bind();compare.onDrill(pairs.drillInto);setupChartControls(metadata.components,key=>'/api/v1/exports/'+key+'?'+params(key));setupChartZoomModal();
}
async function main(){
 try{
  metadata=await get('/api/v1/metadata');showSourceWarning();
  $('districtFilter').replaceChildren(...metadata.districts.map(d=>new Option(d,d,d===metadata.district,d===metadata.district)));
  applyDistrictTheme();
  $('courtFilter').replaceChildren(...metadata.courts.map(c=>new Option(c.label,c.id)));
  for(const id of ['startMonth','endMonth']){$(id).min=metadata.start;$(id).max=metadata.end;}
  $('startMonth').value=metadata.start;$('endMonth').value=metadata.end;
  // Every component container is declarative; absent registry entries are hidden.
  document.querySelectorAll('[data-component]').forEach(el=>{if(!metadata.components[el.dataset.component])el.hidden=true;});
  bind();$('loadingScreen').style.display='none';$('mainDashboard').style.display='block';await pairs.init({districts:metadata.districts,current:()=>({district:$('districtFilter').value,court:$('courtFilter').value,start:$('startMonth').value,end:$('endMonth').value})});await refresh();
 }catch(e){text('progressText',e.message);$('progressFill').style.width='100%';}
}
main();
