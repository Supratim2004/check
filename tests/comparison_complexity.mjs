// Renderer isolation and async comparison lifecycle; no browser automation.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const fixture = {
 points: [{code:'B1',label:'Other court type',x:4,y:2,r:12,throughput:1,disposalMean:40,backgroundColor:'blue'}],
 guides: [{months:2,points:[{x:0,y:0},{x:5,y:2.5}]}],
 max_x:5,max_y:3,color_labels:[20,30,40],bubbles:[{radius:12,value:1}],
 observations:[{title:'Example',text:'Other court only'}],meta:{listing_cutoff:'2017-01-01',data_quality_warnings:['Source caveat']},
};
const nodes=new Map();
const node=id=>{
 if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';},insertAdjacentHTML(_,html){this.innerHTML+=html;}});
 return nodes.get(id);
};
const renderer={document:{getElementById:node},console};
renderer.Chart=function(canvas,config){this.canvas=canvas;this.config=config;this.destroyed=false;this.destroy=()=>{this.destroyed=true;};};
vm.createContext(renderer);
vm.runInContext(fs.readFileSync('app/static/js/visuals.js','utf8').replaceAll('export ',''),renderer);
vm.runInContext(fs.readFileSync('app/static/js/components/complexity.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ',''),renderer);
renderer.fixture=fixture;
vm.runInContext('render(fixture);',renderer);
const original=vm.runInContext('charts.complexity',renderer);
const originalLegend=node('complexityColorLabels').innerHTML;
vm.runInContext("render(fixture,{prefix:'comparisonComplexity',key:'pair:tab-complexity:bubble:b'});",renderer);
const bubble=vm.runInContext("charts['pair:tab-complexity:bubble:b']",renderer);
assert.equal(original.destroyed,false);
assert.equal(bubble.canvas.id,'comparisonComplexityChart');
assert.equal(bubble.config.type,'bubble');
assert.equal(bubble.config.data.datasets[0].data,fixture.points);
assert.equal(bubble.config.data.datasets[1].type,'line');
assert.equal(bubble.config.options.scales.x.max,fixture.max_x);
assert.equal(node('complexityColorLabels').innerHTML,originalLegend);
assert.ok(node('comparisonComplexityBubbleLegend').innerHTML.includes('width:24px'));
vm.runInContext("destroy('pair:tab-complexity:bubble:b');",renderer);
assert.equal(bubble.destroyed,true);
assert.equal(original.destroyed,false);

const requests=[],renders=[],charts={};
const meta={start:'2015-01',end:'2026-06',courts:[{id:'DJ',name:'District Judge'}]};
let fetchImpl=async url=>({ok:true,json:async()=>url.includes('/metadata?')?meta:fixture});
const sandbox={console,URLSearchParams,AbortController,charts,
 document:{getElementById:node},
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),fmt:String,text(){},
 destroy:key=>{charts[key]?.destroy();delete charts[key];},
 fetch:async(url,options)=>{requests.push({url,options});return fetchImpl(url,options);},
 renderComplexity:(data,options)=>{renders.push({data,options});charts[options.key]={destroy(){}};},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app/static/js/pairs.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ',''),sandbox);
const p={bubbleHost:node('bubble-host'),host:node('bars'),holder:{}};
p.host.innerHTML='Existing comparison plots';
const other={district:'Other district',court:'DJ'},range={start:'2010-01',end:'2026-06'};
await sandbox.drawComparisonComplexity(p,other,range);
assert.equal(renders.length,1);
const query=new URL(requests[1].url,'http://example.test').searchParams;
assert.equal(query.get('district'),'Other district');
assert.equal(query.get('court'),'DJ');
assert.equal(query.get('start'),'2015-01');
assert.equal(query.has('types'),false,'Never reuse the primary court’s local type codes');
assert.match(p.bubbleHost.innerHTML,/District Judge/);
assert.match(p.bubbleHost.innerHTML,/Source caveat/);
assert.match(p.bubbleHost.innerHTML,/2017-01-01/);
assert.match(p.bubbleHost.innerHTML,/Date range limited/);
assert.equal(p.host.innerHTML,'Existing comparison plots');
const previous=p.bubbleController;
sandbox.clearComplexity(p);
assert.equal(previous.signal.aborted,true);
assert.equal(p.bubbleHost.innerHTML,'');
assert.equal(Object.keys(charts).length,0);

// A late response cannot resurrect a chart after Show comparison is turned off.
let release;
fetchImpl=()=>new Promise(resolve=>{release=resolve;});
const pending=sandbox.drawComparisonComplexity(p,other,range);
sandbox.clearComplexity(p);
release({ok:true,json:async()=>meta});
await pending;
assert.equal(renders.length,1);
assert.equal(p.bubbleHost.innerHTML,'');

// Empty and failed bubble data do not remove the pre-existing bar comparisons.
fetchImpl=async url=>({ok:true,json:async()=>url.includes('/metadata?')?meta:{...fixture,points:[]}});
await sandbox.drawComparisonComplexity(p,other,range);
assert.match(p.bubbleHost.innerHTML,/Not enough eligible/);
assert.equal(renders.length,1);
fetchImpl=async()=>{throw new Error('Network failure');};
await sandbox.drawComparisonComplexity(p,other,range);
assert.match(p.bubbleHost.innerHTML,/Network failure/);
assert.equal(p.host.innerHTML,'Existing comparison plots');

fetchImpl=async()=>({ok:true,json:async()=>meta});
await sandbox.drawComparisonComplexity(p,other,{start:'2010-01',end:'2011-01'});
assert.match(p.bubbleHost.innerHTML,/No data for the other court/);

// Target changes: an old result must not replace the newer court’s bubble chart.
let releaseOld;
fetchImpl=()=>new Promise(resolve=>{releaseOld=resolve;});
const old=sandbox.drawComparisonComplexity(p,other,range);
fetchImpl=async url=>({ok:true,json:async()=>url.includes('/metadata?')?meta:fixture});
await sandbox.drawComparisonComplexity(p,{district:'New district',court:'DJ'},range);
releaseOld({ok:true,json:async()=>meta});
await old;
assert.match(p.bubbleHost.innerHTML,/New district/);
assert.equal(renders.length,2);
console.log('PASS: independent bubble renderer, target/date selection, legends, empty/error states, cancellation and stale responses.');
