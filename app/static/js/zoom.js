import {charts} from './visuals.js';
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
    if (chart.config.data.datasets[0]?.percentileRows) {
        config.plugins = chart.config.plugins;
        config.options.plugins = {
            ...config.options.plugins,
            legend: chart.config.options.plugins.legend,
            tooltip: chart.config.options.plugins.tooltip,
        };
    }
    if (chart.config.type === 'bubble') {
        config.plugins = chart.config.plugins;
        config.options.plugins = config.options.plugins || {};
        config.options.plugins.legend = { display: false };
        config.options.plugins.tooltip = {
            filter: item => item.dataset.type !== 'line',
            callbacks: chart.config.options.plugins.tooltip.callbacks,
        };
    }
    return config;
}

export function openChartZoom(key, title) {
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

export function setupChartZoomModal() {
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

