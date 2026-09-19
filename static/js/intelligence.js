// District Courts Docket Intelligence — frontend logic
const district = document.getElementById('districtFilter').value;
const API_BASE = '/api/districts/' + encodeURIComponent(district);
let selectionVersion = 0;
let selectedTrendTypes = [];
let selectedHearingRateTypes = [];

async function fetchJSON(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load court data');
    return data;
}

function esc(value) {
    return String(value ?? '—').replace(/[&<>"']/g, c =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function showError(error) {
    console.error(error);
    document.getElementById('mainDashboard').style.display = 'none';
    document.getElementById('loadingScreen').style.display = 'flex';
    updateProgress(100, error.message + '. Correct the source or reload to retry.');
}

let metaCache = null;
let currentCourt = null;
let currentCourtData = null;
let charts = {};
const REGISTER_PAGE_SIZE = 10;
let registerPage = 0;
let registerSide = 'all';

const PALETTE = ['#2563eb', '#8b4a6b', '#b45309', '#2f6f6d', '#9a3412', '#6d4c8d', '#0f766e', '#7c3f1d'];
const CHART_TEXT = '#5b4636';
const CHART_MUTED = '#6b6258';
const CHART_GRID = 'rgba(112, 88, 65, 0.15)';
const CHART_PANEL = '#f7f2e9';

Chart.defaults.color = CHART_TEXT;
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

document.addEventListener('DOMContentLoaded', async () => {
    await loadAllData();
    setupEventListeners();
    setupChartControls();
    setupChartZoomModal();
});

async function loadAllData() {
    try {
        updateProgress(15, 'Loading court metadata...');
        metaCache = await fetchJSON(`${API_BASE}/meta`);

        updateProgress(45, 'Fetching case registers...');
        const firstCourt = document.getElementById('courtFilter').value;

        updateProgress(70, 'Loading workbook statistics...');
        await selectCourt(firstCourt);

        updateProgress(100, 'Complete!');

        setTimeout(() => {
            document.getElementById('loadingScreen').style.display = 'none';
            document.getElementById('mainDashboard').style.display = 'block';
        }, 400);

    } catch (error) {
        showError(error);
    }
}

function updateProgress(percent, text) {
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = text ? `${text}` : `${percent}%`;
}

function setupEventListeners() {
    document.getElementById('trendSmoothing').addEventListener('change', renderTrendChart);
    document.getElementById('trendCaseTypes').addEventListener('change', e => {
        if (e.target.type !== 'checkbox') return;
        const checked = Array.from(document.querySelectorAll('#trendCaseTypes input:checked'));
        if (checked.length > 5 || checked.length === 0) {
            e.target.checked = !e.target.checked;
            return;
        }
        selectedTrendTypes = checked.map(input => input.value);
        updateTrendSelection();
        renderTrendChart();
        renderMeanFilingsChart(currentCourtData);
    });
    document.getElementById('hearingRateCaseTypes').addEventListener('change', e => {
        if (e.target.type !== 'checkbox') return;
        const checked = Array.from(document.querySelectorAll('#hearingRateCaseTypes input:checked'));
        if (checked.length > 5 || checked.length === 0) {
            e.target.checked = !e.target.checked;
            return;
        }
        selectedHearingRateTypes = checked.map(input => input.value);
        updateHearingRateSelection();
        renderHearingRateCharts(currentCourtData);
    });
    document.getElementById('registerSideFilter').addEventListener('change', e => {
        registerSide = e.target.value;
        registerPage = 0;
        renderRegisterTable();
    });
    document.getElementById('registerPrev').addEventListener('click', () => {
        if (registerPage > 0) {
            registerPage -= 1;
            renderRegisterTable();
        }
    });
    document.getElementById('registerNext').addEventListener('click', () => {
        const totalPages = Math.ceil(filteredRegisterRows().length / REGISTER_PAGE_SIZE);
        if (registerPage + 1 < totalPages) {
            registerPage += 1;
            renderRegisterTable();
        }
    });
    document.getElementById('districtFilter').addEventListener('change', e => {
        const url = new URL(window.location.href);
        url.searchParams.set('district', e.target.value);
        window.location.assign(url);
    });
    document.getElementById('courtFilter').addEventListener('change', (e) => {
        selectCourt(e.target.value).catch(showError);
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    document.getElementById('exportBtn').addEventListener('click', exportCurrentCourt);
}

function fmt(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('en-IN');
}

async function selectCourt(code) {
    const version = ++selectionVersion;
    document.getElementById('exportBtn').disabled = true;
    const path = `${API_BASE}/court/${encodeURIComponent(code)}`;
    let results;
    try {
        results = await Promise.all([
            fetchJSON(path), fetchJSON(path + '/trend'),
        ]);
    } catch (error) {
        if (version !== selectionVersion) return;
        throw error;
    }
    if (version !== selectionVersion) return;
    const [courtData, trendData] = results;
    currentCourt = code;
    currentCourtData = courtData;
    registerPage = 0;
    document.getElementById('exportBtn').disabled = false;

    document.getElementById('extractedOn').textContent = courtData.extracted_on || 'Not provided';
    renderStatCards(code, currentCourtData);
    renderDistributionChart(currentCourtData);
    renderHearingsChart(currentCourtData);
    renderTopPerformers(currentCourtData);
    populateTrendTypes(currentCourtData);
    renderTrendChart();
    renderMeanFilingsChart(currentCourtData);
    renderDisposalChart(currentCourtData);
    renderGapChart(currentCourtData);
    renderOutliers(currentCourtData);
    populateHearingRateTypes(currentCourtData);
    renderHearingRateCharts(currentCourtData);
    renderRegisterTable();
    renderComplexityChart(currentCourtData);

    document.getElementById('footnoteText').textContent =
        `Gap and hearing-count measures use this court's listing-reliable cut-off (${currentCourtData.listing_cutoff || 'not provided'}); ` +
        `arrivals and disposal use the full ${currentCourtData.window_start}\u2013${currentCourtData.window_end} window. ` +
        trendData.note;
}

function renderStatCards(code, courtData) {
    const totals = {total_filings: courtData.arrivals.reduce((sum, row) => sum + row.filings, 0), case_types_tracked: courtData.arrivals.length};
    const top = courtData.arrivals[0];
    const disposalByType = {};
    courtData.disposal.forEach(d => disposalByType[d.case_type] = d);
    const topDisposal = disposalByType[top.case_type];

    document.getElementById('totalFilings').textContent = fmt(totals.total_filings);
    document.getElementById('totalFilingsSub').textContent = `${totals.case_types_tracked} case types tracked`;

    document.getElementById('avgMonthly').textContent = top.mean;
    document.getElementById('avgMonthlySub').textContent = `${top.case_type} (mean/mo)`;

    document.getElementById('peakFilings').textContent = fmt(top.max);
    document.getElementById('peakCaseType').textContent = `${top.case_type}, single busiest month`;

    document.getElementById('medianDisposal').textContent = topDisposal ? fmt(topDisposal.median) : '—';
    document.getElementById('medianDisposalSub').textContent = topDisposal
        ? `working days \u2014 ${top.case_type}` : 'working days';
}

function destroy(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderDistributionChart(courtData) {
    const rows = courtData.arrivals.slice(0, 7);
    const remainder = courtData.arrivals.slice(7).reduce((sum, row) => sum + row.filings, 0);
    if (remainder) rows.push({case_type: 'Other case types', filings: remainder});
    destroy('dist');
    charts.dist = new Chart(document.getElementById('distributionChart'), {
        type: 'doughnut',
        data: {
            labels: rows.map(r => r.case_type),
            datasets: [{
                data: rows.map(r => r.filings),
                backgroundColor: PALETTE,
                borderColor: CHART_PANEL,
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_TEXT, boxWidth: 12 } } },
            cutout: '55%',
        }
    });
}

function renderHearingsChart(courtData) {
    const rows = courtData.hearings_per_case.slice(0, 6);
    destroy('hearings');
    charts.hearings = new Chart(document.getElementById('hearingsChart'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.case_type),
            datasets: [{
                label: 'Median hearings',
                data: rows.map(r => r.median),
                backgroundColor: 'rgba(96,165,250,0.7)',
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
                y: { ticks: { color: CHART_TEXT }, grid: { display: false } }
            }
        }
    });
}

function renderTopPerformers(courtData) {
    const rows = courtData.arrivals.slice(0, 5);
    const el = document.getElementById('topPerformers');
    el.innerHTML = rows.map((r, i) => `
        <div class="performer-item">
            <div class="performer-info">
                <div class="performer-rank">${i + 1}</div>
                <div>
                    <div class="performer-name">${esc(r.case_type)}</div>
                    <div class="performer-sub">${esc(r.side)}</div>
                </div>
            </div>
            <div class="performer-value">${fmt(r.filings)}</div>
        </div>
    `).join('');
}

function populateTrendTypes(courtData) {
    const available = courtData.arrivals.filter(row =>
        Object.prototype.hasOwnProperty.call(courtData.arrival_series, row.case_type));
    selectedTrendTypes = available.slice(0, 3).map(row => row.case_type);
    const container = document.getElementById('trendCaseTypes');
    container.replaceChildren(...available.map(row => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = row.case_type;
        input.checked = selectedTrendTypes.includes(row.case_type);
        label.append(input, document.createTextNode(row.case_type));
        return label;
    }));
    updateTrendSelection();
}

function updateTrendSelection() {
    document.querySelectorAll('#trendCaseTypes input').forEach(input => {
        input.disabled = (!input.checked && selectedTrendTypes.length >= 5) ||
            (input.checked && selectedTrendTypes.length === 1);
    });
    document.getElementById('trendSelectionStatus').textContent = selectedTrendTypes.length
        ? `${selectedTrendTypes.length} of 5 selected. Only case types with monthly records are listed.`
        : 'No monthly records are available for this court.';
}

function movingAverage12(labels, values) {
    return values.map((_, index) => {
        if (index < 11) return null;
        const window = values.slice(index - 11, index + 1);
        if (window.some(value => !Number.isFinite(value))) return null;
        const serial = month => {
            const [year, monthNumber] = month.split('-').map(Number);
            return year * 12 + monthNumber;
        };
        if (serial(labels[index]) - serial(labels[index - 11]) !== 11) return null;
        return window.reduce((sum, value) => sum + value, 0) / 12;
    });
}

function renderTrendChart() {
    if (!currentCourtData) return;
    const smooth = document.getElementById('trendSmoothing').value === 'ma12';
    document.getElementById('trendCaption').textContent = smooth
        ? 'Trailing 12-month average. Requires 12 consecutive months; incomplete windows remain blank.'
        : 'Actual monthly filings. Hover to compare case types; click a legend to hide a trace.';
    const hasRates = selectedTrendTypes.some(name =>
        currentCourtData.arrival_rate_series[name]?.some(Number.isFinite));
    document.getElementById('arrivalRateCaption').textContent = !hasRates
        ? 'Working-day data is unavailable for the selected case types.'
        : smooth
            ? '12-month mean of monthly filings per working day. Zero or missing working days leave gaps.'
            : 'Filings divided by working days in each month. Zero or missing working days leave gaps.';
    renderFilingSeries('trend', 'trendChart', currentCourtData.arrival_series,
        smooth ? 'Filings / month (12-month MA)' : 'Filings', smooth);
    renderFilingSeries('arrivalRate', 'arrivalRateChart', currentCourtData.arrival_rate_series,
        smooth ? 'Filings / working day (12-month MA)' : 'Filings / working day', smooth);
}

function renderFilingSeries(key, canvasId, series, unit, smooth) {
    const labels = currentCourtData.month_labels;
    destroy(key);
    charts[key] = new Chart(document.getElementById(canvasId), {
        type: 'line',
        data: {
            labels,
            datasets: selectedTrendTypes.slice(0, 5).map((name, index) => ({
                label: name,
                data: smooth ? movingAverage12(labels, series[name]) : series[name],
                borderColor: PALETTE[index],
                backgroundColor: PALETTE[index],
                fill: false, tension: 0, spanGaps: false, pointRadius: 0, borderWidth: 2,
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {mode: 'index', intersect: false},
            plugins: {
                legend: {position: 'bottom', labels: {boxWidth: 12}},
                tooltip: {callbacks: {label: context =>
                    context.dataset.label + ': ' + Number(context.parsed.y).toLocaleString('en-IN', {maximumFractionDigits: 3})}},
            },
            scales: {
                x: {ticks: {maxTicksLimit: 6}},
                y: {beginAtZero: true, title: {display: true, text: unit}},
            },
        },
    });
}

function renderMeanFilingsChart(courtData) {
    const rows = selectedTrendTypes.map(name => courtData.arrivals.find(row => row.case_type === name));
    destroy('meanFilings');
    charts.meanFilings = new Chart(document.getElementById('meanFilingsChart'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.case_type),
            datasets: [{
                label: 'Mean filings / month',
                data: rows.map(r => r.mean),
                backgroundColor: rows.map((_, index) => PALETTE[index]),
                borderRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_TEXT, maxRotation: 30, minRotation: 30 }, grid: { display: false } },
                y: { ticks: { color: CHART_MUTED }, grid: { color: CHART_GRID } }
            }
        }
    });
}

function renderDisposalChart(courtData) {
    const rows = courtData.disposal.slice(0, 6);
    destroy('disposal');
    charts.disposal = new Chart(document.getElementById('disposalChart'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.case_type),
            datasets: [
                { label: 'Median', data: rows.map(r => r.median), backgroundColor: 'rgba(96,165,250,0.75)', borderRadius: 4 },
                { label: '90th percentile', data: rows.map(r => r.p90), backgroundColor: 'rgba(244,114,182,0.6)', borderRadius: 4 },
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_TEXT } } },
            scales: {
                x: { ticks: { color: CHART_TEXT, maxRotation: 30, minRotation: 30 }, grid: { display: false } },
                y: { ticks: { color: CHART_MUTED }, grid: { color: CHART_GRID }, title: { display: true, text: 'working days', color: CHART_MUTED } }
            }
        }
    });
}

function renderGapChart(courtData) {
    const rows = courtData.gap.slice(0, 6);
    destroy('gap');
    charts.gap = new Chart(document.getElementById('gapChart'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.case_type),
            datasets: [
                { label: 'Median', data: rows.map(r => r.median), backgroundColor: 'rgba(74,222,128,0.7)', borderRadius: 4 },
                { label: '90th percentile', data: rows.map(r => r.p90), backgroundColor: 'rgba(251,191,36,0.7)', borderRadius: 4 },
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_TEXT } } },
            scales: {
                x: { ticks: { color: CHART_TEXT, maxRotation: 30, minRotation: 30 }, grid: { display: false } },
                y: { ticks: { color: CHART_MUTED }, grid: { color: CHART_GRID }, title: { display: true, text: 'working days', color: CHART_MUTED } }
            }
        }
    });
}

function renderOutliers(courtData) {
    const flagged = courtData.gap.filter(g => g.p90 !== null && g.p90 > 100);
    document.getElementById('outlierCount').textContent = `${flagged.length} case type(s) flagged \u2014 90th-pct listing gap over 100 working days`;
    const el = document.getElementById('outliersList');
    el.innerHTML = flagged.map(g => `
        <div class="anomaly-card">
            <div class="anomaly-date">${esc(g.case_type)}</div>
            <div class="anomaly-value">${g.p90} wd</div>
            <div class="anomaly-score">90th pct \u2014 median ${fmt(g.median)} wd</div>
        </div>
    `).join('') || `<p style="color:${CHART_MUTED};">No case types exceed the 100-working-day threshold at this court.</p>`;
}

function populateHearingRateTypes(courtData) {
    const available = (courtData.hearing_rate_monthly || []).filter(row =>
        Object.prototype.hasOwnProperty.call(courtData.hearing_rate_series || {}, row.case_type));
    selectedHearingRateTypes = available.slice(0, 3).map(row => row.case_type);
    const container = document.getElementById('hearingRateCaseTypes');
    container.replaceChildren(...available.map(row => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = row.case_type;
        input.checked = selectedHearingRateTypes.includes(row.case_type);
        label.append(input, document.createTextNode(row.case_type));
        return label;
    }));
    updateHearingRateSelection();
}

function updateHearingRateSelection() {
    document.querySelectorAll('#hearingRateCaseTypes input').forEach(input => {
        input.disabled = (!input.checked && selectedHearingRateTypes.length >= 5) ||
            (input.checked && selectedHearingRateTypes.length === 1);
    });
    document.getElementById('hearingRateSelectionStatus').textContent = selectedHearingRateTypes.length
        ? `${selectedHearingRateTypes.length} of 5 selected. Traces use the workbook's monthly hearing-rate panel.`
        : 'No hearing-rate series are available for this court.';
}

function renderHearingRateCharts(courtData) {
    renderHearingRateTrend(courtData);
    const selected = new Set(selectedHearingRateTypes);
    renderRateChart('monthlyHearingRate', 'monthlyHearingRateChart',
        (courtData.hearing_rate_monthly || []).filter(row => selected.has(row.case_type)),
        'Mean hearings / working day', 'Median hearings / working day', 'mean', 'median');
    renderRateChart('casewiseHearingRate', 'casewiseHearingRateChart',
        (courtData.hearing_rate_casewise || []).filter(row => selected.has(row.case_type)),
        'Mean hearings / elapsed working day', 'Median hearings / elapsed working day', 'wd_mean', 'wd_median');
}

function renderHearingRateTrend(courtData) {
    const labels = courtData.month_labels;
    destroy('monthlyHearingRateTrend');
    charts.monthlyHearingRateTrend = new Chart(document.getElementById('monthlyHearingRateTrendChart'), {
        type: 'line',
        data: {
            labels,
            datasets: selectedHearingRateTypes.slice(0, 5).map((name, index) => ({
                label: name,
                data: courtData.hearing_rate_series[name],
                borderColor: PALETTE[index], backgroundColor: PALETTE[index],
                fill: false, tension: 0, spanGaps: false, pointRadius: 0, borderWidth: 2,
            })),
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: {mode: 'index', intersect: false},
            plugins: {legend: {position: 'bottom', labels: {boxWidth: 12}}},
            scales: {
                x: {ticks: {maxTicksLimit: 6}},
                y: {beginAtZero: true, title: {display: true, text: 'Hearings / working day'}},
            },
        },
    });
}

function renderRateChart(key, canvasId, rows, meanLabel, medianLabel, meanKey, medianKey) {
    const displayRows = (rows || []).filter(row => Number.isFinite(row[meanKey]) || Number.isFinite(row[medianKey]));
    destroy(key);
    charts[key] = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels: displayRows.map(row => row.case_type),
            datasets: [
                { label: meanLabel, data: displayRows.map(row => row[meanKey]), backgroundColor: 'rgba(96,165,250,0.78)', borderRadius: 4 },
                { label: medianLabel, data: displayRows.map(row => row[medianKey]), backgroundColor: 'rgba(244,114,182,0.68)', borderRadius: 4 },
            ],
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_TEXT } } },
            scales: {
                x: { beginAtZero: true, ticks: { color: CHART_MUTED }, grid: { color: CHART_GRID } },
                y: { ticks: { color: CHART_TEXT }, grid: { display: false } },
            },
        },
    });
}

function renderRegisterTable() {
    if (!currentCourtData) return;
    document.getElementById('registerCourtName').textContent =
        metaCache.court_totals[currentCourt].full_name;

    const dispByType = {};
    currentCourtData.disposal.forEach(d => dispByType[d.case_type] = d);

    const rows = filteredRegisterRows();
    const pageCount = Math.max(1, Math.ceil(rows.length / REGISTER_PAGE_SIZE));
    registerPage = Math.min(registerPage, pageCount - 1);
    const start = registerPage * REGISTER_PAGE_SIZE;
    const visibleRows = rows.slice(start, start + REGISTER_PAGE_SIZE);

    document.getElementById('registerBody').innerHTML = visibleRows.map(a => {
        const d = dispByType[a.case_type];
        const sideClass = a.side === 'Civil' ? 'civil' : a.side === 'Criminal' ? 'criminal' : '';
        return `
            <tr>
                <td>${esc(a.case_type)}</td>
                <td><span class="side-pill ${sideClass}">${esc(a.side)}</span></td>
                <td>${fmt(a.filings)}</td>
                <td>${a.mean}</td>
                <td>${a.median}</td>
                <td>${d ? fmt(d.median) : '—'}</td>
                <td>${d ? fmt(d.p90) : '—'}</td>
            </tr>
        `;
    }).join('');
    document.getElementById('registerPageStatus').textContent = rows.length
        ? `${start + 1}–${Math.min(start + REGISTER_PAGE_SIZE, rows.length)} of ${rows.length}`
        : '0 cases';
    document.getElementById('registerPrev').disabled = registerPage === 0;
    document.getElementById('registerNext').disabled = registerPage >= pageCount - 1;
}

function filteredRegisterRows() {
    if (!currentCourtData) return [];
    return currentCourtData.arrivals.filter(row =>
        registerSide === 'all' || row.side.toLowerCase() === registerSide);
}

function exportCurrentCourt() {
    if (!currentCourtData) return;
    const blob = new Blob([JSON.stringify({district, court: currentCourt, ...currentCourtData}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${district.replace(/[^a-z0-9]/gi, '_')}_${currentCourt.replace(/[^a-z0-9]/gi, '_')}_docket_data.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ================================================================
   Per-chart "Download PDF" / "Download Excel" + click-to-zoom.
   Registered once at load; buttons look up the live chart instance
   from `charts` at click time, so this keeps working across re-renders.
   ================================================================ */

const CHART_REGISTRY = [
    { canvasId: 'distributionChart', key: 'dist', title: 'Filings by Case Type' },
    { canvasId: 'hearingsChart', key: 'hearings', title: 'Hearings per Disposed Case' },
    { canvasId: 'trendChart', key: 'trend', title: 'Monthly Filing Volume' },
    { canvasId: 'arrivalRateChart', key: 'arrivalRate', title: 'Monthly Arrival Rate' },
    { canvasId: 'meanFilingsChart', key: 'meanFilings', title: 'Mean Monthly Filings by Case Type' },
    { canvasId: 'disposalChart', key: 'disposal', title: 'Time to Disposal (Working Days)' },
    { canvasId: 'gapChart', key: 'gap', title: 'Filing-to-First-Listing Gap' },
    { canvasId: 'monthlyHearingRateTrendChart', key: 'monthlyHearingRateTrend', title: 'Monthly Hearing Rate - Time Series' },
    { canvasId: 'monthlyHearingRateChart', key: 'monthlyHearingRate', title: 'Monthly Rate Summary' },
    { canvasId: 'casewiseHearingRateChart', key: 'casewiseHearingRate', title: 'Case-wise Rate Summary' },
    { canvasId: 'complexityChart', key: 'complexity', title: 'Case Complexity, Service Rate, Throughput and Disposal Time' },
];

// Classes that mark a fixed-height chart wrapper. The toolbar must be
// inserted BEFORE that wrapper (as its own sibling), never inside it —
// inserting inside would eat into the wrapper's fixed height and squeeze
// the canvas, which is what changed the chart proportions before.
const FIXED_HEIGHT_WRAPPER_CLASSES = ['overview-chart', 'trend-plot', 'rate-plot'];

function sanitizeFilename(name) {
    return String(name).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'chart';
}

function setupChartControls() {
    CHART_REGISTRY.forEach(({ canvasId, key, title }) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.parentElement) return;

        canvas.classList.add('zoomable-chart');
        canvas.title = 'Click to zoom';
        canvas.addEventListener('click', () => openChartZoom(key, title));

        const toolbar = document.createElement('div');
        toolbar.className = 'chart-toolbar';

        const pdfBtn = document.createElement('button');
        pdfBtn.type = 'button';
        pdfBtn.className = 'chart-tool-btn';
        pdfBtn.textContent = 'Download PDF';
        pdfBtn.addEventListener('click', () => exportChartPDF(key, title));

        const xlsxBtn = document.createElement('button');
        xlsxBtn.type = 'button';
        xlsxBtn.className = 'chart-tool-btn';
        xlsxBtn.textContent = 'Download Excel';
        xlsxBtn.addEventListener('click', () => exportChartExcel(key, title));

        toolbar.append(pdfBtn, xlsxBtn);

        // Find the element to insert the toolbar in front of: the fixed-height
        // wrapper if there is one, otherwise the canvas itself.
        let anchor = canvas;
        const wrapper = canvas.parentElement;
        if (FIXED_HEIGHT_WRAPPER_CLASSES.some(cls => wrapper.classList.contains(cls))) {
            anchor = wrapper;
        }
        anchor.parentElement.insertBefore(toolbar, anchor);
    });
}

// Take a clean snapshot of a chart: clears any hover/tooltip state first so a
// tooltip bubble that happened to be showing never gets baked into the image.
function captureChartImage(chart) {
    chart.setActiveElements([]);
    if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
    return chart.toBase64Image('image/png', 1);
}

function exportChartPDF(key, title) {
    const chart = charts[key];
    if (!chart || !window.jspdf) {
        alert('This chart is not ready yet. Please wait for it to finish loading and try again.');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    const image = captureChartImage(chart);
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    doc.setFontSize(14);
    doc.text(title, margin, 15);

    const ratio = chart.canvas.height / chart.canvas.width;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = imgWidth * ratio;
    doc.addImage(image, 'PNG', margin, 22, imgWidth, imgHeight);
    doc.save(`${sanitizeFilename(title)}.pdf`);
}

function exportChartExcel(key, title) {
    const chart = charts[key];
    if (!chart || !window.XLSX) {
        alert('This chart is not ready yet. Please wait for it to finish loading and try again.');
        return;
    }
    let header, rows;
    if (chart.config.type === 'bubble') {
        // Bubble points carry their own case-type/throughput/disposal fields
        // (see buildComplexityPoints), rather than the label+series shape
        // every other chart on this page uses.
        const points = (chart.data.datasets.find(ds => ds.type !== 'line') || {}).data || [];
        header = ['Case Type', 'Side', 'Complexity (median hearings/case)',
            'Service rate (median hearings/case-month)', 'Throughput (hearings/working day)',
            'Median time to disposal (working days)'];
        rows = points.map(p => [p.label, p.side ?? '', p.x, p.y, p.throughput ?? '', p.disposalMedian ?? '']);
    } else {
        const labels = chart.data.labels || [];
        const datasets = chart.data.datasets || [];
        header = ['Case Type / Month', ...datasets.map((ds, i) => ds.label || `Series ${i + 1}`)];
        rows = labels.map((label, i) => [label, ...datasets.map(ds => ds.data[i] ?? '')]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Chart Data');
    XLSX.writeFile(workbook, `${sanitizeFilename(title)}.xlsx`);
}

/* ---- Zoom modal: a LIVE cloned chart (not a snapshot) ----
   Opening the modal builds a fresh Chart.js instance with the same type,
   data and options as the on-page chart, sized to fill the modal. Because
   it's a real canvas, hovering still shows per-point tooltips while zoomed
   or panned — nothing is "captured" at the moment you clicked. Pan/zoom is
   done with a CSS transform on that canvas; Chart.js reads the canvas's own
   on-screen size for hit-testing, so hover position stays accurate even
   while scaled and dragged. */

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.25;

let zoomState = { scale: 1, x: 0, y: 0 };
let dragState = null; // { pointerId, startClientX, startClientY, startX, startY }
let zoomChartInstance = null;

// Tracks every pointer currently down inside the zoom viewport, so we can
// tell a one-finger drag (pan) apart from a two-finger pinch (zoom) — both
// arrive as the same 'pointer' events on touch devices.
const activeZoomPointers = new Map();
let pinchState = null; // { startDistance, startScale }

function currentZoomCanvas() {
    return document.querySelector('#chartZoomImageWrap canvas');
}

function applyZoomTransform() {
    const canvas = currentZoomCanvas();
    if (!canvas) return;
    canvas.style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
}

function setZoomScale(nextScale) {
    zoomState.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale));
    if (zoomState.scale === ZOOM_MIN) { zoomState.x = 0; zoomState.y = 0; }
    applyZoomTransform();
}

// Deep-clone a chart's data/options as plain JSON. Our datasets only ever
// contain strings/numbers/arrays (colors as hex strings, plain numbers), so
// a JSON round-trip is a safe, complete deep clone with no shared references
// back to the original chart. Function-valued options (tooltip callbacks,
// custom plugins) don't survive JSON cloning, so the bubble chart's label
// plugin and tooltip formatter are re-attached afterwards by reference.
function cloneChartConfig(chart) {
    const config = {
        type: chart.config.type,
        data: JSON.parse(JSON.stringify(chart.config.data)),
        options: {
            ...JSON.parse(JSON.stringify(chart.config.options || {})),
            responsive: true,
            maintainAspectRatio: false,
        },
    };
    if (chart.config.type === 'bubble') {
        config.plugins = [bubbleCaseLabelPlugin];
        config.options.plugins = config.options.plugins || {};
        config.options.plugins.legend = { display: false };
        config.options.plugins.tooltip = {
            filter: item => item.dataset.type !== 'line',
            callbacks: { label: bubbleTooltipLabel },
        };
    }
    return config;
}

function openChartZoom(key, title) {
    const chart = charts[key];
    if (!chart) return;
    const modal = document.getElementById('chartZoomModal');
    const wrap = document.getElementById('chartZoomImageWrap');

    if (zoomChartInstance) { zoomChartInstance.destroy(); zoomChartInstance = null; }
    wrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    zoomChartInstance = new Chart(canvas, cloneChartConfig(chart));

    zoomState = { scale: 1, x: 0, y: 0 };
    dragState = null;
    activeZoomPointers.clear();
    pinchState = null;
    applyZoomTransform();

    document.getElementById('chartZoomTitle').textContent = title;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeChartZoom() {
    const modal = document.getElementById('chartZoomModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    dragState = null;
    activeZoomPointers.clear();
    pinchState = null;
    if (zoomChartInstance) { zoomChartInstance.destroy(); zoomChartInstance = null; }
    document.getElementById('chartZoomImageWrap').innerHTML = '';
}

function withSnap(fn) {
    // Briefly enables a CSS transition so button clicks feel smooth, then
    // removes it again so dragging afterwards stays immediate (no lag).
    const canvas = currentZoomCanvas();
    if (!canvas) { fn(); return; }
    canvas.classList.add('snap');
    fn();
    window.setTimeout(() => canvas.classList.remove('snap'), 160);
}

function setupChartZoomModal() {
    const modal = document.getElementById('chartZoomModal');
    if (!modal) return;
    const wrap = document.getElementById('chartZoomImageWrap');

    document.getElementById('chartZoomIn').addEventListener('click', () => withSnap(() => setZoomScale(zoomState.scale + ZOOM_STEP)));
    document.getElementById('chartZoomOut').addEventListener('click', () => withSnap(() => setZoomScale(zoomState.scale - ZOOM_STEP)));
    document.getElementById('chartZoomReset').addEventListener('click', () => withSnap(() => { zoomState.x = 0; zoomState.y = 0; setZoomScale(1); }));
    document.getElementById('chartZoomClose').addEventListener('click', closeChartZoom);

    // Click on the dark backdrop (not the panel) closes the modal.
    modal.addEventListener('click', e => {
        if (e.target === modal) closeChartZoom();
    });

    // Scroll/trackpad to zoom, anchored at the current center.
    wrap.addEventListener('wheel', e => {
        if (!modal.classList.contains('open')) return;
        e.preventDefault();
        setZoomScale(zoomState.scale + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }, { passive: false });

    // Click-and-drag panning (mouse or one finger) plus two-finger pinch to
    // zoom (touch). Delegated on the wrap so it keeps working even though
    // the canvas inside is replaced each time the modal opens. Pointer
    // capture keeps events routed here even if a finger slides outside the
    // canvas while down.
    wrap.addEventListener('pointerdown', e => {
        wrap.setPointerCapture(e.pointerId);
        activeZoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const canvas = currentZoomCanvas();

        if (activeZoomPointers.size === 2) {
            // A second finger landed: switch from panning to pinch-zooming.
            dragState = null;
            if (canvas) canvas.classList.remove('dragging');
            const [p1, p2] = Array.from(activeZoomPointers.values());
            pinchState = {
                startDistance: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
                startScale: zoomState.scale,
            };
            return;
        }

        if (activeZoomPointers.size === 1 && zoomState.scale > ZOOM_MIN) {
            if (!canvas) return;
            canvas.classList.add('dragging');
            dragState = {
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startX: zoomState.x,
                startY: zoomState.y,
            };
        }
    });

    wrap.addEventListener('pointermove', e => {
        if (!activeZoomPointers.has(e.pointerId)) return;
        activeZoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pinchState && activeZoomPointers.size === 2) {
            const [p1, p2] = Array.from(activeZoomPointers.values());
            const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            setZoomScale(pinchState.startScale * (distance / pinchState.startDistance));
            return;
        }

        if (!dragState || dragState.pointerId !== e.pointerId) return;
        zoomState.x = dragState.startX + (e.clientX - dragState.startClientX);
        zoomState.y = dragState.startY + (e.clientY - dragState.startClientY);
        applyZoomTransform();
    });

    const endZoomPointer = e => {
        if (!e) return;
        activeZoomPointers.delete(e.pointerId);

        if (activeZoomPointers.size < 2) pinchState = null;

        if (dragState && dragState.pointerId === e.pointerId) {
            const canvas = currentZoomCanvas();
            if (canvas) canvas.classList.remove('dragging');
            dragState = null;
        }

        // One finger lifted off a pinch, one remains: resume panning with it
        // instead of leaving the gesture stuck mid-pinch.
        if (activeZoomPointers.size === 1 && zoomState.scale > ZOOM_MIN) {
            const [remainingId, point] = Array.from(activeZoomPointers.entries())[0];
            const canvas = currentZoomCanvas();
            if (canvas) canvas.classList.add('dragging');
            dragState = {
                pointerId: remainingId,
                startClientX: point.x,
                startClientY: point.y,
                startX: zoomState.x,
                startY: zoomState.y,
            };
        }
    };
    wrap.addEventListener('pointerup', endZoomPointer);
    wrap.addEventListener('pointercancel', endZoomPointer);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeChartZoom();
    });
}

/* ================================================================
   Case Complexity tab: a bubble chart built from this court's own
   reported statistics (no server changes needed — every value below
   already comes back from /api/court/<code>):
     X = median hearings per disposed case          (Hearings_X)
     Y = median hearings per case-month              (Hearing_rate_casewise, Mo median)
     size (H) = median hearings per working day       (Hearing_rate_monthly)
     colour = median time to disposal, working days   (Disposal_workdays)
   Case types are plotted only when all four figures are available.
   ================================================================ */

const COMPLEXITY_COLOR_STOPS = [
    [0.00, [37, 99, 235]],   // blue   — shortest disposal time
    [0.25, [6, 182, 212]],   // cyan
    [0.50, [34, 197, 94]],   // green
    [0.75, [234, 179, 8]],   // amber
    [1.00, [220, 38, 38]],   // red    — longest disposal time
];

function colorForDisposal(value, min, max) {
    if (!Number.isFinite(value) || max <= min) return 'rgba(148, 163, 184, 0.85)';
    const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
    let lo = COMPLEXITY_COLOR_STOPS[0], hi = COMPLEXITY_COLOR_STOPS[COMPLEXITY_COLOR_STOPS.length - 1];
    for (let i = 0; i < COMPLEXITY_COLOR_STOPS.length - 1; i++) {
        if (t >= COMPLEXITY_COLOR_STOPS[i][0] && t <= COMPLEXITY_COLOR_STOPS[i + 1][0]) {
            lo = COMPLEXITY_COLOR_STOPS[i]; hi = COMPLEXITY_COLOR_STOPS[i + 1]; break;
        }
    }
    const span = hi[0] - lo[0] || 1;
    const localT = (t - lo[0]) / span;
    const rgb = lo[1].map((c, i) => Math.round(c + (hi[1][i] - c) * localT));
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`;
}

// Build one plottable point per case type present in all four source
// tables, with a pixel radius derived from throughput via a sqrt scale
// (so bubble AREA — not radius — is proportional to throughput).
function buildComplexityPoints(courtData) {
    const byType = (rows, xKey) => {
        const map = new Map();
        (rows || []).forEach(row => map.set(row.case_type, row));
        return map;
    };
    const hearingsX = byType(courtData.hearings_per_case);
    const caseRate = byType(courtData.hearing_rate_casewise);
    const monthlyRate = byType(courtData.hearing_rate_monthly);
    const disposal = byType(courtData.disposal);

    const raw = [];
    hearingsX.forEach((hx, caseType) => {
        const rate = caseRate.get(caseType);
        const monthly = monthlyRate.get(caseType);
        const disp = disposal.get(caseType);
        if (!rate || !monthly || !disp) return;

        const x = hx.median ?? hx.mean;
        const y = rate.mo_median ?? rate.mo_mean;
        const h = monthly.median ?? monthly.mean;
        const d = disp.median ?? disp.mean;
        if (![x, y, h, d].every(Number.isFinite)) return;

        raw.push({ caseType, side: hx.side, x, y, throughput: h, disposalMedian: d });
    });

    const hValues = raw.map(p => p.throughput);
    const hMin = Math.min(...hValues), hMax = Math.max(...hValues);
    const MIN_R = 7, MAX_R = 34;
    const radiusFor = h => {
        if (!Number.isFinite(h) || hMax <= hMin) return (MIN_R + MAX_R) / 2;
        const t = (h - hMin) / (hMax - hMin);
        return MIN_R + (MAX_R - MIN_R) * Math.sqrt(t);
    };

    const dValues = raw.map(p => p.disposalMedian);
    const dMin = Math.min(...dValues), dMax = Math.max(...dValues);

    return raw.map(p => ({
        x: p.x, y: p.y, r: radiusFor(p.throughput),
        label: p.caseType, side: p.side,
        throughput: p.throughput, disposalMedian: p.disposalMedian,
        backgroundColor: colorForDisposal(p.disposalMedian, dMin, dMax),
    })).sort((a, b) => b.r - a.r); // draw the largest bubbles first, small ones on top
}

// Pick ~4 "months to disposal" reference lines (Y = X / T) that are
// actually visible within the plotted data range, instead of hard-coding
// values that might sit far outside this court's real numbers.
function pickComplexityReferenceLines(maxX, maxY) {
    if (!(maxX > 0) || !(maxY > 0)) return [];
    const candidates = [0.5, 1, 1.5, 2, 3, 4, 6, 9, 12, 18, 24, 36, 48, 60, 84, 120];
    const visible = candidates.filter(t => {
        const yAtMaxX = maxX / t;
        return yAtMaxX > maxY * 0.04 && yAtMaxX < maxY * 1.3;
    });
    if (visible.length <= 4) return visible;
    const picks = [];
    const stepIdx = (visible.length - 1) / 3;
    for (let i = 0; i < 4; i++) picks.push(visible[Math.round(i * stepIdx)]);
    return [...new Set(picks)];
}

function formatMonthsLabel(t) {
    const rounded = t >= 10 ? Math.round(t) : Math.round(t * 10) / 10;
    return `${rounded} mo`;
}

// Draws each case-type name beside its bubble, and each guide line's
// "N mo" label near its far end — the same look as the reference example,
// without needing an extra datalabels plugin.
const bubbleCaseLabelPlugin = {
    id: 'bubbleCaseLabels',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((dataset, dsIndex) => {
            const meta = chart.getDatasetMeta(dsIndex);
            if (meta.hidden) return;
            ctx.save();
            ctx.font = dataset.type === 'line' ? '600 11px -apple-system, sans-serif' : '600 12px -apple-system, sans-serif';
            ctx.fillStyle = dataset.type === 'line' ? 'rgba(107, 79, 58, 0.75)' : CHART_TEXT;
            ctx.textBaseline = 'middle';
            if (dataset.type === 'line' && dataset.guideLabel) {
                const point = meta.data[meta.data.length - 1];
                if (point) {
                    ctx.textAlign = 'right';
                    ctx.fillText(dataset.guideLabel, point.x - 4, point.y - 8);
                }
            } else if (dataset.type !== 'line') {
                meta.data.forEach((point, index) => {
                    const raw = dataset.data[index];
                    if (!raw || !raw.label) return;
                    ctx.textAlign = 'left';
                    ctx.fillText(raw.label, point.x + (raw.r || 10) + 6, point.y);
                });
            }
            ctx.restore();
        });
    },
};

function bubbleTooltipLabel(context) {
    const raw = context.raw;
    if (!raw || !raw.label) return context.formattedValue;
    return [
        raw.label,
        `Complexity: ${raw.x} median hearings/case`,
        `Service rate: ${raw.y} median hearings/case-month`,
        `Throughput: ${raw.throughput} hearings/working day`,
        `Median disposal: ${raw.disposalMedian} working days`,
    ];
}

function renderComplexityChart(courtData) {
    const subtitle = document.getElementById('complexitySubtitle');
    const points = buildComplexityPoints(courtData);
    destroy('complexity');

    if (!points.length) {
        subtitle.textContent = 'Not enough matching hearings, rate and disposal data to plot this court yet.';
        document.getElementById('complexityTakeawaysList').innerHTML = '';
        document.getElementById('complexityColorLabels').innerHTML = '';
        document.getElementById('complexityBubbleLegend').innerHTML = '';
        return;
    }

    subtitle.textContent =
        'Each bubble is a case type at this court. Position shows median complexity and service rate. ' +
        'Bubble size shows throughput. Colour shows median time to disposal.';

    const maxX = Math.max(...points.map(p => p.x)) * 1.15 || 1;
    const maxY = Math.max(...points.map(p => p.y)) * 1.15 || 1;
    const referenceMonths = pickComplexityReferenceLines(maxX, maxY);

    const guideDatasets = referenceMonths.map(t => ({
        type: 'line',
        data: [{ x: 0, y: 0 }, { x: maxX, y: maxX / t }],
        borderColor: 'rgba(107, 79, 58, 0.45)',
        borderDash: [6, 4],
        borderWidth: 1.4,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
        order: 10,
        guideLabel: `\u2248 ${formatMonthsLabel(t)}`,
    }));

    charts.complexity = new Chart(document.getElementById('complexityChart'), {
        type: 'bubble',
        data: {
            datasets: [
                {
                    label: 'Case types',
                    data: points,
                    backgroundColor: points.map(p => p.backgroundColor),
                    borderColor: 'rgba(41, 37, 33, 0.35)',
                    borderWidth: 1,
                    order: 1,
                },
                ...guideDatasets,
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: true },
            plugins: {
                legend: { display: false },
                tooltip: {
                    filter: item => item.dataset.type !== 'line',
                    callbacks: { label: bubbleTooltipLabel },
                },
            },
            scales: {
                x: {
                    min: 0, max: maxX,
                    title: { display: true, text: 'Median hearings per disposed case (Complexity, X)' },
                    ticks: { color: CHART_MUTED }, grid: { color: CHART_GRID },
                },
                y: {
                    min: 0, max: maxY,
                    title: { display: true, text: 'Median hearings per case-month (Service rate, S)' },
                    ticks: { color: CHART_MUTED }, grid: { color: CHART_GRID },
                },
            },
        },
        plugins: [bubbleCaseLabelPlugin],
    });

    renderComplexityLegends(points);
    renderComplexityTakeaways(points);
}

function renderComplexityLegends(points) {
    const dValues = points.map(p => p.disposalMedian);
    const dMin = Math.min(...dValues), dMax = Math.max(...dValues);
    const colorLabels = document.getElementById('complexityColorLabels');
    colorLabels.innerHTML = [dMin, dMin + (dMax - dMin) * 0.5, dMax]
        .map(v => `<span>${fmt(Math.round(v))} wd</span>`).join('');

    const hValues = points.map(p => p.throughput);
    const hMin = Math.min(...hValues), hMax = Math.max(...hValues);
    const legend = document.getElementById('complexityBubbleLegend');
    const samples = [hMin, hMin + (hMax - hMin) / 3, hMin + (hMax - hMin) * 2 / 3, hMax];
    const MIN_R = 7, MAX_R = 34;
    legend.innerHTML = samples.map(h => {
        const t = hMax > hMin ? (h - hMin) / (hMax - hMin) : 0.5;
        const r = MIN_R + (MAX_R - MIN_R) * Math.sqrt(t);
        return `
            <div class="bubble-sample">
                <div class="bubble-sample-circle" style="width:${r * 2}px;height:${r * 2}px;"></div>
                <div class="bubble-sample-label">${h.toFixed(h < 10 ? 1 : 0)}</div>
            </div>
        `;
    }).join('');
}

function renderComplexityTakeaways(points) {
    const list = document.getElementById('complexityTakeawaysList');
    const byX = [...points].sort((a, b) => a.x - b.x);
    const simplest = byX[0];
    const mostComplex = byX[byX.length - 1];
    const busiestThroughput = [...points].sort((a, b) => b.throughput - a.throughput)[0];
    const slowestDisposal = [...points].sort((a, b) => b.disposalMedian - a.disposalMedian)[0];

    const bullets = [
        `${esc(simplest.label)} is the least complex case type here, needing a median of ` +
        `${simplest.x} hearing(s) per case, with a median disposal of ${fmt(simplest.disposalMedian)} working days.`,
        `${esc(mostComplex.label)} needs the most hearings per case (median ${mostComplex.x}), ` +
        (mostComplex.label === slowestDisposal.label
            ? `and also has the longest median disposal time at ${fmt(mostComplex.disposalMedian)} working days.`
            : `taking a median of ${fmt(mostComplex.disposalMedian)} working days to disposal.`),
        `${esc(busiestThroughput.label)} draws the largest share of daily hearing capacity, at ` +
        `${busiestThroughput.throughput.toFixed(busiestThroughput.throughput < 10 ? 2 : 0)} hearings scheduled per working day.`,
        `${esc(slowestDisposal.label)} has the longest median time to disposal at ` +
        `${fmt(slowestDisposal.disposalMedian)} working days.`,
        `The dashed guide lines mark reference disposal times (months \u2248 complexity \u00f7 service rate); ` +
        `a bubble above a line is clearing faster than that reference, one below is clearing slower.`,
    ];
    list.innerHTML = bullets.map(b => `<li>${b}</li>`).join('');
}
