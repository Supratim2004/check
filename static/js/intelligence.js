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
   from `charts` at click time, so this works across re-renders.
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
];

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
        canvas.parentElement.insertBefore(toolbar, canvas);
    });
}

function exportChartPDF(key, title) {
    const chart = charts[key];
    if (!chart || !window.jspdf) {
        alert('This chart is not ready yet. Please wait for it to finish loading and try again.');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    const image = chart.toBase64Image('image/png', 1);
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
    const labels = chart.data.labels || [];
    const datasets = chart.data.datasets || [];
    const header = ['Case Type / Month', ...datasets.map((ds, i) => ds.label || `Series ${i + 1}`)];
    const rows = labels.map((label, i) => [label, ...datasets.map(ds => ds.data[i] ?? '')]);

    const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Chart Data');
    XLSX.writeFile(workbook, `${sanitizeFilename(title)}.xlsx`);
}

let zoomScale = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function applyZoomScale() {
    const img = document.getElementById('chartZoomImage');
    if (img) img.style.transform = `scale(${zoomScale})`;
}

function openChartZoom(key, title) {
    const chart = charts[key];
    if (!chart) return;
    const modal = document.getElementById('chartZoomModal');
    const img = document.getElementById('chartZoomImage');
    img.src = chart.toBase64Image('image/png', 1);
    zoomScale = 1;
    applyZoomScale();
    document.getElementById('chartZoomTitle').textContent = title;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeChartZoom() {
    const modal = document.getElementById('chartZoomModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
}

function setupChartZoomModal() {
    const modal = document.getElementById('chartZoomModal');
    if (!modal) return;

    document.getElementById('chartZoomIn').addEventListener('click', () => {
        zoomScale = Math.min(ZOOM_MAX, zoomScale + ZOOM_STEP);
        applyZoomScale();
    });
    document.getElementById('chartZoomOut').addEventListener('click', () => {
        zoomScale = Math.max(ZOOM_MIN, zoomScale - ZOOM_STEP);
        applyZoomScale();
    });
    document.getElementById('chartZoomReset').addEventListener('click', () => {
        zoomScale = 1;
        applyZoomScale();
    });
    document.getElementById('chartZoomClose').addEventListener('click', closeChartZoom);

    // Click outside the panel closes the modal.
    modal.addEventListener('click', e => {
        if (e.target === modal) closeChartZoom();
    });

    // Scroll to zoom while hovering the image.
    document.getElementById('chartZoomImageWrap').addEventListener('wheel', e => {
        if (!modal.classList.contains('open')) return;
        e.preventDefault();
        zoomScale = e.deltaY < 0
            ? Math.min(ZOOM_MAX, zoomScale + ZOOM_STEP)
            : Math.max(ZOOM_MIN, zoomScale - ZOOM_STEP);
        applyZoomScale();
    }, { passive: false });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeChartZoom();
    });
}
