import {charts,destroy,esc,fmt} from './visuals.js';

const COLORS=['#2563eb','#b45309','#7c3aed'];
const QUADRANTS=[
 {id:'q2',side:'b',flow:true,title:'II · Monthly filings and disposals'},
 {id:'q1',side:'a',flow:true,title:'I · Monthly filings and disposals'},
 {id:'q3',side:'b',flow:false,title:'III · Cumulative case-load change (from 0)'},
 {id:'q4',side:'a',flow:false,title:'IV · Cumulative case-load change (from 0)'},
];
function destroyQuadrants(){QUADRANTS.forEach(q=>destroy('filing-flow:'+q.id));}

export function renderFilingQuadrants(host,data){
 destroyQuadrants();
 const flows=[data.a,data.b].flatMap(s=>s.series.flatMap(r=>[...r.filings,...r.disposals])).filter(Number.isFinite);
 const cumulative=[data.a,data.b].flatMap(s=>s.series.flatMap(r=>r.cumulative_load)).filter(Number.isFinite);
 const flowMax=Math.max(1,...flows)*1.1;
 const loadMax=Math.max(1,...cumulative)*1.1,loadMin=Math.min(0,...cumulative)*1.1;
 host.innerHTML=QUADRANTS.map(q=>`<section class="filing-quadrant">
  <h5>${esc(q.title)}</h5><p class="chart-subtitle">${esc(data[q.side].label)}</p>
  <div class="filing-quadrant-canvas"><canvas id="filing-flow-${q.id}" role="img" aria-label="${esc(q.title+' — '+data[q.side].label)}"></canvas></div>
 </section>`).join('');
 for(const q of QUADRANTS){
  const side=data[q.side];
  const datasets=side.series.flatMap((row,i)=>{
   const common={borderColor:COLORS[i],backgroundColor:COLORS[i],borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0,spanGaps:false,fill:false};
   return q.flow?[
    {...common,label:row.case_type+' · Filings',data:[null,...row.filings]},
    {...common,label:row.case_type+' · Disposals',data:[null,...row.disposals],borderDash:[7,4]},
   ]:[{...common,label:row.case_type+' · Cumulative change',data:[row.baseline,...row.cumulative_load]}];
  });
  const canvas=document.getElementById('filing-flow-'+q.id);
  if(!datasets.some(ds=>ds.data.some(Number.isFinite))){
   canvas.parentElement.innerHTML='<p class="component-status">No data for these types in the selected months at this court.</p>';
   continue;
  }
  charts['filing-flow:'+q.id]=new Chart(canvas,{
   type:'line',data:{labels:['Start (0)',...data.labels],datasets},
   options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y)} cases`}}},
    scales:{
     x:{title:{display:true,text:'Calendar month'},ticks:{maxTicksLimit:6,maxRotation:35}},
     y:{min:q.flow?0:loadMin,max:q.flow?flowMax:loadMax,
      title:{display:true,text:q.flow?'Cases / month':'Cumulative change in cases'},ticks:{precision:0},
      grid:{color:context=>context.tick.value===0?'#5b4636':'rgba(112,88,65,0.15)',lineWidth:context=>context.tick.value===0?2:1}},
    }},
  });
 }
}

export function mountFilingComparison(host){
 let controller=null,request=null,selected=[];
 function clear(){
  controller?.abort();controller=null;destroyQuadrants();host.replaceChildren();
 }
 async function load(nextRequest,names=[]){
  clear();request={...nextRequest};
  const pending=controller=new AbortController();
  host.innerHTML='<p class="component-status" role="status">Loading monthly filings, disposals and case load…</p>';
  try{
   const query=new URLSearchParams(request);
   names.forEach(name=>query.append('type',name));
   const response=await fetch('/api/v1/compare/filing-flow?'+query,{signal:pending.signal});
   const data=await response.json();
   if(controller!==pending)return;
   if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Unable to load monthly comparison.');
   selected=data.selected;
   host.innerHTML=`<h4 class="pair-title">Monthly filings, disposals &amp; cumulative case load</h4>
    <p class="chart-subtitle">Current district on the right (I, IV); comparison district on the left (II, III). Both columns use the same months and scales.</p>
    <fieldset class="trend-case-fieldset"><legend>Case types · select up to 3</legend><div class="trend-case-options filing-flow-types"></div></fieldset>
    <p class="chart-subtitle" role="status">${selected.length} of 3 selected. Defaults favour shared types, ranked by combined filing and disposal volume.</p>
    <div class="filing-flow-legend"></div>
    <p class="chart-subtitle">Solid lines: filings · Dashed lines: disposals · Lower panels: cumulative sum(filings − disposals), starting at 0. This shows backlog change, not the actual pending total.</p>
    <div class="filing-quadrants"></div>
    <details class="formula-note"><summary>How this is calculated</summary><ul class="compare-notes">${data.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></details>`;
   const choices=host.querySelector('.filing-flow-types');
   for(const option of data.case_type_options){
    const label=document.createElement('label'),input=document.createElement('input');
    input.type='checkbox';input.value=option.case_type;input.checked=selected.includes(option.case_type);
    input.disabled=(!input.checked&&selected.length>=3)||(input.checked&&selected.length===1);
    label.append(input,document.createTextNode(option.case_type+(option.in_both?'':' (one court only)')));
    choices.append(label);
   }
   choices.addEventListener('change',()=>{
    const names=Array.from(choices.querySelectorAll('input:checked'),input=>input.value);
    if(names.length>=1&&names.length<=3)load(request,names);
   });
   host.querySelector('.filing-flow-legend').innerHTML=selected.map((name,i)=>`<span><i style="background:${COLORS[i]}"></i>${esc(name)}</span>`).join('');
   if(!selected.length){host.querySelector('.filing-quadrants').innerHTML='<p class="component-status">No Civil or Criminal filing/disposal events in this selection.</p>';return;}
   renderFilingQuadrants(host.querySelector('.filing-quadrants'),data);
  }catch(error){
   if(error.name!=='AbortError'&&controller===pending){
    host.innerHTML=`<p class="component-status error" role="status">${esc(error.message)}</p><button type="button" class="chart-tool-btn">Retry monthly comparison</button>`;
    host.querySelector('button').addEventListener('click',()=>load(request,names));
   }
  }
 }
 return {load,clear};
}
