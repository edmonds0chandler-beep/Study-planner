'use strict';

/* ============================================================
   Constants
   ============================================================ */

const STORAGE_KEY = 'studyTracker.data.v1';
const SCHEMA_VERSION = 1;

const SUBJECT_COLORS = [
  '#b8763f', '#4f6d63', '#a15c4a', '#5b7a9d',
  '#8a6bab', '#c2954a', '#5f8b7a', '#b0577a',
  '#6b7fb0', '#9a7548', '#6f9c6a', '#a35d8a'
];

const DAY_MS = 24 * 60 * 60 * 1000;

/* ============================================================
   Utilities
   ============================================================ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr() {
  return localDateStr(new Date());
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(date) {
  // Monday-based week
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function fmtDuration(totalSeconds, opts) {
  opts = opts || {};
  const mins = Math.round(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0 && m === 0) return opts.zero || '0m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDurationLong(totalSeconds) {
  const mins = Math.round(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [];
  if (h) parts.push(`${h} hr${h !== 1 ? 's' : ''}`);
  parts.push(`${m} min${m !== 1 ? 's' : ''}`);
  return parts.join(' ');
}

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function fmtTime(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(m)} ${ampm}`;
}

function fmtDayHeading(dateStr) {
  const d = parseDateStr(dateStr);
  const today = todayStr();
  const yestDate = new Date();
  yestDate.setDate(yestDate.getDate() - 1);
  const yesterday = localDateStr(yestDate);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    year: sameYear ? undefined : 'numeric'
  });
}

function weekdayLabel(dateStr) {
  return parseDateStr(dateStr).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1);
}

function monthDayLabel(dateStr) {
  const d = parseDateStr(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ============================================================
   Data model & storage
   ============================================================ */

function defaultData() {
  return {
    version: SCHEMA_VERSION,
    subjects: [
      { id: uid(), name: 'Mathematics', color: SUBJECT_COLORS[0], createdAt: Date.now() },
      { id: uid(), name: 'Biology', color: SUBJECT_COLORS[1], createdAt: Date.now() },
      { id: uid(), name: 'History', color: SUBJECT_COLORS[3], createdAt: Date.now() }
    ],
    sessions: [],
    activeSession: null,
    settings: {
      weeklyTargetMinutes: 300,
      theme: 'system'
    }
  };
}

function isValidDataShape(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!Array.isArray(obj.subjects) || !Array.isArray(obj.sessions)) return false;
  for (const s of obj.subjects) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.color !== 'string') return false;
  }
  for (const s of obj.sessions) {
    if (!s || typeof s.id !== 'string' || typeof s.subjectId !== 'string') return false;
    if (s.type !== 'study' && s.type !== 'revision') return false;
    if (typeof s.duration !== 'number' || typeof s.date !== 'string') return false;
    if (typeof s.startTime !== 'string' || typeof s.endTime !== 'string') return false;
  }
  if (obj.settings && typeof obj.settings !== 'object') return false;
  return true;
}

let data = null;
let saveScheduled = false;

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    if (!isValidDataShape(parsed)) return defaultData();
    parsed.settings = Object.assign({ weeklyTargetMinutes: 300, theme: 'system' }, parsed.settings || {});
    if (!Array.isArray(parsed.subjects)) parsed.subjects = [];
    if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
    if (parsed.activeSession === undefined) parsed.activeSession = null;
    return parsed;
  } catch (e) {
    console.error('Failed to load data, starting fresh.', e);
    return defaultData();
  }
}

function persistNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save data.', e);
    showToast('Could not save — storage may be full');
  }
}

const persistDebounced = debounce(persistNow, 150);

function save() {
  persistDebounced();
}

function saveImmediate() {
  persistNow();
}

function getSubject(id) {
  return data.subjects.find((s) => s.id === id) || null;
}

function subjectColor(id) {
  const s = getSubject(id);
  return s ? s.color : getCSSVar('--text-tertiary') || '#999';
}

function subjectName(id) {
  const s = getSubject(id);
  return s ? s.name : 'Deleted subject';
}

/* ============================================================
   Timer engine — timestamp based, resilient to backgrounding
   ============================================================ */

let tickHandle = null;

function activeElapsedMs(session, now) {
  now = now || Date.now();
  const ref = session.status === 'paused' && session.pausedAt ? session.pausedAt : now;
  return Math.max(0, ref - session.startTime - session.totalPausedMs);
}

function startTimer(subjectId, type) {
  if (data.activeSession) return;
  data.activeSession = {
    subjectId,
    type,
    startTime: Date.now(),
    pausedAt: null,
    totalPausedMs: 0,
    status: 'running'
  };
  saveImmediate();
  enterActiveTimerUI();
  startTicking();
}

function pauseTimer() {
  const s = data.activeSession;
  if (!s || s.status !== 'running') return;
  s.pausedAt = Date.now();
  s.status = 'paused';
  saveImmediate();
  stopTicking();
  renderTimerActiveFrame();
}

function resumeTimer() {
  const s = data.activeSession;
  if (!s || s.status !== 'paused') return;
  s.totalPausedMs += Date.now() - s.pausedAt;
  s.pausedAt = null;
  s.status = 'running';
  saveImmediate();
  startTicking();
  renderTimerActiveFrame();
}

function finishTimer() {
  const s = data.activeSession;
  if (!s) return;
  const elapsedMs = activeElapsedMs(s);
  stopTicking();
  data.activeSession = null;

  if (elapsedMs < 1000) {
    saveImmediate();
    showToast('Session too short to save');
    exitActiveTimerUI();
    return;
  }

  const endTime = s.status === 'paused' && s.pausedAt ? s.pausedAt : Date.now();
  const startDate = new Date(s.startTime);
  const endDate = new Date(endTime);
  const session = {
    id: uid(),
    subjectId: s.subjectId,
    type: s.type,
    duration: Math.round(elapsedMs / 1000),
    date: localDateStr(startDate),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString()
  };
  data.sessions.push(session);
  saveImmediate();
  exitActiveTimerUI();
  showToast(`Saved ${fmtDurationLong(session.duration)}`);
  refreshAllScreens();
}

function discardTimer() {
  if (!data.activeSession) return;
  if (!confirm('Discard this session without saving?')) return;
  stopTicking();
  data.activeSession = null;
  saveImmediate();
  exitActiveTimerUI();
}

function startTicking() {
  stopTicking();
  tickHandle = setInterval(renderTimerActiveFrame, 1000);
}

function stopTicking() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

/* ============================================================
   DOM refs
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {};

function cacheEls() {
  els.header = $('#appHeader');
  els.screenHeading = $('#screenHeading');
  els.headerMeta = $('#headerMeta');
  els.tabBtns = $$('.tab-btn');
  els.screens = {
    timer: $('#screen-timer'),
    dashboard: $('#screen-dashboard'),
    history: $('#screen-history'),
    stats: $('#screen-stats'),
    settings: $('#screen-settings')
  };

  els.subjectPicker = $('#subjectPicker');
  els.modeToggle = $('#modeToggle');
  els.startBtn = $('#startBtn');
  els.timerSetup = $('#timerSetup');
  els.timerActive = $('#timerActive');
  els.timerContext = $('#timerContext');
  els.timerContextLabel = $('#timerContextLabel');
  els.timerDisplay = $('#timerDisplay');
  els.timerStatusLabel = $('#timerStatusLabel');
  els.timerRingProgress = $('#timerRingProgress');
  els.pauseResumeBtn = $('#pauseResumeBtn');
  els.finishBtn = $('#finishBtn');
  els.discardBtn = $('#discardBtn');

  els.statToday = $('#statToday');
  els.statWeek = $('#statWeek');
  els.statMonth = $('#statMonth');
  els.targetTitle = $('#targetTitle');
  els.targetSub = $('#targetSub');
  els.targetProgressFill = $('#targetProgressFill');
  els.donutChart = $('#donutChart');
  els.donutLegend = $('#donutLegend');
  els.compareBars = $('#compareBars');
  els.rangeSwitch = $('#rangeSwitch');
  els.barChart = $('#barChart');

  els.historyContent = $('#historyContent');
  els.addSessionBtn = $('#addSessionBtn');

  els.statsGrid = $('#statsGrid');
  els.subjectBars = $('#subjectBars');

  els.subjectSettingsList = $('#subjectSettingsList');
  els.addSubjectBtn = $('#addSubjectBtn');
  els.weeklyTargetInput = $('#weeklyTargetInput');
  els.themeSwitch = $('#themeSwitch');
  els.exportBtn = $('#exportBtn');
  els.importBtn = $('#importBtn');
  els.importFile = $('#importFile');
  els.resetBtn = $('#resetBtn');

  els.sessionModalBackdrop = $('#sessionModalBackdrop');
  els.sessionModalTitle = $('#sessionModalTitle');
  els.sessionForm = $('#sessionForm');
  els.sessionSubject = $('#sessionSubject');
  els.sessionModeToggle = $('#sessionModeToggle');
  els.sessionDate = $('#sessionDate');
  els.sessionStart = $('#sessionStart');
  els.sessionEnd = $('#sessionEnd');
  els.sessionError = $('#sessionError');
  els.deleteSessionBtn = $('#deleteSessionBtn');

  els.subjectModalBackdrop = $('#subjectModalBackdrop');
  els.subjectModalTitle = $('#subjectModalTitle');
  els.subjectForm = $('#subjectForm');
  els.subjectName = $('#subjectName');
  els.colorGrid = $('#colorGrid');
  els.deleteSubjectBtn = $('#deleteSubjectBtn');

  els.toast = $('#toast');
}

/* ============================================================
   Navigation
   ============================================================ */

let currentScreen = 'timer';
const SCREEN_TITLES = {
  timer: 'Timer',
  dashboard: 'Dashboard',
  history: 'History',
  stats: 'Stats',
  settings: 'Settings'
};

function navigate(screen) {
  currentScreen = screen;
  Object.keys(els.screens).forEach((key) => {
    els.screens[key].hidden = key !== screen;
  });
  els.tabBtns.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.screen === screen);
  });
  els.screenHeading.textContent = SCREEN_TITLES[screen];
  renderScreen(screen);
  window.scrollTo({ top: 0 });
}

function renderScreen(screen) {
  if (screen === 'timer') renderTimerScreen();
  else if (screen === 'dashboard') renderDashboard();
  else if (screen === 'history') renderHistory();
  else if (screen === 'stats') renderStats();
  else if (screen === 'settings') renderSettings();
}

function refreshAllScreens() {
  renderScreen(currentScreen);
}

/* ============================================================
   Toast
   ============================================================ */

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

/* ============================================================
   Timer screen
   ============================================================ */

let pendingSubjectId = null;
let pendingMode = 'study';
const RING_CIRC = 2 * Math.PI * 132;

function renderTimerScreen() {
  if (data.activeSession) {
    enterActiveTimerUI();
  } else {
    exitActiveTimerUI();
    renderSubjectPicker();
    renderModeToggle();
    updateStartButton();
  }
}

function renderSubjectPicker() {
  if (data.subjects.length && !pendingSubjectId) {
    pendingSubjectId = data.subjects[0].id;
  }
  els.subjectPicker.innerHTML = data.subjects.map((s) => `
    <button type="button" class="subject-chip ${s.id === pendingSubjectId ? 'is-selected' : ''}"
      style="--chip-color:${s.color}; --chip-bg:${s.color}22;" data-subject-id="${s.id}">
      <span class="dot" style="background:${s.color}"></span>${escapeHtml(s.name)}
    </button>
  `).join('') + `
    <button type="button" class="subject-chip add-new" id="addSubjectFromTimer">+ New subject</button>
  `;
}

function renderModeToggle() {
  $$('#modeToggle .mode-btn').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.mode === pendingMode);
  });
}

function updateStartButton() {
  els.startBtn.disabled = !pendingSubjectId || !data.subjects.length;
}

function enterActiveTimerUI() {
  els.timerSetup.hidden = true;
  els.timerActive.hidden = false;
  const s = data.activeSession;
  const color = subjectColor(s.subjectId);
  els.timerContext.querySelector('.dot').style.background = color;
  els.timerContextLabel.textContent = `${subjectName(s.subjectId)} · ${s.type === 'study' ? 'Study' : 'Revision'}`;
  els.timerRingProgress.style.setProperty('--ring-color', color);
  renderTimerActiveFrame();
  if (s.status === 'running') startTicking();
}

function exitActiveTimerUI() {
  els.timerSetup.hidden = false;
  els.timerActive.hidden = true;
  stopTicking();
}

function renderTimerActiveFrame() {
  const s = data.activeSession;
  if (!s) return;
  const elapsedMs = activeElapsedMs(s);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  els.timerDisplay.textContent = fmtClock(elapsedSec);
  els.timerDisplay.classList.toggle('is-paused', s.status === 'paused');

  const progress = (elapsedSec % 3600) / 3600;
  const offset = RING_CIRC * (1 - progress);
  els.timerRingProgress.style.strokeDashoffset = String(offset);

  if (s.status === 'paused') {
    els.timerStatusLabel.textContent = 'Paused';
    els.timerStatusLabel.classList.add('is-paused-label');
    els.pauseResumeBtn.textContent = 'Resume';
  } else {
    els.timerStatusLabel.textContent = 'Running';
    els.timerStatusLabel.classList.remove('is-paused-label');
    els.pauseResumeBtn.textContent = 'Pause';
  }

  document.title = data.activeSession
    ? `${fmtClock(elapsedSec)} · Study Tracker`
    : 'Study Tracker';
}

/* ============================================================
   Aggregation helpers
   ============================================================ */

function sumDuration(sessions) {
  return sessions.reduce((sum, s) => sum + s.duration, 0);
}

function totalForWeek(refDate) {
  refDate = refDate || new Date();
  const start = startOfWeek(refDate);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  return sumDuration(data.sessions.filter((s) => {
    const d = parseDateStr(s.date);
    return d >= start && d < end;
  }));
}

function totalForMonth(refDate) {
  refDate = refDate || new Date();
  const start = startOfMonth(refDate);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return sumDuration(data.sessions.filter((s) => {
    const d = parseDateStr(s.date);
    return d >= start && d < end;
  }));
}

function subjectTotals() {
  const totals = {};
  data.sessions.forEach((s) => {
    totals[s.subjectId] = (totals[s.subjectId] || 0) + s.duration;
  });
  return data.subjects
    .map((sub) => ({ id: sub.id, name: sub.name, color: sub.color, value: totals[sub.id] || 0 }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

function buildDayBuckets(numDays) {
  const days = [];
  const now = new Date();
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const ds = localDateStr(d);
    const daySessions = data.sessions.filter((s) => s.date === ds);
    const study = daySessions.filter((s) => s.type === 'study').reduce((a, s) => a + s.duration, 0);
    const revision = daySessions.filter((s) => s.type === 'revision').reduce((a, s) => a + s.duration, 0);
    days.push({ date: ds, study, revision });
  }
  return days;
}

/* ============================================================
   Dashboard
   ============================================================ */

let chartRangeDays = 7;

function renderDashboard() {
  const todayTotal = sumDuration(data.sessions.filter((s) => s.date === todayStr()));
  const weekTotal = totalForWeek();
  const monthTotal = totalForMonth();

  els.statToday.textContent = fmtDuration(todayTotal);
  els.statWeek.textContent = fmtDuration(weekTotal);
  els.statMonth.textContent = fmtDuration(monthTotal);

  const targetMin = data.settings.weeklyTargetMinutes || 0;
  const targetSec = targetMin * 60;
  const pct = targetSec > 0 ? clamp((weekTotal / targetSec) * 100, 0, 100) : 0;
  els.targetTitle.textContent = targetSec > 0
    ? `${fmtDuration(weekTotal)} of ${fmtDuration(targetSec)}`
    : fmtDuration(weekTotal);
  els.targetSub.textContent = targetSec > 0 ? `${Math.round(pct)}% of weekly target` : 'No weekly target set';
  els.targetProgressFill.style.width = `${pct}%`;

  const segs = subjectTotals();
  const totalAll = segs.reduce((a, s) => a + s.value, 0);
  drawDonutChart(els.donutChart, segs);
  renderDonutLegend(els.donutLegend, segs, totalAll);

  const studyTotal = sumDuration(data.sessions.filter((s) => s.type === 'study'));
  const revisionTotal = sumDuration(data.sessions.filter((s) => s.type === 'revision'));
  renderBarList(els.compareBars, [
    { label: 'Study', value: studyTotal, color: getCSSVar('--study') },
    { label: 'Revision', value: revisionTotal, color: getCSSVar('--revision') }
  ]);

  const days = buildDayBuckets(chartRangeDays);
  drawBarChart(els.barChart, days);
}

function renderBarList(container, rows) {
  const withValues = rows.filter((r) => r.value > 0);
  if (!withValues.length) {
    container.innerHTML = '<div class="empty-state-text">No sessions yet</div>';
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  container.innerHTML = rows.map((r) => `
    <div>
      <div class="compare-row-label">
        <span>${escapeHtml(r.label)}</span>
        <span>${fmtDuration(r.value)}</span>
      </div>
      <div class="compare-track">
        <div class="compare-fill" style="width:${((r.value / max) * 100).toFixed(1)}%; background:${r.color};"></div>
      </div>
    </div>
  `).join('');
}

function renderDonutLegend(container, segments, total) {
  if (!segments.length) {
    container.innerHTML = '<div class="empty-state-text">No sessions yet</div>';
    return;
  }
  container.innerHTML = segments.map((seg) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${seg.color}"></span>
      <span class="legend-name">${escapeHtml(seg.name)}</span>
      <span class="legend-value">${total > 0 ? Math.round((seg.value / total) * 100) : 0}%</span>
    </div>
  `).join('');
}

/* ============================================================
   Canvas charts (no external dependencies)
   ============================================================ */

function drawDonutChart(canvas, segments) {
  canvas.style.width = '120px';
  canvas.style.height = '120px';
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 120;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;
  const rOuter = size / 2 - 3;
  const rInner = rOuter * 0.6;
  const total = segments.reduce((s, x) => s + x.value, 0);

  if (total <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, (rOuter + rInner) / 2, 0, Math.PI * 2);
    ctx.lineWidth = rOuter - rInner;
    ctx.strokeStyle = getCSSVar('--border');
    ctx.stroke();
    return;
  }

  let start = -Math.PI / 2;
  const gapAngle = segments.length > 1 ? 0.035 : 0;
  segments.forEach((seg) => {
    const angle = (seg.value / total) * Math.PI * 2;
    const end = start + angle;
    const s0 = start + gapAngle / 2;
    const e0 = end - gapAngle / 2;
    if (e0 > s0) {
      ctx.beginPath();
      ctx.arc(cx, cy, (rOuter + rInner) / 2, s0, e0);
      ctx.lineWidth = rOuter - rInner;
      ctx.strokeStyle = seg.color;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    start = end;
  });
}

function roundedTopRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function drawBarChart(canvas, days) {
  canvas.style.width = '100%';
  canvas.style.height = '160px';
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = 160;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const n = days.length;
  const max = Math.max(60, ...days.map((d) => d.study + d.revision));
  const padTop = 8, padBottom = 20;
  const chartH = cssH - padTop - padBottom;
  const gap = n > 10 ? 3 : 10;
  const barW = (cssW - gap * (n - 1)) / n;

  const studyColor = getCSSVar('--study');
  const revisionColor = getCSSVar('--revision');
  const trackColor = getCSSVar('--border');
  const textColor = getCSSVar('--text-tertiary');

  days.forEach((d, i) => {
    const x = i * (barW + gap);
    const total = d.study + d.revision;
    const totalH = total > 0 ? Math.max(3, (total / max) * chartH) : 0;
    const yTop = padTop + (chartH - totalH);

    ctx.fillStyle = trackColor;
    ctx.fillRect(x, padTop + chartH - 1.5, barW, 1.5);

    if (total > 0) {
      const r = Math.min(4, barW / 2);
      ctx.save();
      roundedTopRectPath(ctx, x, yTop, barW, totalH, r);
      ctx.clip();
      const studyH = (d.study / total) * totalH;
      ctx.fillStyle = revisionColor;
      ctx.fillRect(x, yTop, barW, totalH - studyH);
      ctx.fillStyle = studyColor;
      ctx.fillRect(x, yTop + (totalH - studyH), barW, studyH);
      ctx.restore();
    }

    const showLabel = n <= 7 || i % Math.ceil(n / 8) === 0 || i === n - 1;
    if (showLabel) {
      ctx.fillStyle = textColor;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      const label = n <= 7
        ? parseDateStr(d.date).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)
        : monthDayLabel(d.date);
      ctx.fillText(label, x + barW / 2, cssH - 6);
    }
  });
}

/* ============================================================
   History
   ============================================================ */

function emptyStateHTML(title, text) {
  return `<div class="empty-state">
    <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-text">${text}</div>
  </div>`;
}

function sessionRowHTML(s) {
  const color = subjectColor(s.subjectId);
  return `
    <div class="session-row" data-session-id="${s.id}">
      <div class="session-bar" style="--row-color:${color}"></div>
      <div class="session-main">
        <div class="session-subject">${escapeHtml(subjectName(s.subjectId))}</div>
        <div class="session-meta">
          <span class="type-tag ${s.type}">${s.type}</span>
          <span>${fmtTime(new Date(s.startTime))} – ${fmtTime(new Date(s.endTime))}</span>
        </div>
      </div>
      <div class="session-duration">${fmtDuration(s.duration)}</div>
      <div class="session-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg></div>
    </div>
  `;
}

function renderHistory() {
  if (!data.sessions.length) {
    els.historyContent.innerHTML = emptyStateHTML('No sessions yet', 'Start a timer or add one manually to see it here.');
    return;
  }
  const byDate = {};
  data.sessions.forEach((s) => {
    (byDate[s.date] = byDate[s.date] || []).push(s);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  els.historyContent.innerHTML = dates.map((date) => {
    const sessions = byDate[date].slice().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const total = sumDuration(sessions);
    return `
      <div class="day-group">
        <div class="day-heading">
          <span class="day-heading-title">${fmtDayHeading(date)}</span>
          <span class="day-heading-total">${fmtDuration(total)}</span>
        </div>
        <div class="session-list">${sessions.map(sessionRowHTML).join('')}</div>
      </div>
    `;
  }).join('');
}

/* ============================================================
   Stats
   ============================================================ */

function computeStats() {
  const totalLifetime = sumDuration(data.sessions);
  const sessionCount = data.sessions.length;
  const avgSessionLen = sessionCount ? totalLifetime / sessionCount : 0;
  const weekTotal = totalForWeek();

  let avgPerDay = 0;
  if (sessionCount) {
    const firstDate = data.sessions.reduce((min, s) => (s.date < min ? s.date : min), data.sessions[0].date);
    const daySpan = Math.max(1, Math.round((parseDateStr(todayStr()) - parseDateStr(firstDate)) / DAY_MS) + 1);
    avgPerDay = totalLifetime / daySpan;
  }

  const bySubject = subjectTotals();
  const topSubject = bySubject[0] || null;

  const studyTotal = sumDuration(data.sessions.filter((s) => s.type === 'study'));
  const revisionTotal = sumDuration(data.sessions.filter((s) => s.type === 'revision'));
  const studyPct = totalLifetime > 0 ? Math.round((studyTotal / totalLifetime) * 100) : 0;
  const revisionPct = totalLifetime > 0 ? 100 - studyPct : 0;

  return {
    totalLifetime, sessionCount, avgSessionLen, weekTotal, avgPerDay,
    topSubject, studyTotal, revisionTotal, studyPct, revisionPct, bySubject
  };
}

function renderStats() {
  const st = computeStats();
  const cells = [
    { value: fmtDuration(st.totalLifetime), label: 'Lifetime total' },
    { value: fmtDuration(Math.round(st.avgPerDay)), label: 'Daily average' },
    { value: fmtDuration(st.weekTotal), label: 'This week' },
    { value: st.topSubject ? st.topSubject.name : '—', label: 'Most studied', sub: st.topSubject ? fmtDuration(st.topSubject.value) : null, compact: true },
    { value: st.totalLifetime > 0 ? `${st.studyPct}% / ${st.revisionPct}%` : '—', label: 'Study vs Revision', compact: true },
    { value: String(st.sessionCount), label: 'Sessions logged' },
    { value: fmtDuration(Math.round(st.avgSessionLen)), label: 'Avg. session length' }
  ];
  els.statsGrid.innerHTML = cells.map((c) => `
    <div class="stat-cell">
      <div class="stat-value${c.compact ? ' is-compact' : ''}">${escapeHtml(c.value)}</div>
      <div class="stat-label">${c.label}</div>
      ${c.sub ? `<div class="stat-sub">${c.sub}</div>` : ''}
    </div>
  `).join('');

  if (!st.bySubject.length) {
    els.subjectBars.innerHTML = '<div class="empty-state-text">No sessions yet</div>';
  } else {
    renderBarList(els.subjectBars, st.bySubject.map((s) => ({ label: s.name, value: s.value, color: s.color })));
  }
}

/* ============================================================
   Settings
   ============================================================ */

const EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';

function renderSettings() {
  els.subjectSettingsList.innerHTML = data.subjects.length
    ? data.subjects.map((s) => `
      <div class="settings-row">
        <span class="subject-swatch" style="background:${s.color}"></span>
        <span class="settings-row-label">${escapeHtml(s.name)}</span>
        <div class="settings-actions">
          <button type="button" class="btn btn-icon btn-ghost" data-edit-subject="${s.id}">${EDIT_ICON_SVG}</button>
        </div>
      </div>
    `).join('')
    : `<div class="settings-row"><span class="settings-row-value">No subjects yet</span></div>`;

  els.weeklyTargetInput.value = String(Math.round((data.settings.weeklyTargetMinutes / 60) * 10) / 10);

  $$('#themeSwitch button').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.theme === data.settings.theme);
  });
}

/* ============================================================
   Theme
   ============================================================ */

const THEME_BG = { light: '#faf9f6', dark: '#171614' };

function resolvedTheme() {
  const t = data.settings.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const t = data.settings.theme;
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.setAttribute('content', THEME_BG[resolvedTheme()]);
}

/* ============================================================
   Modal helpers
   ============================================================ */

function openModal(backdrop) {
  backdrop.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeModal(backdrop) {
  backdrop.classList.remove('is-open');
  document.body.style.overflow = '';
}

function toTimeInputValue(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ============================================================
   Session modal
   ============================================================ */

let editingSessionId = null;
let sessionModalMode = 'study';

function populateSessionSubjectOptions() {
  els.sessionSubject.innerHTML = data.subjects.map((s) =>
    `<option value="${s.id}">${escapeHtml(s.name)}</option>`
  ).join('');
}

function updateSessionModeButtons() {
  $$('#sessionModeToggle .mode-btn').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.mode === sessionModalMode);
  });
}

function openSessionModal(session) {
  if (!data.subjects.length) {
    showToast('Add a subject first');
    return;
  }
  populateSessionSubjectOptions();
  els.sessionError.hidden = true;

  if (session) {
    editingSessionId = session.id;
    els.sessionModalTitle.textContent = 'Edit session';
    els.sessionSubject.value = session.subjectId;
    sessionModalMode = session.type;
    els.sessionDate.value = session.date;
    els.sessionStart.value = toTimeInputValue(new Date(session.startTime));
    els.sessionEnd.value = toTimeInputValue(new Date(session.endTime));
    els.deleteSessionBtn.hidden = false;
  } else {
    editingSessionId = null;
    els.sessionModalTitle.textContent = 'Add session';
    els.sessionSubject.value = pendingSubjectId || data.subjects[0].id;
    sessionModalMode = 'study';
    els.sessionDate.value = todayStr();
    const now = new Date();
    els.sessionStart.value = toTimeInputValue(new Date(now.getTime() - 30 * 60000));
    els.sessionEnd.value = toTimeInputValue(now);
    els.deleteSessionBtn.hidden = true;
  }
  updateSessionModeButtons();
  openModal(els.sessionModalBackdrop);
}

function closeSessionModal() {
  closeModal(els.sessionModalBackdrop);
}

function handleSessionFormSubmit(e) {
  e.preventDefault();
  const subjectId = els.sessionSubject.value;
  const dateStr = els.sessionDate.value;
  const startStr = els.sessionStart.value;
  const endStr = els.sessionEnd.value;
  if (!subjectId || !dateStr || !startStr || !endStr) return;

  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const baseDate = parseDateStr(dateStr);
  const startDate = new Date(baseDate);
  startDate.setHours(sh, sm, 0, 0);
  const endDate = new Date(baseDate);
  endDate.setHours(eh, em, 0, 0);

  if (endDate <= startDate) {
    els.sessionError.textContent = 'End time must be after start time.';
    els.sessionError.hidden = false;
    return;
  }
  els.sessionError.hidden = true;
  const duration = Math.round((endDate - startDate) / 1000);

  if (editingSessionId) {
    const s = data.sessions.find((x) => x.id === editingSessionId);
    if (s) {
      s.subjectId = subjectId;
      s.type = sessionModalMode;
      s.date = dateStr;
      s.startTime = startDate.toISOString();
      s.endTime = endDate.toISOString();
      s.duration = duration;
    }
  } else {
    data.sessions.push({
      id: uid(), subjectId, type: sessionModalMode, date: dateStr,
      startTime: startDate.toISOString(), endTime: endDate.toISOString(), duration
    });
  }
  saveImmediate();
  closeSessionModal();
  refreshAllScreens();
  showToast('Session saved');
}

function handleDeleteSession() {
  if (!editingSessionId) return;
  if (!confirm('Delete this session?')) return;
  data.sessions = data.sessions.filter((s) => s.id !== editingSessionId);
  saveImmediate();
  closeSessionModal();
  refreshAllScreens();
  showToast('Session deleted');
}

/* ============================================================
   Subject modal
   ============================================================ */

let editingSubjectId = null;
let selectedColor = SUBJECT_COLORS[0];

function renderColorGrid() {
  els.colorGrid.innerHTML = SUBJECT_COLORS.map((c) => `
    <button type="button" class="color-swatch ${c === selectedColor ? 'is-selected' : ''}" style="background:${c}" data-color="${c}" aria-label="Select colour"></button>
  `).join('');
}

function openSubjectModal(subject) {
  if (subject) {
    editingSubjectId = subject.id;
    els.subjectModalTitle.textContent = 'Edit subject';
    els.subjectName.value = subject.name;
    selectedColor = subject.color;
    els.deleteSubjectBtn.hidden = false;
  } else {
    editingSubjectId = null;
    els.subjectModalTitle.textContent = 'Add subject';
    els.subjectName.value = '';
    const used = new Set(data.subjects.map((s) => s.color));
    selectedColor = SUBJECT_COLORS.find((c) => !used.has(c)) || SUBJECT_COLORS[data.subjects.length % SUBJECT_COLORS.length];
    els.deleteSubjectBtn.hidden = true;
  }
  renderColorGrid();
  openModal(els.subjectModalBackdrop);
  setTimeout(() => els.subjectName.focus(), 60);
}

function closeSubjectModal() {
  closeModal(els.subjectModalBackdrop);
}

function handleSubjectFormSubmit(e) {
  e.preventDefault();
  const name = els.subjectName.value.trim();
  if (!name) return;
  if (editingSubjectId) {
    const s = getSubject(editingSubjectId);
    if (s) { s.name = name; s.color = selectedColor; }
  } else {
    data.subjects.push({ id: uid(), name, color: selectedColor, createdAt: Date.now() });
  }
  saveImmediate();
  closeSubjectModal();
  refreshAllScreens();
  if (currentScreen === 'timer') renderTimerScreen();
}

function handleDeleteSubject() {
  if (!editingSubjectId) return;
  const count = data.sessions.filter((s) => s.subjectId === editingSubjectId).length;
  const msg = count > 0
    ? `Delete this subject and its ${count} session${count !== 1 ? 's' : ''}? This can't be undone.`
    : 'Delete this subject?';
  if (!confirm(msg)) return;
  data.subjects = data.subjects.filter((s) => s.id !== editingSubjectId);
  data.sessions = data.sessions.filter((s) => s.subjectId !== editingSubjectId);
  if (pendingSubjectId === editingSubjectId) pendingSubjectId = null;
  saveImmediate();
  closeSubjectModal();
  refreshAllScreens();
  if (currentScreen === 'timer') renderTimerScreen();
}

/* ============================================================
   Import / Export
   ============================================================ */

function exportDataFile() {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `study-tracker-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('Backup downloaded');
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (err) {
      alert('This file is not valid JSON.');
      return;
    }
    if (!isValidDataShape(parsed)) {
      alert('This does not look like a Study Tracker backup file.');
      return;
    }
    if (!confirm('Import this backup? It will replace all data currently on this device.')) return;

    parsed.settings = Object.assign({ weeklyTargetMinutes: 300, theme: 'system' }, parsed.settings || {});
    parsed.activeSession = null;
    parsed.version = SCHEMA_VERSION;
    stopTicking();
    data = parsed;
    saveImmediate();
    applyTheme();
    pendingSubjectId = data.subjects.length ? data.subjects[0].id : null;
    navigate(currentScreen);
    showToast('Backup imported');
  };
  reader.readAsText(file);
}

function handleResetAllData() {
  if (!confirm('Erase all data on this device? This cannot be undone — export a backup first if you want to keep it.')) return;
  stopTicking();
  data = defaultData();
  saveImmediate();
  applyTheme();
  pendingSubjectId = data.subjects.length ? data.subjects[0].id : null;
  navigate('timer');
  showToast('All data erased');
}

/* ============================================================
   Header meta (live clock on timer screen only, subtle)
   ============================================================ */

function updateHeaderMeta() {
  if (currentScreen === 'timer' && !data.activeSession) {
    els.headerMeta.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  } else {
    els.headerMeta.textContent = '';
  }
}

/* ============================================================
   Event wiring
   ============================================================ */

function wireEvents() {
  // Tab bar
  els.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
  });

  // Section-head "Edit" link on dashboard target panel -> settings
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) navigate(nav.dataset.nav);
  });

  // Timer setup: subject picker (event delegation, list re-rendered often)
  els.subjectPicker.addEventListener('click', (e) => {
    const addBtn = e.target.closest('#addSubjectFromTimer');
    if (addBtn) { openSubjectModal(null); return; }
    const chip = e.target.closest('.subject-chip[data-subject-id]');
    if (!chip) return;
    pendingSubjectId = chip.dataset.subjectId;
    renderSubjectPicker();
    updateStartButton();
  });

  $$('#modeToggle .mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingMode = btn.dataset.mode;
      renderModeToggle();
    });
  });

  els.startBtn.addEventListener('click', () => {
    if (!pendingSubjectId) return;
    startTimer(pendingSubjectId, pendingMode);
    updateHeaderMeta();
  });

  els.pauseResumeBtn.addEventListener('click', () => {
    const s = data.activeSession;
    if (!s) return;
    if (s.status === 'running') pauseTimer();
    else resumeTimer();
  });

  els.finishBtn.addEventListener('click', () => {
    finishTimer();
    updateHeaderMeta();
  });

  els.discardBtn.addEventListener('click', () => {
    discardTimer();
    updateHeaderMeta();
  });

  // Dashboard range switch
  els.rangeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    chartRangeDays = Number(btn.dataset.range);
    $$('#rangeSwitch button').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderDashboard();
  });

  // History
  els.addSessionBtn.addEventListener('click', () => openSessionModal(null));
  els.historyContent.addEventListener('click', (e) => {
    const row = e.target.closest('.session-row[data-session-id]');
    if (!row) return;
    const session = data.sessions.find((s) => s.id === row.dataset.sessionId);
    if (session) openSessionModal(session);
  });

  // Settings: subjects
  els.addSubjectBtn.addEventListener('click', () => openSubjectModal(null));
  els.subjectSettingsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-subject]');
    if (!btn) return;
    const subject = getSubject(btn.dataset.editSubject);
    if (subject) openSubjectModal(subject);
  });

  // Settings: weekly target
  els.weeklyTargetInput.addEventListener('change', () => {
    const hours = parseFloat(els.weeklyTargetInput.value);
    data.settings.weeklyTargetMinutes = Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 60) : 0;
    saveImmediate();
    if (currentScreen === 'dashboard') renderDashboard();
  });

  // Settings: theme
  els.themeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (!btn) return;
    data.settings.theme = btn.dataset.theme;
    saveImmediate();
    applyTheme();
    renderSettings();
  });

  // Settings: data actions
  els.exportBtn.addEventListener('click', exportDataFile);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files[0];
    if (file) importDataFromFile(file);
    els.importFile.value = '';
  });
  els.resetBtn.addEventListener('click', handleResetAllData);

  // Modals: forms
  els.sessionForm.addEventListener('submit', handleSessionFormSubmit);
  els.deleteSessionBtn.addEventListener('click', handleDeleteSession);
  $$('#sessionModeToggle .mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sessionModalMode = btn.dataset.mode;
      updateSessionModeButtons();
    });
  });

  els.subjectForm.addEventListener('submit', handleSubjectFormSubmit);
  els.deleteSubjectBtn.addEventListener('click', handleDeleteSubject);
  els.colorGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    selectedColor = btn.dataset.color;
    renderColorGrid();
  });

  // Modal close (X buttons + backdrop click)
  $$('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(btn.closest('.modal-backdrop'));
    });
  });
  [els.sessionModalBackdrop, els.subjectModalBackdrop].forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });

  // Header shadow on scroll
  window.addEventListener('scroll', () => {
    els.header.classList.toggle('is-scrolled', window.scrollY > 4);
  }, { passive: true });

  // Keep timer accurate across backgrounding / lock / refresh
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data.activeSession) {
      renderTimerActiveFrame();
      if (data.activeSession.status === 'running') startTicking();
    }
  });
  window.addEventListener('pageshow', () => {
    if (data.activeSession) {
      renderTimerActiveFrame();
      if (data.activeSession.status === 'running') startTicking();
    }
  });
  window.addEventListener('focus', () => {
    if (data.activeSession) renderTimerActiveFrame();
  });

  window.addEventListener('resize', debounce(() => {
    if (currentScreen === 'dashboard') renderDashboard();
  }, 200));

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (data.settings.theme === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  setInterval(updateHeaderMeta, 60000);
}

/* ============================================================
   Init
   ============================================================ */

function init() {
  data = loadData();
  cacheEls();
  applyTheme();
  wireEvents();

  els.timerRingProgress.style.strokeDasharray = String(RING_CIRC);
  els.timerRingProgress.style.strokeDashoffset = String(RING_CIRC);

  pendingSubjectId = data.subjects.length ? data.subjects[0].id : null;
  pendingMode = 'study';

  navigate('timer');
  updateHeaderMeta();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
