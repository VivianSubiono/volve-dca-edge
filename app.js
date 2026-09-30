// Volve DCA Edge: vanilla ES module, tanpa build step.
// TODO: isi URL repositori GitHub (harus diawali https://).
const REPO_URL = 'TODO';
const LINKEDIN_PREFIX = 'https://www.linkedin.com/in/';
const NS = 'http://www.w3.org/2000/svg';
const EPS = 1e-6;

const $ = (q) => document.querySelector(q);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};
const s = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const getJSON = async (p) => {
  const r = await fetch(p, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
};
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
// WAPE bisa tersimpan sebagai pecahan (0.16) atau persen (16.2). Nilai <=3 dianggap pecahan.
const pct = (v) => (v <= 3 ? v * 100 : v);
const fill = (c) => `fill:var(--${c})`;
const loadScript = (src) => new Promise((ok, no) => {
  const t = h('script', { src }); t.onload = ok; t.onerror = () => no(new Error('gagal memuat ' + src)); document.head.append(t);
});

let metrics = null, samples = null, session = null, sessionPromise = null;
let featIdx = -1, current = null, baseFeatures = null, uploadState = null;

/* ---------- tautan repo ---------- */
const repoOk = /^https:\/\//.test(REPO_URL);
for (const id of ['#nav-gh', '#hero-gh', '#foot-gh']) {
  const a = $(id);
  if (repoOk) { a.href = REPO_URL; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.title = 'URL repositori belum diisi (REPO_URL di js/app.js)'; }
}

/* ---------- metrik & hasil ---------- */
function modelClass(name) {
  return /xgb|boost/i.test(name) ? 'xgb' : /arps/i.test(name) ? 'arps' : 'other';
}
function renderBadge() {
  const b = $('#src-badge');
  const src = String(metrics?.data_source ?? '');
  let text = 'DATA: TIDAK ADA', cls = 'warn';
  if (/volve/i.test(src)) { text = 'DATA: VOLVE'; cls = 'ok'; }
  else if (/sint|synth/i.test(src)) text = 'DATA: SINTETIS';
  else if (src) text = 'DATA: ' + src.toUpperCase().slice(0, 16);
  b.className = 'badge ' + cls;
  b.replaceChildren(text);
}
function renderMetrics() {
  renderBadge();
  const models = metrics.models || {};
  const rows = Object.entries(models);
  const best = Math.min(...rows.map(([, m]) => m.WAPE));
  const tb = $('#tbl tbody');
  for (const [name, m] of rows) {
    const tr = h('tr', m.WAPE === best ? { class: 'best' } : {}, h('td', {}, name), h('td', {}, num(m.MAE, 2)), h('td', {}, num(m.RMSE, 2)), h('td', {}, num(pct(m.WAPE), 2) + '%'));
    tb.append(tr);
  }
  const xgb = rows.find(([n]) => modelClass(n) === 'xgb');
  if (xgb) $('#k-wape').textContent = num(pct(xgb[1].WAPE), 1) + '%';
  const e = metrics.efficiency || {};
  $('#k-size').textContent = Number.isFinite(e.model_size_MB) ? `${num(e.model_size_MB, 3)} MB` : '-';
  const g = $('#green-list');
  g.append(
    h('li', {}, h('b', {}, Number.isFinite(e.model_size_MB) ? num(e.model_size_MB, 3) + ' MB' : '-'), 'ukuran model ONNX'),
    h('li', {}, h('b', {}, Number.isFinite(e.latency_ms_p50_native_ort) ? num(e.latency_ms_p50_native_ort, 2) + ' ms' : '-'), 'latency median, ORT native (bukan browser)'),
    h('li', {}, h('b', { id: 'g-browser' }, 'belum diukur'), 'latency median di browser (WASM)'),
    h('li', {}, h('b', {}, Number.isFinite(e.onnx_vs_xgb_max_abs_diff) ? e.onnx_vs_xgb_max_abs_diff.toExponential(1) : '-'), 'selisih maksimum ONNX vs XGBoost'),
    h('li', {}, h('b', {}, '0'), 'GPU dan server inferensi'));
  drawWells(metrics.wape_per_well);
}
function normalizeWells(w) {
  if (!w || typeof w !== 'object') return null;
  const ent = Object.entries(w);
  if (!ent.length || typeof ent[0][1] !== 'object') return null;
  const find = (keys, re) => keys.find((k) => re.test(k));
  const k0 = Object.keys(ent[0][1]);
  if (find(k0, /arps|xgb/i)) { // bentuk sumur -> model
    const ka = find(k0, /arps/i), kx = find(k0, /xgb|boost/i);
    return ent.map(([well, o]) => ({ well, arps: o[ka], xgb: o[kx] }));
  }
  const ka = find(Object.keys(w), /arps/i), kx = find(Object.keys(w), /xgb|boost/i); // model -> sumur
  if (!ka || !kx) return null;
  return Object.keys(w[ka]).map((well) => ({ well, arps: w[ka][well], xgb: w[kx][well] }));
}
function drawWells(raw) {
  const svg = $('#wells');
  const rows = normalizeWells(raw);
  if (!rows) { svg.replaceWith(h('p', { class: 'note' }, 'wape_per_well belum tersedia di metrics.json.')); return; }
  const vals = rows.flatMap((r) => [pct(r.arps), pct(r.xgb)]).filter(Number.isFinite);
  const max = Math.max(...vals), L = 92, bw = 220;
  svg.append(
    s('defs', {}), s('rect', { x: 0, y: 4, width: 12, height: 12, style: fill('ember') }), s('text', { x: 18, y: 15, style: fill('ink'), 'font-size': 12, 'font-family': 'IBM Plex Mono' }, 'Arps'),
    s('rect', { x: 88, y: 4, width: 12, height: 12, style: fill('teal') }), s('text', { x: 106, y: 15, style: fill('ink'), 'font-size': 12, 'font-family': 'IBM Plex Mono' }, 'XGBoost'));
  svg.firstChild.append(s('pattern', { id: 'hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }));
  const pat = svg.firstChild.firstChild;
  pat.append(s('rect', { width: 4, height: 4, style: fill('ember') }), s('rect', { width: 2, height: 2, style: fill('panel') }));
  svg.children[1].setAttribute('fill', 'url(#hatch)'); svg.children[1].removeAttribute('style');
  rows.forEach((r, i) => {
    const y = 32 + i * 43;
    svg.append(s('text', { x: L - 8, y: y + 17, 'text-anchor': 'end', style: fill('ink'), 'font-size': 11, 'font-family': 'IBM Plex Mono' }, r.well));
    [['arps', r.arps, 'url(#hatch)'], ['xgb', r.xgb, 'var(--teal)']].forEach(([k, v, f], j) => {
      const p = pct(v), w = Math.max(2, (p / max) * bw), yy = y + j * 16;
      svg.append(s('rect', { x: L, y: yy, width: w, height: 12, fill: f, 'shape-rendering': 'crispEdges' }),
        s('text', { x: L + w + 6, y: yy + 11, style: fill('muted'), 'font-size': 11, 'font-family': 'IBM Plex Mono' }, num(p, 1) + '%'));
    });
  });
  svg.setAttribute('viewBox', `0 0 400 ${32 + rows.length * 43}`);
}

/* ---------- runtime ONNX (lazy) ---------- */
function setStatus(msg, err = false, elId = '#status') { const e = $(elId); e.textContent = msg; e.className = 'status' + (err ? ' err' : ''); }
function ensureSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    setStatus('Memuat ONNX Runtime Web dan model...');
    if (!window.ort) await loadScript('vendor/ort/ort.min.js');
    ort.env.wasm.wasmPaths = new URL('vendor/ort/', location.href).href;
    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create('model.onnx', { executionProviders: ['wasm'] });
    setStatus('Model siap. Inferensi berjalan di perangkat Anda.');
    return session;
  })().catch((e) => {
    sessionPromise = null;
    setStatus(`Runtime WASM atau model gagal dimuat (${e.message}). Pastikan browser mendukung WebAssembly dan berkas /vendor/ort/ serta model.onnx tersedia.`, true);
    throw e;
  });
  return sessionPromise;
}
async function predict(features) {
  const t = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
  const out = await session.run({ input: t });
  const ratio = out.variable.data[0];              // keluaran model = rasio (30 hari ke depan / rata-rata 30 hari saat ini)
  return ratio * Math.expm1(features[featIdx]);    // laju = rasio x m30, karena log_m30 = log1p(m30)
}
async function bench(features) {
  for (let i = 0; i < 5; i++) await predict(features);
  const t = [];
  // performance.now() di sebagian browser dibulatkan ke ~1ms, jadi satu run pohon kecil
  // sering terbaca 0.00ms. Rata-ratakan 20 run per titik sampel supaya median berarti.
  for (let i = 0; i < 50; i++) {
    const a = performance.now();
    for (let j = 0; j < 20; j++) await predict(features);
    t.push((performance.now() - a) / 20);
  }
  t.sort((a, b) => a - b);
  return { p50: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)] };
}

/* ---------- grafik (dipakai demo sampel & unggahan) ---------- */
function drawChart(svg, smp, xgb) {
  svg.replaceChildren();
  const W = 640, H = 300, L = 48, R = 88, T = 16, B = 32, pw = W - L - R, ph = H - T - B;
  const hist = smp.history, fut = smp.future_actual || [], horizon = 30, n = hist.length + horizon;
  const vals = [...hist, ...fut];
  if (Number.isFinite(smp.arps_mean)) vals.push(smp.arps_mean);
  if (xgb != null) vals.push(xgb);
  const ymax = Math.max(1, ...vals) * 1.1;
  const X = (i) => L + (i * pw) / (n - 1), Y = (v) => T + ph - (v / ymax) * ph;
  const txt = (x, y, t, a = 'start', c = 'muted') => s('text', { x, y, 'text-anchor': a, style: fill(c), 'font-size': 11, 'font-family': 'IBM Plex Mono' }, t);
  for (let k = 0; k <= 4; k++) {
    const y = T + (ph * k) / 4;
    svg.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'var(--line)', 'stroke-dasharray': '3 4' }), txt(L - 6, y + 4, String(Math.round(ymax * (1 - k / 4))), 'end'));
  }
  const path = (arr, off) => 'M' + arr.map((v, i) => `${X(i + off).toFixed(1)} ${Y(v).toFixed(1)}`).join('L');
  const st = (c, w, d) => ({ fill: 'none', stroke: `var(--${c})`, 'stroke-width': w, 'shape-rendering': 'crispEdges', ...(d ? { 'stroke-dasharray': d } : {}) });
  const x0 = X(hist.length);
  svg.append(
    s('line', { x1: x0, x2: x0, y1: T, y2: T + ph, stroke: 'var(--muted)', 'stroke-dasharray': '2 3' }), txt(x0 - 4, T + 10, 'hari ke-0', 'end'),
    s('path', { d: path(hist, 0), ...st('ink', 2) }));
  if (fut.length) svg.append(s('path', { d: path(fut, hist.length), ...st('ink', 2, '2 4') }));
  if (Number.isFinite(smp.arps_mean)) svg.append(s('line', { x1: x0, x2: X(n - 1), y1: Y(smp.arps_mean), y2: Y(smp.arps_mean), ...st('ember', 3, '8 4') }));
  if (xgb != null) svg.append(s('line', { x1: x0, x2: X(n - 1), y1: Y(xgb), y2: Y(xgb), ...st('teal', 3) }));
  const labs = [];
  if (fut.length) labs.push(['Aktual', Y(fut[fut.length - 1]), 'ink']);
  if (Number.isFinite(smp.arps_mean)) labs.push(['Arps', Y(smp.arps_mean), 'ember']);
  if (xgb != null) labs.push(['XGBoost', Y(xgb), 'teal']);
  labs.sort((a, b) => a[1] - b[1]);
  labs.forEach((l, i) => { if (i && l[1] - labs[i - 1][1] < 14) l[1] = labs[i - 1][1] + 14; svg.append(txt(W - R + 8, l[1] + 4, l[0], 'start', l[2])); });
  svg.append(txt(L, H - 8, `-${hist.length} hari`), txt(W - R, H - 8, '+30 hari', 'end'));
}
function drawShap(smp) {
  const svg = $('#shap'); svg.replaceChildren();
  const top = [...smp.shap].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 8);
  const L = 140, x0 = L + 80, max = Math.max(...top.map((d) => Math.abs(d.v)), 1e-9);
  svg.append(s('line', { x1: x0, x2: x0, y1: 4, y2: 292, stroke: 'var(--muted)' }));
  top.forEach((d, i) => {
    const y = 12 + i * 34, w = Math.max(2, (Math.abs(d.v) / max) * 70), pos = d.v >= 0;
    svg.append(
      s('text', { x: L - 8, y: y + 14, 'text-anchor': 'end', style: fill('ink'), 'font-size': 11, 'font-family': 'IBM Plex Mono' }, d.f),
      s('rect', { x: pos ? x0 : x0 - w, y, width: w, height: 20, style: fill(pos ? 'teal' : 'ember'), 'shape-rendering': 'crispEdges' }),
      s('text', { x: pos ? x0 + w + 4 : x0 - w - 4, y: y + 14, 'text-anchor': pos ? 'start' : 'end', style: fill('muted'), 'font-size': 11, 'font-family': 'IBM Plex Mono' }, (pos ? '+' : '-') + Math.abs(d.v).toFixed(3)));
  });
  $('#shap-note').textContent = `Teal menaikkan prediksi, oranye menurunkannya. Satuan: sm³/hari (kontribusi bertumpuk dari basis menuju nilai prediksi). Basis ${num(smp.shap_base, 1)}.`;
}

/* ---------- demo sampel bawaan ---------- */
async function runSample(smp, btn) {
  document.querySelectorAll('#sample-btns .btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  current = smp; baseFeatures = smp.features.slice();
  $('#demo-kpis').hidden = $('#demo-body').hidden = false;
  $('#d-act').textContent = num(smp.actual_mean) + ' sm³/hari';
  $('#d-arps').textContent = num(smp.arps_mean) + ' sm³/hari';
  $('#d-xgb').textContent = '...'; $('#d-lat').textContent = '...';
  drawChart($('#chart'), smp, null); drawShap(smp);
  try {
    await ensureSession();
    const pred = await predict(smp.features);
    $('#d-xgb').textContent = num(pred) + ' sm³/hari';
    drawChart($('#chart'), smp, pred);
    const b = await bench(smp.features);
    $('#d-lat').textContent = num(b.p50, 2) + ' ms';
    $('#k-lat').textContent = num(b.p50, 2) + ' ms';
    $('#g-browser').textContent = num(b.p50, 2) + ' ms';
    $('#dev-note').textContent = `Latency: median ${num(b.p50, 2)} ms, p95 ${num(b.p95, 2)} ms, dari 50 titik (tiap titik dirata-rata dari 20 run) setelah 5 run warm-up. Perangkat: ${navigator.hardwareConcurrency || '?'} core logis, ${(navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/[\d.]+/) || ['browser'])[0]}.`;
    buildWhatIf(smp);
  } catch { $('#d-xgb').textContent = 'gagal'; $('#d-lat').textContent = '-'; }
}
function buildWhatIf(smp) {
  const f = $('#wf-form'); f.replaceChildren();
  samples.feature_names.forEach((n, i) => {
    f.append(h('label', {}, n, h('input', { type: 'number', step: 'any', value: String(smp.features[i]), 'data-i': String(i) })));
  });
  $('#whatif').hidden = false;
}
async function rerun(reset) {
  const f = baseFeatures.slice();
  const inputs = [...document.querySelectorAll('#wf-form input')];
  if (reset) inputs.forEach((i) => (i.value = String(baseFeatures[+i.dataset.i])));
  else inputs.forEach((i) => { const v = parseFloat(i.value); if (Number.isFinite(v)) f[+i.dataset.i] = v; });
  const pred = await predict(f);
  $('#d-xgb').textContent = num(pred) + ' sm³/hari' + (reset ? '' : ' (what-if)');
  drawChart($('#chart'), current, pred);
}

/* ---------- unggah data Volve milik pengguna ---------- */
// Kolom wajib mengikuti sheet "Daily Production Data" bawaan Volve.
const REQUIRED_COLS = ['DATEPRD', 'NPD_WELL_BORE_NAME', 'ON_STREAM_HRS', 'AVG_WHP_P', 'AVG_CHOKE_SIZE_P', 'BORE_OIL_VOL', 'BORE_GAS_VOL', 'BORE_WAT_VOL'];
let xlsxReady = null;
function ensureXLSX() {
  if (!xlsxReady) xlsxReady = window.XLSX ? Promise.resolve() : loadScript('vendor/xlsx/xlsx.full.min.js');
  return xlsxReady;
}
/* PURE:BEGIN -- replika prep_well() dan feats() di src/train.py; jaga tetap sama baris-demi-baris */
const DAY_MS = 86400000;
const numOrNaN = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v)); // sel kosong = NaN (seperti pandas), bukan 0
const zero = (v) => (Number.isFinite(v) ? v : 0);
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// prep_well(): drop_duplicates("date"), reindex harian, celah tanggal = shut-in (oil/gas/wat/hours = 0), whp/choke ffill lalu bfill.
function prepWell(recs) {
  const seen = new Map();
  for (const r of recs) if (!seen.has(r.day)) seen.set(r.day, r);   // simpan kemunculan pertama, seperti pandas
  const days = [...seen.keys()].sort((x, y) => x - y);
  const d0 = days[0], n = days[days.length - 1] - d0 + 1, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = seen.get(d0 + i);
    out[i] = { date: new Date((d0 + i) * DAY_MS), oil: r ? zero(r.oil) : 0, gas: r ? zero(r.gas) : 0, wat: r ? zero(r.wat) : 0,
               hrs: r ? zero(r.hrs) : 0, whp: r ? r.whp : NaN, choke: r ? r.choke : NaN };
  }
  for (const f of ['whp', 'choke']) {
    for (let i = 1; i < n; i++) if (!Number.isFinite(out[i][f])) out[i][f] = out[i - 1][f];       // ffill
    for (let i = n - 2; i >= 0; i--) if (!Number.isFinite(out[i][f])) out[i][f] = out[i + 1][f]; // bfill
    for (let i = 0; i < n; i++) out[i][f] = zero(out[i][f]);                                     // fillna(0)
  }
  return out;
}
// load_volve() + prep_well() untuk semua sumur. rows = hasil XLSX.utils.sheet_to_json(..., {defval: null}).
function buildWells(rows, cols) {
  const src = cols.includes('WELL_TYPE') ? rows.filter((r) => r.WELL_TYPE === 'OP') : rows;  // hanya produser, sama dengan load_volve()
  const by = new Map();
  for (const r of src) {
    const d = r.DATEPRD instanceof Date ? r.DATEPRD : new Date(r.DATEPRD);
    const name = r.NPD_WELL_BORE_NAME == null ? '' : String(r.NPD_WELL_BORE_NAME);
    if (isNaN(d) || !name) continue;
    if (!by.has(name)) by.set(name, []);
    by.get(name).push({ day: Math.round(d.getTime() / DAY_MS), hrs: numOrNaN(r.ON_STREAM_HRS), whp: numOrNaN(r.AVG_WHP_P),
      choke: numOrNaN(r.AVG_CHOKE_SIZE_P), oil: numOrNaN(r.BORE_OIL_VOL), gas: numOrNaN(r.BORE_GAS_VOL), wat: numOrNaN(r.BORE_WAT_VOL) });
  }
  return new Map([...by].map(([name, recs]) => [name, prepWell(recs)]));
}
// feats(): 14 fitur pada indeks harian idx. Rolling mean dengan min_periods=1, epsilon dan clip sama dengan Python.
function computeFeatures(arr, idx) {
  const r = (f, w) => { const a = Math.max(0, idx - w + 1); let t = 0; for (let i = a; i <= idx; i++) t += f(arr[i]); return t / (idx - a + 1); };
  const oil = (x) => x.oil, wat = (x) => x.wat, gas = (x) => x.gas, ow = (x) => x.oil + x.wat;
  const m7 = r(oil, 7), m30 = r(oil, 30), m90 = r(oil, 90);
  const wc7 = r(wat, 7) / (r(ow, 7) + 1e-6), wc30 = r(wat, 30) / (r(ow, 30) + 1e-6);
  const gor7 = r(gas, 7) / (m7 + 1e-6), gor30 = r(gas, 30) / (m30 + 1e-6);
  const whp7 = r((x) => x.whp, 7), whp30 = r((x) => x.whp, 30);
  const f = {
    oil_m7_m30: m7 / (m30 + 1), oil_m30_m90: m30 / (m90 + 1), oil_d1_m30: arr[idx].oil / (m30 + 1),
    wc7, wc_delta: wc7 - wc30, log_gor7: Math.log1p(gor7), gor_ratio: clip(gor7 / (gor30 + 1e-6), 0, 5),
    whp7, whp_ratio: clip(whp7 / (whp30 + 1e-6), 0, 5), choke7: r((x) => x.choke, 7),
    uptime7: r((x) => x.hrs, 7) / 24, uptime30: r((x) => x.hrs, 30) / 24,
    log_days: Math.log1p(idx), log_m30: Math.log1p(m30),
  };
  for (const k in f) if (Number.isNaN(f[k])) f[k] = 0;   // fillna(0)
  return f;
}
/* PURE:END */
function isoDate(d) { return d.toISOString().slice(0, 10); }
async function handleUpload(file) {
  $('#up-controls').hidden = true; $('#up-results').hidden = true;
  setStatus('Membaca berkas...', false, '#up-status');
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Berkas lebih dari 20 MB.');
    await ensureXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames.find((n) => /daily/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
    if (!rows.length) throw new Error(`Sheet "${sheetName}" kosong.`);
    const cols = Object.keys(rows[0]);
    const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
    if (missing.length) throw new Error('Kolom wajib tidak ditemukan: ' + missing.join(', '));
    const wells = buildWells(rows, cols);
    if (!wells.size) throw new Error('Tidak ada baris produser (WELL_TYPE=OP) yang valid setelah difilter.');
    const eligible = [...wells.entries()].filter(([, arr]) => arr.length >= 120);
    if (!eligible.length) throw new Error('Tidak ada sumur dengan riwayat >=120 hari data harian. Sumur ditemukan: ' + ([...wells.entries()].map(([n, a]) => `${n} (${a.length} hari)`).join(', ') || '-'));
    uploadState = { wells: new Map(eligible) };
    setStatus(`Berkas valid. Sheet "${sheetName}", ${eligible.length} dari ${wells.size} sumur memenuhi syarat (≥120 hari).`, false, '#up-status');
    const sel = $('#up-well'); sel.replaceChildren();
    for (const [name, arr] of eligible) sel.append(h('option', { value: name }, `${name} — ${arr.length} hari (${isoDate(arr[0].date)} s.d. ${isoDate(arr[arr.length - 1].date)})`));
    onWellChange();
    $('#up-controls').hidden = false;
  } catch (e) {
    setStatus('Gagal: ' + e.message, true, '#up-status');
  }
}
function onWellChange() {
  const arr = uploadState.wells.get($('#up-well').value);
  const d = $('#up-date');
  d.min = isoDate(arr[119].date); d.max = isoDate(arr[arr.length - 1].date); d.value = d.max;
}
async function runUpload() {
  const arr = uploadState.wells.get($('#up-well').value);
  const dateStr = $('#up-date').value;
  const idx = arr.findIndex((r) => isoDate(r.date) === dateStr);
  if (idx < 119) { setStatus('Tanggal ini belum punya 120 hari riwayat di sumur ini.', true, '#up-status'); return; }
  if (!samples) { setStatus('samples.json gagal dimuat, urutan fitur tidak diketahui. Muat ulang halaman.', true, '#up-status'); return; }
  try {
    const fobj = computeFeatures(arr, idx), features = samples.feature_names.map((n) => fobj[n]);
    if (Math.expm1(fobj.log_m30) <= 5) throw new Error('Rata-rata 30 hari terakhir <= 5 sm³/hari; model hanya dilatih untuk sumur di atas ambang itu.');
    if (features.some((v) => !Number.isFinite(v))) throw new Error('Ada nilai fitur tidak valid.');
    await ensureSession();
    const pred = await predict(features);
    const future = arr.slice(idx + 1, idx + 31).map((r) => r.oil);
    const smp = { history: arr.slice(Math.max(0, idx - 119), idx + 1).map((r) => r.oil), future_actual: future, arps_mean: null };
    $('#up-pred').textContent = num(pred) + ' sm³/hari';
    const showActual = future.length >= 30;
    $('#up-actual-row').hidden = !showActual;
    if (showActual) $('#up-actual').textContent = num(future.reduce((a, b) => a + b, 0) / future.length) + ' sm³/hari';
    drawChart($('#up-chart'), smp, pred);
    $('#up-results').hidden = false;
    setStatus('Prediksi selesai.', false, '#up-status');
  } catch (e) {
    setStatus('Prediksi gagal: ' + e.message, true, '#up-status');
  }
}

/* ---------- tim ---------- */
const validLI = (u) => typeof u === 'string' && u.startsWith(LINKEDIN_PREFIX) && u.length > LINKEDIN_PREFIX.length && !/TODO/i.test(u);
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
function avatar(nama) { return h('div', { class: 'avatar', role: 'img', 'aria-label': 'Avatar ' + nama }, initials(nama)); }
function renderTeam(list) {
  if (list.filter((m) => m.ketua === true).length !== 1) console.warn('team.json harus punya tepat satu "ketua": true');
  const sorted = [...list].sort((a, b) => (b.ketua === true) - (a.ketua === true));
  const ul = $('#team');
  for (const m of sorted) {
    const card = h('div', { class: 'px member' + (m.ketua ? ' ketua' : '') });
    if (m.ketua) {
      const rb = h('span', { class: 'ribbon', role: 'img', 'aria-label': 'Ketua kelompok' });
      const crown = s('svg', { width: 16, height: 16, viewBox: '0 0 8 8', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' });
      crown.append(s('path', { d: 'M0 2h1v1h1V1h1v2h2V1h1v2h1V2h1v5H0z', fill: 'currentColor' }));
      rb.append(crown, 'KETUA'); card.append(rb);
    }
    const img = h('img', { class: 'ph', src: m.foto || '', alt: 'Foto ' + m.nama, width: 128, height: 128, loading: 'lazy' });
    img.onerror = () => img.replaceWith(avatar(m.nama));
    card.append(img, h('h3', {}, m.nama), h('p', { class: 'nim' }, 'NIM ' + m.nim), h('p', {}, m.peran));
    card.append(validLI(m.linkedin)
      ? h('a', { class: 'btn line', href: m.linkedin, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `LinkedIn ${m.nama} (buka tab baru)` }, 'LinkedIn ↗')
      : h('span', { class: 'btn', 'aria-disabled': 'true' }, 'LinkedIn belum diisi'));
    ul.append(h('li', {}, card));
  }
}

/* ---------- init ---------- */
async function init() {
  const [m, sm, tm] = await Promise.allSettled([getJSON('metrics.json'), getJSON('samples.json'), getJSON('team.json')]);
  if (m.status === 'fulfilled') { metrics = m.value; renderMetrics(); }
  else { renderBadge(); $('#res-note').textContent = 'metrics.json tidak ditemukan. Jalankan python src/train.py (atau run.py) lalu pastikan hasilnya ada di public/.'; }
  if (tm.status === 'fulfilled') renderTeam(tm.value); else $('#team').append(h('li', {}, 'team.json tidak ditemukan.'));
  if (sm.status === 'fulfilled' && sm.value.samples?.length) {
    samples = sm.value; featIdx = samples.feature_names.indexOf('log_m30');
    const box = $('#sample-btns');
    samples.samples.forEach((smp) => {
      const d = (smp.id.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
      const b = h('button', { class: 'btn line', type: 'button', 'aria-pressed': 'false' }, d ? `${smp.well}, mulai ${d}` : `${smp.well} (#${smp.id})`);
      b.onclick = () => runSample(smp, b);
      box.append(b);
    });
  } else setStatus('samples.json tidak ditemukan. Jalankan python src/train.py (atau run.py), lalu pastikan samples.json dan model.onnx ada di public/.', true);
  $('#try').onclick = () => {
    $('#demo').scrollIntoView();
    if (samples) $('#sample-btns .btn').click();
  };
  $('#wf-run').onclick = () => rerun(false);
  $('#wf-reset').onclick = () => rerun(true);
  $('#up-file').addEventListener('change', (e) => { if (e.target.files[0]) handleUpload(e.target.files[0]); });
  $('#up-well').addEventListener('change', onWellChange);
  $('#up-run').addEventListener('click', runUpload);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { io.disconnect(); if (samples) ensureSession().catch(() => {}); } }, { rootMargin: '200px' });
    io.observe($('#demo'));
  }
}
init();