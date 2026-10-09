export const charts = {};
export const PALETTE = ['#2563eb','#8b4a6b','#b45309','#2f6f6d','#9a3412','#6d4c8d','#0f766e','#7c3f1d'];
export const CHART_TEXT='#5b4636', CHART_MUTED='#6b6258', CHART_GRID='rgba(112,88,65,0.15)', CHART_PANEL='#f7f2e9';
export const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt=v=>v==null?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
export function destroy(key){if(charts[key]){charts[key].destroy();delete charts[key];}}
export function text(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
export function observations(id,rows){document.getElementById(id).innerHTML=rows.length?rows.map(r=>`<li><strong>${esc(r.title)}</strong>${esc(r.text)}</li>`).join(''):'<li>No eligible observations in this selection.</li>';}
export function line(key,canvasId,data){
 destroy(key);charts[key]=new Chart(document.getElementById(canvasId),{type:'line',data:{labels:data.labels,datasets:data.series.map((s,i)=>({label:s.label,data:s.values,borderColor:PALETTE[i],backgroundColor:PALETTE[i],fill:false,tension:0,spanGaps:false,pointRadius:0,borderWidth:2}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{boxWidth:12}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)}}},scales:{x:{ticks:{maxTicksLimit:6}},y:{beginAtZero:true,title:{display:true,text:data.units}}}}});
}
export function duration(key,canvasId,data,colors){destroy(key);charts[key]=new Chart(document.getElementById(canvasId),{type:'bar',data:{labels:data.rows.map(r=>r.case_type),datasets:[{label:'Median',data:data.rows.map(r=>r.median),backgroundColor:colors[0],borderRadius:4},{label:'90th percentile',data:data.rows.map(r=>r.p90),backgroundColor:colors[1],borderRadius:4}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:CHART_TEXT}}},scales:{x:{ticks:{color:CHART_TEXT,maxRotation:30,minRotation:30},grid:{display:false}},y:{ticks:{color:CHART_MUTED},grid:{color:CHART_GRID},title:{display:true,text:'working days',color:CHART_MUTED}}}}});}
export function renderHearingPercentiles(chartKey, canvasId, rows, unit, axisTitle) {
    const series = [
        { key: 'median', label: 'Median (50th)', color: '#2563eb' },
        { key: 'p75', label: '75th percentile', color: '#2f6f6d' },
        { key: 'p90', label: '90th percentile', color: '#b45309' },
    ];
    const percentileMarkers = {
        id: 'hearingPercentileMarkers',
        afterDatasetsDraw(chart) {
            const { ctx, scales } = chart;
            const bars = chart.getDatasetMeta(0).data;
            ctx.save();
            rows.forEach((row, index) => {
                const bar = bars[index];
                if (!bar) return;
                series.slice(0, 2).forEach(({ key, color }, markerIndex) => {
                    if (!Number.isFinite(row[key])) return;
                    const x = scales.x.getPixelForValue(row[key]);
                    // Different marker heights keep coincident percentiles visible.
                    const halfHeight = bar.height / 2 + (markerIndex === 0 ? 5 : 1);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = markerIndex === 0 ? 3 : 5;
                    ctx.beginPath();
                    ctx.moveTo(x, bar.y - halfHeight);
                    ctx.lineTo(x, bar.y + halfHeight);
                    ctx.stroke();
                });
            });
            ctx.restore();
        },
    };
    destroy(chartKey);
    charts[chartKey] = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.case_type),
            datasets: [{
                label: '90th percentile',
                data: rows.map(r => Number.isFinite(r.p90) ? r.p90 : null),
                backgroundColor: 'rgba(180,83,9,0.35)',
                borderColor: '#b45309',
                borderWidth: 1,
                borderRadius: 3,
                barPercentage: 0.55,
                maxBarThickness: 18,
                percentileRows: rows,
                percentileUnit: unit,
            }],
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', axis: 'y', intersect: false },
            plugins: {
                legend: {
                    display: true, position: 'bottom', onClick: () => {},
                    labels: {
                        boxWidth: 12, font: { size: 11 },
                        generateLabels: () => series.map(({ label, color }) => ({
                            text: label, fillStyle: color, strokeStyle: color, hidden: false,
                        })),
                    },
                },
                tooltip: { callbacks: {
                    label: context => series.map(({ key, label }) => {
                        const value = rows[context.dataIndex][key];
                        return `${label}: ${Number.isFinite(value) ? value + ' ' + unit : 'unavailable'}`;
                    }),
                } },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    suggestedMax: Math.max(1, ...rows.flatMap(row => series.map(({ key }) =>
                        Number.isFinite(row[key]) ? row[key] : 0))),
                    title: { display: true, text: axisTitle },
                    ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID },
                },
                y: { ticks: { color: CHART_TEXT, autoSkip: false }, grid: { display: false } },
            },
        },
        plugins: [percentileMarkers],
    });
}

