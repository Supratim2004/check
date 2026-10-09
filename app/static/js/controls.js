import {charts} from './visuals.js';
import {openChartZoom} from './zoom.js';
export function setupChartControls(registry,exportURL){
 for(const [key,item] of Object.entries(registry)){
  const canvas=document.getElementById(item.canvas);if(!canvas)continue;
  const title=canvas.closest('.chart-card')?.querySelector('h3')?.textContent.trim()||key;
  canvas.classList.add('zoomable-chart');canvas.title='Click to zoom';canvas.addEventListener('click',()=>openChartZoom(key,title));
  const toolbar=document.createElement('div');toolbar.className='chart-toolbar';
  for(const [label,action] of [['Download PDF',()=>pdf(key,title)],['Download Excel',()=>{if(charts[key])window.location.assign(exportURL(key));}]]){
   const b=document.createElement('button');b.type='button';b.className='chart-tool-btn';b.textContent=label;b.addEventListener('click',action);toolbar.append(b);
  }
  let anchor=canvas;if(['overview-chart','trend-plot','rate-plot'].some(c=>canvas.parentElement.classList.contains(c)))anchor=canvas.parentElement;
  anchor.parentElement.insertBefore(toolbar,anchor);
 }
}
function pdf(key,title){
 const chart=charts[key];if(!chart||!window.jspdf)return;
 chart.setActiveElements([]);chart.tooltip?.setActiveElements([],{x:0,y:0});chart.update('none');
 const doc=new window.jspdf.jsPDF({orientation:'landscape'});doc.setFontSize(14);doc.text(title,14,15);
 const width=doc.internal.pageSize.getWidth()-28,height=doc.internal.pageSize.getHeight()-36;
 const ratio=chart.canvas.height/chart.canvas.width;const w=Math.min(width,height/ratio);
 doc.addImage(chart.toBase64Image('image/png',1),'PNG',14,22,w,w*ratio);
 doc.save(title.replace(/[^a-z0-9]+/gi,'_').toLowerCase()+'.pdf');
}
