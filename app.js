import * as db from './db.js';
import * as timer from './timer.js';
import { CLIMB_EXERCISES, GYM_PRESETS, SECTIONS, V_SCALE } from './defaults.js';
import { TRAINING_TYPES, icon } from './icons.js';
import { APP_VERSION, CHANGES } from './changelog.js';
import { createMapViewer } from './map.js';

const state = { tab: 'train', plans: [], sessions: [], climbs: [], settings: null, climbFilter: 'all', gradeFilter: null };
const openNotes = new Set();
const openTips = new Set();
const STATUS = { project: 'Project', sent: 'Sent', flash: 'Flash' };
const REST_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 420, 600];

const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'open') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const fmtTime = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDuration = ms => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const toDateInput = ts => { const d = new Date(ts); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// Grades come from the chosen scale; climbs logged under the other scale still show their own grade
const gymById = id => state.settings.gyms.find(g => g.id === id);
const activeGym = () => gymById(state.settings.activeGymId) ?? state.settings.gyms[0];
const gymGrades = gym => (gym?.scale === 'v' ? V_SCALE : gym?.grades ?? []);
const activeGrades = () => gymGrades(activeGym());
const grade = (id, gymId) => gymGrades(gymById(gymId)).find(g => g.id === id) ?? activeGrades().find(g => g.id === id)
  ?? state.settings.gyms.flatMap(gymGrades).find(g => g.id === id) ?? V_SCALE.find(g => g.id === id)
  ?? { id, name: '?', color: '#888888' };
const gradeIndex = id => activeGrades().findIndex(g => g.id === id);
const swatch = (id, cls = '', gymId) => h('span', { class: `swatch ${cls}`, style: { background: grade(id, gymId).color } });
// Climbs remember which gym they were logged at; older climbs, or ones from a deleted gym, count as the first gym
const climbGymId = c => (gymById(c.gymId) ? c.gymId : state.settings.gyms[0]?.id);
const climbGrade = c => {
  const g = grade(c.grade, climbGymId(c));
  // Fall back to the name and colour saved with the climb (e.g. its gym was deleted)
  return g.name === '?' && c.gradeName ? { id: c.grade, name: c.gradeName, color: c.gradeColor } : g;
};
const climbSwatch = (c, cls = '') => h('span', { class: `swatch ${cls}`, style: { background: climbGrade(c).color } });
const inActiveGym = c => climbGymId(c) === activeGym()?.id;
const activeSession = () => state.sessions.find(s => !s.endedAt);
const repsLabel = e => (e.sets > 1 ? `${e.sets} × ${e.reps || 'sets'}` : e.reps || '1 set');
const setCounts = s => s.exercises.map(exCounts).reduce((n, c) => [n[0] + c[0], n[1] + c[1]], [0, 0]);
const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2200);
}

// Persistence: state arrays mirror the IndexedDB stores
async function save(store, obj) {
  const list = state[store];
  const i = list.findIndex(x => x.id === obj.id);
  if (i >= 0) list[i] = obj; else if (store === 'plans') list.push(obj); else list.unshift(obj);
  await db.put(store, obj);
}
async function remove(store, id) {
  state[store] = state[store].filter(x => x.id !== id);
  await db.del(store, id);
}
const pending = new Map();
function saveLater(store, obj) {
  clearTimeout(pending.get(obj.id)?.t);
  pending.set(obj.id, { store, obj, t: setTimeout(() => { pending.delete(obj.id); db.put(store, obj); }, 400) });
}
function flushPending() {
  for (const [id, p] of pending) { clearTimeout(p.t); db.put(p.store, p.obj); pending.delete(id); }
}
const saveSettings = () => db.put('meta', state.settings);

// Photos are stored as compressed JPEG blobs
const photoUrls = new Map();
function photoUrl(id) {
  if (!photoUrls.has(id)) photoUrls.set(id, db.get('photos', id).then(p => (p ? URL.createObjectURL(p.blob) : '')));
  return photoUrls.get(id);
}
function photoImg(id, cls) {
  const img = h('img', { class: cls, alt: '', loading: 'lazy' });
  photoUrl(id).then(u => { if (u) img.src = u; });
  return img;
}
function drawToJpeg(source, width, height, max = 1600, quality = 0.82) {
  const scale = Math.min(1, max / Math.max(width, height));
  const c = document.createElement('canvas');
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

async function compressImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return await drawToJpeg(img, img.naturalWidth, img.naturalHeight, max);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Grab one frame from a video (about 40% in, past the chalking-up) and keep it as a photo; the video isn't stored
async function videoThumbnail(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    const wait = event => new Promise((res, rej) => {
      v.addEventListener(event, res, { once: true });
      v.addEventListener('error', () => rej(v.error), { once: true });
    });
    const loaded = wait('loadeddata');
    v.src = url;
    v.load();
    await loaded;
    const seeked = wait('seeked');
    v.currentTime = Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 0.4 : 0.1;
    await seeked;
    return await drawToJpeg(v, v.videoWidth, v.videoHeight);
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
// Open layers (sheets, session panel, photo) keep one extra history entry alive so Android's back gesture
// closes the top layer instead of leaving the app
const layers = [];
let layerSeq = 0;
let armed = false;
let ignorePop = false;

function arm() {
  if (armed) return;
  history.pushState({ betalab: true }, '');
  armed = true;
}
function pushLayer(close) {
  const id = ++layerSeq;
  layers.push({ id, close });
  arm();
  return id;
}
// The app closed a layer itself; once nothing is open (and nothing reopened straight away), drop the extra entry
function dropLayer(id) {
  const i = layers.findIndex(l => l.id === id);
  if (i < 0) return;
  layers.splice(i, 1);
  if (!layers.length) setTimeout(() => {
    if (layers.length || !armed) return;
    armed = false;
    ignorePop = true;
    history.back();
  }, 0);
}
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  armed = false;
  layers.pop()?.close();
  if (layers.length) arm();
});

function lightbox(src) {
  const box = h('div', { class: 'lightbox' }, h('img', { src, alt: '' }));
  const id = pushLayer(() => box.remove());
  box.addEventListener('click', () => { box.remove(); dropLayer(id); });
  document.body.append(box);
}

// Vertical drag on a handle: drag the panel down past a threshold (or flick) to dismiss; a flick up calls onUp
function dragGesture(handle, panel, { onDown, onUp } = {}) {
  let startY = null, startT = 0, dy = 0;
  handle.addEventListener('pointerdown', e => {
    const control = e.target.closest('button, input, textarea, select, a, label');
    if (control && control !== handle) return;
    startY = e.clientY; startT = e.timeStamp; dy = 0;
    handle.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  });
  handle.addEventListener('pointermove', e => {
    if (startY == null) return;
    dy = e.clientY - startY;
    if (onDown) panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
  });
  const end = e => {
    if (startY == null) return;
    const speed = dy / Math.max(1, e.timeStamp - startT);
    startY = null;
    panel.style.transition = '';
    if (onDown && (dy > 110 || (dy > 30 && speed > 0.5))) {
      panel.style.transform = 'translateY(100%)';
      setTimeout(onDown, 180);
    } else {
      panel.style.transform = '';
      if (onUp && (dy < -30 || (dy < -10 && speed < -0.4))) onUp();
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// Bottom sheets (stackable). onClose runs however the sheet goes away: button, swipe, tap outside or back
function openSheet(title, body, actions = [], { onClose } = {}) {
  const head = h('div', { class: 'sheet-head' },
    h('span', { class: 'grabber', 'aria-hidden': 'true' }),
    h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeSheet }, '✕'));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    head,
    h('div', { class: 'sheet-body' }, body),
    actions.filter(Boolean).length ? h('div', { class: 'sheet-actions' }, actions) : null);
  const overlay = h('div', { class: 'overlay' }, sheet);
  overlay._onClose = onClose;
  overlay.dataset.layer = pushLayer(() => removeOverlay(overlay));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
  dragGesture(head, sheet, { onDown: closeSheet });
  document.body.append(overlay);
  document.body.classList.add('sheet-open');
}
function removeOverlay(overlay) {
  overlay.remove();
  if (!document.querySelector('.overlay')) document.body.classList.remove('sheet-open');
  overlay._onClose?.();
}
function closeSheet() {
  const all = document.querySelectorAll('.overlay');
  const top = all[all.length - 1];
  if (!top) return;
  dropLayer(Number(top.dataset.layer));
  removeOverlay(top);
}

function render() {
  const main = document.getElementById('main');
  const y = window.scrollY;
  const same = main.dataset.tab === state.tab;
  const views = { train: trainView, climbs: climbsView, progress: progressView, map: mapView, settings: settingsView };
  main.replaceChildren(views[state.tab]());
  main.dataset.tab = state.tab;
  window.scrollTo(0, same ? y : 0);
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  renderSession();
  renderBars();
  tickClocks();
}

// Minimised things (running session, plan being edited) stack as bars above the tabs
function renderBars() {
  let box = document.getElementById('mini-bars');
  if (!box) { box = h('div', { id: 'mini-bars', class: 'mini-bars' }); document.body.append(box); }
  const bars = [];
  const s = activeSession();
  if (s && !state.sessionOpen) {
    const [done, total] = setCounts(s);
    const bar = h('button', { class: 'mini-bar', 'aria-label': `Open ${s.name}`, onclick: openSession },
      h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'grow mini-name' }, s.name),
      h('span', { class: 'mini-meta' }, h('span', { 'data-clock': s.startedAt }), total ? ` · ${done}/${total}` : ''),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '⌃'));
    dragGesture(bar, bar, { onUp: openSession });
    bars.push(bar);
  }
  const d = state.planDraft;
  if (d && !d.open) {
    const bar = h('button', { class: 'mini-bar draft', 'aria-label': `Continue editing ${d.plan.name || 'new plan'}`, onclick: resumeDraft },
      icon('edit'),
      h('span', { class: 'grow mini-name' }, `Editing ${d.plan.name || 'new plan'}`),
      h('span', { class: 'mini-meta' }, 'unsaved'),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '⌃'));
    dragGesture(bar, bar, { onUp: resumeDraft });
    bars.push(bar);
  }
  box.replaceChildren(...bars);
  document.body.style.setProperty('--bars', bars.length);
  tickClocks();
}

const fmtClock = ms => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = String(t % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
function tickClocks() {
  document.querySelectorAll('[data-clock]').forEach(el => { el.textContent = fmtClock(Date.now() - Number(el.dataset.clock)); });
}

// The running session lives in its own panel: full-height when open, a mini bar above the tabs when minimised
let sessionPanel = null;
let sessionLayer = null;
let showRestChips = false;

function renderSession() {
  const s = activeSession();
  const open = !!s && state.sessionOpen;
  document.body.classList.toggle('session-open', open);
  if (!open) {
    sessionPanel?.remove();
    sessionPanel = null;
    if (sessionLayer) { dropLayer(sessionLayer); sessionLayer = null; }
    return;
  }

  // Reuse the open panel so the scroll position survives re-renders
  let body = sessionPanel?.querySelector('.session-body');
  const scroll = body?.scrollTop ?? 0;
  if (!body) {
    body = h('div', { class: 'session-body' });
    sessionPanel = h('div', { class: 'session-panel', role: 'dialog', 'aria-label': 'Current session' }, h('div', { class: 'session-head' }), body);
    document.body.append(sessionPanel);
    // Back gesture minimises the session (the layer is already gone from the stack when this runs)
    sessionLayer = pushLayer(() => { sessionLayer = null; minimiseSession(); });
  }
  const head = sessionHeader(s);
  sessionPanel.querySelector('.session-head').replaceWith(head);
  dragGesture(head, sessionPanel, { onDown: minimiseSession });
  body.replaceChildren(sessionView(s));
  body.scrollTop = scroll;
}

function openSession() { state.sessionOpen = true; render(); }
function minimiseSession() { state.sessionOpen = false; showRestChips = false; render(); }

function sessionHeader(s) {
  return h('div', { class: 'session-head' },
    h('span', { class: 'grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'session-head-row' },
      h('button', { class: 'btn small primary', onclick: () => finishSession(s) }, 'Finish'),
      h('div', { class: 'session-clock' },
        h('div', { class: 'clock', 'data-clock': s.startedAt }, fmtClock(Date.now() - s.startedAt)),
        h('div', { class: 'clock-name' }, s.name)),
      h('button', {
        class: `btn small${showRestChips ? ' on' : ''}`, 'aria-label': 'Quick rest timer', 'aria-expanded': String(showRestChips),
        onclick: () => { showRestChips = !showRestChips; render(); },
      }, '⏱ Rest')),
    showRestChips && h('div', { class: 'chip-row rest-chips' }, [30, 60, 90, 120, 180, 240].map(sec =>
      h('button', { class: 'chip', onclick: () => { timer.start(sec); showRestChips = false; render(); } }, fmtTime(sec)))));
}

async function finishSession(s, endAt = Date.now()) {
  flushPending();
  s.endedAt = Math.max(endAt, s.startedAt);
  await save('sessions', s);
  timer.stop();
  state.sessionOpen = false;
  render();
  toast('Session saved 💪');
  maybeRemindBackup();
}

// Long-press opens the plan's menu; a normal tap starts it
function planCard(p) {
  let pressTimer = null, longPressed = false, startX = 0, startY = 0;
  const cancel = () => clearTimeout(pressTimer);
  const main = h('button', {
    class: 'plan-main', 'aria-label': `Start ${p.name}`,
    onclick: e => { if (longPressed) { e.preventDefault(); longPressed = false; return; } confirmStart(p); },
    oncontextmenu: e => e.preventDefault(),
    onpointerdown: e => {
      longPressed = false; startX = e.clientX; startY = e.clientY;
      pressTimer = setTimeout(() => { longPressed = true; navigator.vibrate?.(10); planMenu(p); }, 500);
    },
    onpointermove: e => { if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); },
    onpointerup: cancel,
    onpointercancel: cancel,
    onpointerleave: cancel,
  },
    icon(p.type || 'climb', 'type-badge'),
    h('div', { class: 'grow' },
      h('div', { class: 'card-title' }, p.name),
      trainingType(p.type) && h('p', { class: 'type-label' }, trainingType(p.type).name),
      p.description && h('p', { class: 'muted small' }, p.description)));
  return h('div', { class: 'card plan-card' }, main,
    h('button', { class: 'icon-btn meatball', 'aria-label': `${p.name} options`, onclick: () => planMenu(p) }, '⋯'));
}

const trainingType = id => TRAINING_TYPES.find(t => t.id === id);

// How-to text clamped to ~2 lines; tap to show it all (only offers "more" when it actually overflows)
function tipText(text, key) {
  const p = h('p', {
    class: `tip-text${openTips.has(key) ? ' open' : ''}`,
    onclick: e => {
      const overflowing = p.scrollHeight > p.clientHeight + 1;
      if (!overflowing && !p.classList.contains('open')) return;
      e.stopPropagation();
      p.classList.toggle('open');
      openTips.has(key) ? openTips.delete(key) : openTips.add(key);
    },
  }, text);
  // Fade the last line only when the text is actually cut off
  new ResizeObserver(() => p.classList.toggle('clamped', p.scrollHeight > p.clientHeight + 1)).observe(p);
  return p;
}

function confirmStart(p) {
  if (activeSession()) { startSession(p); return; }
  const sets = p.exercises.reduce((n, e) => n + e.sets, 0);
  openSheet('Start session?', h('div', { class: 'confirm-start' },
    icon(p.type || 'climb', 'type-badge lg'),
    h('div', {},
      h('div', { class: 'card-title' }, p.name),
      h('p', { class: 'muted small' }, [trainingType(p.type)?.name, `${p.exercises.length} exercises`, `${sets} sets`].filter(Boolean).join(' · ')))), [
    h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => { closeSheet(); startSession(p); } }, 'Start'),
  ]);
}

// Train tab
function trainView() {
  const history = state.sessions.filter(s => s.endedAt).sort((a, b) => b.startedAt - a.startedAt);
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Train')),
    h('h3', { class: 'section-title' }, 'Start a session'),
    state.plans.length
      ? state.plans.map(planCard)
      : h('div', { class: 'card empty-plans' },
        h('div', { class: 'card-title' }, 'No plans yet'),
        h('p', { class: 'muted small' }, 'Tap “+ New plan” to build your first session, or start an empty one and add exercises as you go.')),
    h('div', { class: 'btn-pair' },
      h('button', { class: 'btn ghost', onclick: () => planSheet(null) }, '+ New plan'),
      h('button', { class: 'btn ghost', onclick: () => startSession(null) }, 'Empty session')),
    h('h3', { class: 'section-title' }, 'Quick rest timer'),
    h('div', { class: 'chip-row' }, [60, 90, 120, 180, 240, 300].map(sec =>
      h('button', { class: 'chip', onclick: () => timer.start(sec) }, fmtTime(sec)))),
    h('div', { class: 'section-row' },
      h('h3', { class: 'section-title' }, 'Recent sessions'),
      history.length > 3 && h('button', { class: 'btn small ghost', onclick: sessionsSheet }, `See all ${history.length}`)),
    history.length ? history.slice(0, 3).map(historyRow) : h('p', { class: 'muted small' }, 'Finished sessions show up here.'));
}

function historyRow(s) {
  const [done, total] = setCounts(s);
  const climbs = state.climbs.filter(c => c.sessionId === s.id).length;
  const gym = state.settings.gyms.length > 1 && gymById(s.gymId)?.name;
  const bits = [fmtDate(s.startedAt), fmtDuration(s.endedAt - s.startedAt) + (s.timeEdited ? ' (edited)' : ''), gym,
    total && `${done}/${total} sets`, climbs && `${climbs} climb${climbs > 1 ? 's' : ''}`];
  return h('button', { class: 'card list-row', onclick: () => sessionSheet(s) },
    h('div', { class: 'grow' },
      h('div', { class: 'card-title' }, s.name),
      h('p', { class: 'muted small' }, bits.filter(Boolean).join(' · '))),
    h('span', { class: 'chev' }, '›'));
}

async function startSession(plan, name) {
  if (activeSession()) {
    toast('Finish your current session first');
    openSession();
    return;
  }
  const s = {
    id: uid(), planId: plan?.id ?? null, name: plan?.name ?? name ?? 'Session', startedAt: Date.now(), endedAt: null, notes: '', gymId: activeGym().id,
    exercises: (plan?.exercises ?? []).map(e => ({ ...e, id: uid(), done: Array(e.sets).fill(false), note: '', climbIds: [], climbDone: {} })),
  };
  await save('sessions', s);
  state.sessionOpen = true;
  render();
}

function sessionView(s) {
  const [done, total] = setCounts(s);
  const sections = new Map();
  for (const e of s.exercises) {
    const key = e.section || 'Main';
    sections.set(key, [...(sections.get(key) ?? []), e]);
  }
  const climbs = state.climbs.filter(c => c.sessionId === s.id);
  return h('div', {},
    h('div', { class: 'progress' }, h('div', { style: { width: `${total ? (done / total) * 100 : 0}%` } })),
    h('p', { class: 'muted small', style: { marginTop: '6px' } }, `${done} of ${total} sets done`),
    h('button', { class: 'btn primary full', onclick: () => climbSheet(null, s.id) }, '📷 Add climb'),
    [...sections].map(([name, list]) => [h('h3', { class: 'section-title' }, name), list.map(e => exerciseCard(s, e))]),
    h('button', {
      class: 'btn ghost full',
      onclick: () => exerciseSheet(null, ex => {
        s.exercises.push({ ...ex, id: uid(), done: Array(ex.sets).fill(false), note: '', climbIds: [], climbDone: {} });
        save('sessions', s);
        render();
      }),
    }, '+ Add exercise'),
    climbs.length ? [h('h3', { class: 'section-title' }, 'Climbs this session'), h('div', { class: 'climb-grid' }, climbs.map(c => climbTile(c)))] : null,
    h('h3', { class: 'section-title' }, 'Session notes'),
    h('textarea', {
      class: 'input', rows: 3, placeholder: 'How did it feel? Skin, energy, beta…', value: s.notes,
      oninput: e => { s.notes = e.target.value; saveLater('sessions', s); },
    }),
    h('button', {
      class: 'btn danger full',
      onclick: async () => {
        if (!confirm('Discard this session? Climbs you logged stay in your climb log.')) return;
        timer.stop();
        await remove('sessions', s.id);
        state.sessionOpen = false;
        render();
      },
    }, 'Discard session'));
}

function exerciseCard(s, e) {
  const [doneCount, totalCount] = exCounts(e);
  const complete = totalCount > 0 && doneCount === totalCount;
  const hasClimbs = linkedClimbs(e).length > 0;
  const showNote = openNotes.has(e.id) || e.note;
  const meta = [repsLabel(e), e.rest ? `rest ${fmtTime(e.rest)}` : null].filter(Boolean).join(' · ');
  return h('div', { class: `card ex-card${complete ? ' complete' : ''}` },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'card-title' }, e.name), h('p', { class: 'muted small' }, meta)),
      h('button', {
        class: 'icon-btn', 'aria-label': 'Add note',
        onclick: () => { openNotes.has(e.id) ? openNotes.delete(e.id) : openNotes.add(e.id); render(); },
      }, '✎')),
    e.tip && tipText(e.tip, e.id),
    !hasClimbs && h('div', { class: 'sets' },
      e.done.map((d, i) => h('button', {
        class: `set${d ? ' done' : ''}`, 'aria-label': `Set ${i + 1}${d ? ' done' : ''}`,
        onclick: () => toggleSet(s, e, i),
      }, d ? '✓' : i + 1)),
      h('button', {
        class: 'set add', 'aria-label': 'Add a set',
        onclick: () => addRound(s, e),
      }, '+')),
    e.trackClimbs && exerciseClimbs(s, e),
    showNote && h('textarea', {
      class: 'input ex-note', rows: 2, placeholder: 'Notes: weight used, how it felt…', value: e.note || '',
      oninput: ev => { e.note = ev.target.value; saveLater('sessions', s); },
    }));
}

// Climbs attached to an exercise each get a dot per round; a round is done when every climb in it is ticked
const linkedClimbs = e => (e.climbIds ?? []).map(id => state.climbs.find(c => c.id === id)).filter(Boolean);

function exCounts(e) {
  const climbs = linkedClimbs(e);
  if (!climbs.length) return [e.done.filter(Boolean).length, e.done.length];
  return [climbs.reduce((n, c) => n + e.climbDone[c.id].filter(Boolean).length, 0), climbs.length * e.done.length];
}

// Remember when the session was last used, so a forgotten session can be finished at the right time
const touch = s => { s.lastActivityAt = Date.now(); };

function addRound(s, e) {
  touch(s);
  e.done.push(false);
  for (const arr of Object.values(e.climbDone ?? {})) arr.push(false);
  e.sets = e.done.length;
  save('sessions', s);
  render();
}

function syncRounds(e) {
  const climbs = linkedClimbs(e);
  if (climbs.length) e.done = e.done.map((_, i) => climbs.every(c => e.climbDone[c.id]?.[i]));
}

function exerciseClimbs(s, e) {
  return h('div', { class: 'ex-climbs' },
    linkedClimbs(e).map(c => h('div', { class: 'ex-climb' },
      h('button', { class: 'ex-climb-thumb', 'aria-label': `Edit ${c.name || climbGrade(c).name}`, onclick: () => climbSheet(c) },
        c.photoIds?.[0] ? photoImg(c.photoIds[0]) : h('span', { style: { background: climbGrade(c).color } })),
      h('div', { class: 'grow' },
        h('div', { class: 'row tight' },
          climbSwatch(c),
          h('strong', { class: 'grow ex-climb-name' }, c.name || climbGrade(c).name),
          h('button', {
            class: 'icon-btn sm', 'aria-label': 'Remove from exercise',
            onclick: () => {
              e.climbIds = e.climbIds.filter(id => id !== c.id);
              delete e.climbDone[c.id];
              syncRounds(e);
              save('sessions', s);
              render();
            },
          }, '✕')),
        h('div', { class: 'sets sm' }, (e.climbDone[c.id] ?? []).map((d, i) => h('button', {
          class: `set${d ? ' done' : ''}`, 'aria-label': `Round ${i + 1}${d ? ' done' : ''}`,
          onclick: () => toggleClimbRound(s, e, c.id, i),
        }, d ? '✓' : i + 1)))))),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn small ghost', onclick: () => attachClimbSheet(s, e) }, '+ Add climb to this'),
      linkedClimbs(e).length ? h('button', { class: 'btn small ghost', onclick: () => addRound(s, e) }, '+ Round') : null));
}

function toggleSet(s, e, i) {
  touch(s);
  const value = !e.done[i];
  for (const c of linkedClimbs(e)) e.climbDone[c.id][i] = value;
  e.done[i] = value;
  if (value && e.rest > 0) timer.start(e.rest, `Rest · ${e.name}`);
  save('sessions', s);
  render();
}

function toggleClimbRound(s, e, climbId, i) {
  touch(s);
  const wasDone = e.done[i];
  e.climbDone[climbId][i] = !e.climbDone[climbId][i];
  syncRounds(e);
  if (!wasDone && e.done[i] && e.rest > 0) timer.start(e.rest, `Round ${i + 1} rest · ${e.name}`);
  save('sessions', s);
  render();
}

function attachClimbSheet(s, e) {
  const attach = c => {
    e.climbIds ??= [];
    e.climbDone ??= {};
    if (!e.climbIds.includes(c.id)) {
      e.climbIds.push(c.id);
      e.climbDone[c.id] = Array(e.done.length).fill(false);
    }
    syncRounds(e);
    save('sessions', s);
    render();
  };
  const recent = state.climbs.filter(c => !e.climbIds?.includes(c.id)).sort((a, b) => b.date - a.date).slice(0, 24);
  openSheet(`Add climb to ${e.name}`, h('div', {},
    h('button', { class: 'btn primary full', style: { marginTop: 0 }, onclick: () => { closeSheet(); climbSheet(null, s.id, attach); } }, '📷 New climb'),
    recent.length ? [
      h('h3', { class: 'section-title' }, 'Or pick one you’ve logged'),
      h('div', { class: 'climb-grid' }, recent.map(c => climbTile(c, () => { closeSheet(); attach(c); }))),
    ] : null));
}

function sessionsSheet() {
  const history = state.sessions.filter(s => s.endedAt).sort((a, b) => b.startedAt - a.startedAt);
  openSheet('Sessions', h('div', {},
    history.length ? history.map(historyRow) : h('p', { class: 'muted' }, 'No finished sessions yet.')));
}

// If a session has sat untouched for hours, ask whether it's still going rather than letting the clock run on
const FORGOTTEN_AFTER = 2 * 3600000;
let forgottenPromptFor = null;

function checkForgottenSession() {
  const s = activeSession();
  if (!s || forgottenPromptFor === s.id) return;
  const last = Math.max(s.lastActivityAt ?? s.startedAt, s.keepGoingAt ?? 0);
  if (Date.now() - last < FORGOTTEN_AFTER) return;
  const lastWork = s.lastActivityAt ?? s.startedAt;
  const at = new Date(lastWork).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const ago = fmtDuration(Date.now() - lastWork);
  forgottenPromptFor = s.id;
  openSheet('Still climbing?', h('div', {},
    h('p', {}, `“${s.name}” is still running. ${s.lastActivityAt ? `Your last set was at ${at}, ${ago} ago.` : `It started at ${at}, ${ago} ago.`}`),
    h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Finish it at that time so your session length stays accurate.')), [
    h('button', {
      class: 'btn',
      onclick: async () => { s.keepGoingAt = Date.now(); await save('sessions', s); closeSheet(); },
    }, 'Keep going'),
    h('button', { class: 'btn primary', onclick: () => { closeSheet(); finishSession(s, lastWork); } }, `Finish at ${at}`),
  ], { onClose: () => { forgottenPromptFor = null; } });
}

const toTimeInput = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function editSessionTimeSheet(s, onDone) {
  const mins = Math.max(0, Math.round((s.endedAt - s.startedAt) / 60000));
  const t = { date: toDateInput(s.startedAt), time: toTimeInput(s.startedAt), hours: Math.floor(mins / 60), minutes: mins % 60 };
  const num = (label, key, max) => field(label, h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', min: 0, max, value: t[key],
    oninput: e => { t[key] = Number(e.target.value) || 0; },
  }));
  openSheet('Edit session time', h('div', {},
    h('p', { class: 'muted small' }, 'For fixing a forgotten Finish, or logging a session after the fact.'),
    h('div', { class: 'field-row' },
      field('Date', h('input', { class: 'input', type: 'date', value: t.date, onchange: e => { t.date = e.target.value; } })),
      field('Start time', h('input', { class: 'input', type: 'time', value: t.time, onchange: e => { t.time = e.target.value; } }))),
    h('div', { class: 'field-row' }, num('Hours', 'hours', 12), num('Minutes', 'minutes', 59))), [
    h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        const start = new Date(`${t.date}T${t.time || '00:00'}`).getTime();
        const length = (Math.min(t.hours, 24) * 60 + Math.min(t.minutes, 59)) * 60000;
        if (!Number.isFinite(start)) { toast('Check the date and time'); return; }
        if (!length) { toast('A session needs a length'); return; }
        Object.assign(s, { startedAt: start, endedAt: start + length, timeEdited: true });
        await save('sessions', s);
        closeSheet();
        onDone();
      },
    }, 'Save'),
  ]);
}

function sessionSheet(s) {
  const climbs = state.climbs.filter(c => c.sessionId === s.id);
  const reopen = () => { closeSheet(); sessionSheet(s); render(); };
  const body = h('div', {},
    h('div', { class: 'row' },
      h('p', { class: 'muted grow' }, `${fmtDate(s.startedAt)} · ${new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${fmtDuration(s.endedAt - s.startedAt)}`,
        s.timeEdited ? h('span', { class: 'edited-tag' }, 'edited') : null),
      h('button', { class: 'btn small', onclick: () => editSessionTimeSheet(s, reopen) }, icon('edit'), 'Edit time')),
    s.exercises.length ? h('h3', { class: 'section-title' }, 'Exercises') : null,
    s.exercises.map(e => h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'grow card-title' }, e.name),
        h('span', { class: 'muted small' }, exCounts(e).join('/'))),
      linkedClimbs(e).length ? h('p', { class: 'muted small' }, linkedClimbs(e).map(c => c.name || climbGrade(c).name).join(', ')) : null,
      e.note && h('p', { class: 'small', style: { marginTop: '4px' } }, e.note))),
    climbs.length ? [h('h3', { class: 'section-title' }, 'Climbs'), h('div', { class: 'climb-grid' }, climbs.map(c => climbTile(c)))] : null,
    h('h3', { class: 'section-title' }, 'Notes'),
    h('textarea', {
      class: 'input', rows: 3, value: s.notes, placeholder: 'Session notes',
      oninput: e => { s.notes = e.target.value; saveLater('sessions', s); },
    }));
  openSheet(s.name, body, [
    h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm('Delete this session from your history?')) return;
        await remove('sessions', s.id);
        const fromList = document.querySelectorAll('.overlay').length > 1;
        closeSheet();
        // Refresh the sessions list underneath so the deleted one disappears
        if (fromList) { closeSheet(); sessionsSheet(); }
        render();
      },
    }, 'Delete'),
    h('button', { class: 'btn primary', onclick: () => { flushPending(); closeSheet(); render(); } }, 'Done'),
  ]);
}

// Climbs tab
function climbsView() {
  const f = state.climbFilter;
  const g = state.gradeFilter;
  const list = state.climbs
    .filter(c => inActiveGym(c) && (f === 'all' || (f === 'project' ? c.status === 'project' : c.status !== 'project')) && (!g || c.grade === g))
    .sort((a, b) => b.date - a.date);
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Climbs'),
      h('div', { class: 'row' },
        !activeSession() && h('button', { class: 'btn ghost', 'aria-label': 'Start a climbing session', onclick: confirmClimbingSession }, icon('play'), 'Session'),
        h('button', { class: 'btn primary', onclick: () => climbSheet(null) }, '+ Add climb'))),
    gymSwitcher(),
    h('div', { class: 'seg' }, [['all', 'All'], ['project', 'Projects'], ['sent', 'Sent']].map(([k, label]) =>
      h('button', { class: f === k ? 'on' : '', onclick: () => { state.climbFilter = k; render(); } }, label))),
    h('div', { class: 'chip-row' }, activeGrades().map(gr =>
      h('button', {
        class: `chip${g === gr.id ? ' on' : ''}`,
        onclick: () => { state.gradeFilter = g === gr.id ? null : gr.id; render(); },
      }, swatch(gr.id), gr.name))),
    list.length
      ? h('div', { class: 'climb-grid', style: { marginTop: '8px' } }, list.map(c => climbTile(c)))
      : h('div', { class: 'empty' }, state.climbs.length ? 'Nothing matches that filter.' : 'No climbs yet. Tap “Add climb” and snap a photo of your first one.'));
}

// Quick switch between gyms (only shown once there's more than one)
function gymSwitcher() {
  const gyms = state.settings.gyms;
  if (gyms.length < 2) return null;
  return h('div', { class: 'chip-row gym-row' }, gyms.map(gym => h('button', {
    class: `chip${gym.id === activeGym().id ? ' on' : ''}`,
    onclick: () => setActiveGym(gym.id),
  }, icon('climb'), gym.name)));
}

async function setActiveGym(id) {
  state.settings.activeGymId = id;
  state.gradeFilter = null;
  await saveSettings();
  render();
}

function confirmClimbingSession() {
  const name = `Climbing · ${activeGym().name}`;
  openSheet('Start a climbing session?', h('div', {},
    h('p', {}, name),
    h('p', { class: 'muted small', style: { marginTop: '6px' } }, 'No plan, just climbing. Climbs you add while it’s running are saved to it.')), [
    h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => { closeSheet(); startSession(null, name); } }, 'Start'),
  ]);
}

// Map tab: a photo of the gym's map with climbs pinned on it
const RECENT_DAYS = 42;
const mapViews = {};

function pinFor(c, extra = {}) {
  return { id: c.id, x: c.pin.x, y: c.pin.y, color: climbGrade(c).color, ring: c.status === 'project', label: c.name || climbGrade(c).name, item: c, ...extra };
}

function climbsHereSheet(climbs) {
  openSheet(`${climbs.length} climbs here`, h('div', { class: 'climb-grid' },
    [...climbs].sort((a, b) => b.date - a.date).map(c => climbTile(c, () => { closeSheet(); climbSheet(c); }))));
}

function mapView() {
  const gym = activeGym();
  const head = h('header', { class: 'page-head' }, h('h1', {}, 'Map'),
    gym.map && h('button', { class: 'btn small ghost', onclick: () => mapOptionsSheet(gym) }, 'Map options'));
  if (!gym.map) {
    return h('div', {}, head, gymSwitcher(),
      h('div', { class: 'card empty-map' },
        icon('map', 'type-badge lg'),
        h('div', { class: 'card-title' }, `Add a map of ${gym.name}`),
        h('p', { class: 'muted small' }, 'Take a photo of the gym’s floor plan or wall map, or use a screenshot from their website. Then pin climbs to see where everything is.'),
        h('label', { class: 'btn primary' }, icon('map'), 'Add map', gymMapInput(gym))));
  }
  const f = state.mapFilter ?? 'recent';
  const g = state.mapGrade;
  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  const inGym = state.climbs.filter(inActiveGym);
  const matches = c => (f === 'all' || (f === 'projects' ? c.status === 'project' : c.date >= cutoff)) && (!g || c.grade === g);
  const shown = inGym.filter(c => c.pin && matches(c));
  const unpinned = inGym.filter(c => !c.pin && matches(c)).length;
  const view = (mapViews[gym.id] ??= {});
  const viewer = createMapViewer({
    url: photoUrl(gym.map.photoId), width: gym.map.w, height: gym.map.h, view,
    pins: shown.map(c => pinFor(c)),
    onPin: pin => climbSheet(pin.item),
    onCluster: climbsHereSheet,
  });
  return h('div', {}, head, gymSwitcher(),
    h('div', { class: 'seg' }, [['recent', 'Recent'], ['projects', 'Projects'], ['all', 'All time']].map(([k, label]) =>
      h('button', { class: f === k ? 'on' : '', onclick: () => { state.mapFilter = k; render(); } }, label))),
    h('div', { class: 'chip-row' }, activeGrades().map(gr => h('button', {
      class: `chip${g === gr.id ? ' on' : ''}`,
      onclick: () => { state.mapGrade = g === gr.id ? null : gr.id; render(); },
    }, swatch(gr.id, '', gym.id), gr.name))),
    h('div', { class: 'map-wrap' }, viewer.el,
      h('div', { class: 'map-zoom' },
        h('button', { class: 'icon-btn', 'aria-label': 'Zoom in', onclick: viewer.zoomIn }, icon('plus')),
        h('button', { class: 'icon-btn', 'aria-label': 'Zoom out', onclick: viewer.zoomOut }, icon('minus')))),
    h('p', { class: 'muted small map-note' },
      `${shown.length} climb${shown.length === 1 ? '' : 's'} shown${f === 'recent' ? ` from the last ${RECENT_DAYS / 7} weeks` : ''}. Rings are projects; bubbles group climbs close together.`,
      unpinned ? ` ${unpinned} not pinned yet: open a climb and tap “Pin on map”.` : ''));
}

// A file input that saves the chosen image as the gym's map; wrap it in a label so the picker opens straight from the tap
function gymMapInput(gym, replacing = false) {
  return h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (replacing) closeSheet();
      toast('Saving map…');
      const blob = await compressImage(file, 2400).catch(() => null);
      if (!blob) { toast('Couldn’t read that image'); return; }
      const bitmap = await createImageBitmap(blob);
      const id = uid();
      await db.put('photos', { id, blob });
      if (gym.map?.photoId) { await db.del('photos', gym.map.photoId); photoUrls.delete(gym.map.photoId); }
      gym.map = { photoId: id, w: bitmap.width, h: bitmap.height };
      delete mapViews[gym.id];
      await saveSettings();
      render();
      toast(replacing ? 'Map replaced' : 'Map added. Now pin some climbs!');
    },
  });
}

function mapOptionsSheet(gym) {
  openSheet(`${gym.name} map`, h('div', { class: 'stack' },
    h('label', { class: 'card list-row menu-item' }, icon('map'),
      h('div', {}, h('div', {}, 'Replace map'),
        h('p', { class: 'muted small', style: { fontWeight: 400 } }, 'Pins keep their spot on the image, so use a map with the same layout.')),
      gymMapInput(gym, true)),
    h('button', {
      class: 'card list-row menu-item danger-text',
      onclick: async () => {
        if (!confirm('Remove this map? Your climbs keep their pins, so they’ll come back if you add the same map again.')) return;
        await db.del('photos', gym.map.photoId);
        photoUrls.delete(gym.map.photoId);
        delete gym.map;
        await saveSettings();
        closeSheet();
        render();
      },
    }, icon('trash'), 'Remove map')));
}

// In the climb form: pin (or move) the climb on its gym's map
function mapPinField(c, redraw) {
  const gym = gymById(c.gymId);
  if (!gym?.map) return '';
  return h('div', { class: 'field' }, h('span', {}, 'On the map'),
    h('button', { class: 'btn small', onclick: () => pinSheet(c, gym, redraw) }, icon('pin'), c.pin ? 'Pinned · move pin' : 'Pin on map'));
}

function pinSheet(c, gym, onDone) {
  let spot = c.pin ? { ...c.pin } : null;
  const color = grade(c.grade, gym.id).color;
  const others = state.climbs
    .filter(x => x.id !== c.id && x.pin && climbGymId(x) === gym.id && x.date >= Date.now() - RECENT_DAYS * 86400000)
    .map(x => pinFor(x, { faint: true }));
  const viewer = createMapViewer({
    url: photoUrl(gym.map.photoId), width: gym.map.w, height: gym.map.h, pins: others,
    selected: spot && { ...spot, id: c.id, color },
    onTap: m => { spot = m; viewer.setSelected({ ...m, id: c.id, color }); },
  });
  openSheet('Pin on map', h('div', {},
    h('p', { class: 'muted small', style: { marginBottom: '10px' } }, 'Tap where the climb is. Pinch or double-tap to zoom. Faded dots are your other recent climbs.'),
    h('div', { class: 'map-wrap pin-mode' }, viewer.el,
      h('div', { class: 'map-zoom' },
        h('button', { class: 'icon-btn', 'aria-label': 'Zoom in', onclick: viewer.zoomIn }, icon('plus')),
        h('button', { class: 'icon-btn', 'aria-label': 'Zoom out', onclick: viewer.zoomOut }, icon('minus'))))), [
    c.pin && h('button', { class: 'btn danger', onclick: () => { c.pin = null; closeSheet(); onDone(); } }, 'Remove pin'),
    h('button', {
      class: 'btn primary',
      onclick: () => {
        if (!spot) { toast('Tap the map to place the pin'); return; }
        c.pin = { x: +spot.x.toFixed(4), y: +spot.y.toFixed(4) };
        closeSheet();
        onDone();
      },
    }, 'Done'),
  ]);
}

function climbTile(c, onClick = () => climbSheet(c)) {
  const meta = [fmtDate(c.date), c.status !== 'flash' && c.attempts ? `${c.attempts} ${c.attempts === 1 ? 'go' : 'goes'}` : null];
  return h('button', { class: 'climb-tile', onclick: onClick },
    c.photoIds?.[0] ? photoImg(c.photoIds[0], 'tile-img') : h('div', { class: 'tile-img placeholder', style: { background: climbGrade(c).color } }),
    h('div', { class: 'tile-meta' },
      h('div', { class: 'row tight' }, climbSwatch(c), h('strong', {}, c.name || climbGrade(c).name)),
      h('span', { class: `badge ${c.status}` }, STATUS[c.status]),
      h('span', { class: 'muted small' }, meta.filter(Boolean).join(' · '))));
}

function climbSheet(existing, sessionId = null, onSaved = null) {
  const lastGrade = [...state.climbs].filter(inActiveGym).sort((a, b) => b.date - a.date)[0]?.grade;
  const c = existing ? structuredClone(existing) : {
    id: uid(), date: Date.now(), grade: (gradeIndex(lastGrade) >= 0 ? lastGrade : null) ?? activeGrades()[0]?.id, name: '', status: 'project',
    attempts: 1, notes: '', photoIds: [], sessionId: sessionId ?? activeSession()?.id ?? null, sentAt: null, gymId: activeGym().id,
  };
  c.gymId ??= climbGymId(c);
  const newPhotos = new Map();
  const removedPhotos = [];
  const body = h('div');

  const fileInput = h('input', {
    type: 'file', accept: 'image/*,video/*', multiple: true, hidden: true,
    onchange: async e => {
      for (const file of e.target.files) {
        const isVideo = file.type.startsWith('video/');
        if (isVideo) toast('Grabbing a frame from your video…');
        const blob = await (isVideo ? videoThumbnail(file) : compressImage(file)).catch(() => null);
        if (!blob) { toast(isVideo ? 'Couldn’t read that video. Try a screenshot instead.' : 'Couldn’t read that photo'); continue; }
        const id = uid();
        newPhotos.set(id, { blob, url: URL.createObjectURL(blob) });
        c.photoIds.push(id);
      }
      e.target.value = '';
      draw();
    },
  });

  const setStatus = st => {
    c.status = st;
    if (st === 'flash') c.attempts = 1;
    c.sentAt = st === 'project' ? null : c.sentAt ?? Date.now();
    draw();
  };

  function photoThumb(id) {
    const fresh = newPhotos.get(id);
    const img = fresh ? h('img', { src: fresh.url, alt: '' }) : photoImg(id);
    img.addEventListener('click', () => lightbox(img.src));
    return h('div', { class: 'photo' }, img, h('button', {
      class: 'rm', 'aria-label': 'Remove photo',
      onclick: () => {
        c.photoIds = c.photoIds.filter(p => p !== id);
        if (fresh) newPhotos.delete(id); else removedPhotos.push(id);
        draw();
      },
    }, '✕'));
  }

  function draw() {
    body.replaceChildren(
      h('div', { class: 'photos' },
        c.photoIds.map(photoThumb),
        h('label', { class: 'photo-add' }, h('span', {}, '📷'), 'Photo or video', fileInput)),
      state.settings.gyms.length > 1 && h('div', { class: 'field' }, h('span', {}, 'Gym'),
        h('div', { class: 'chip-row' }, state.settings.gyms.map(gym => h('button', {
          class: `chip${c.gymId === gym.id ? ' on' : ''}`,
          onclick: () => {
            if (c.gymId !== gym.id) c.pin = null;
            c.gymId = gym.id;
            const grades = gymGrades(gym);
            if (!grades.some(g => g.id === c.grade)) c.grade = grades[0]?.id;
            draw();
          },
        }, gym.name)))),
      h('div', { class: 'field' }, h('span', {}, gymById(c.gymId)?.scale === 'v' ? 'Grade' : 'Colour'),
        h('div', { class: 'grade-picker' }, gymGrades(gymById(c.gymId)).map(g =>
          h('button', { class: `grade-opt${c.grade === g.id ? ' on' : ''}`, onclick: () => { c.grade = g.id; draw(); } },
            swatch(g.id, 'lg', c.gymId), g.name)))),
      mapPinField(c, draw),
      field('Name or wall (optional)', h('input', {
        class: 'input', value: c.name, placeholder: 'e.g. Cave overhang, the pinchy one',
        oninput: e => { c.name = e.target.value; },
      })),
      h('div', { class: 'field' }, h('span', {}, 'Status'),
        h('div', { class: 'seg' }, Object.entries(STATUS).map(([k, label]) =>
          h('button', { class: c.status === k ? 'on' : '', onclick: () => setStatus(k) }, label)))),
      c.status === 'flash' ? '' : h('div', { class: 'field' }, h('span', {}, 'Attempts'),
        h('div', { class: 'stepper' },
          h('button', { class: 'btn', 'aria-label': 'Fewer attempts', onclick: () => { c.attempts = Math.max(1, c.attempts - 1); draw(); } }, '−'),
          h('span', { class: 'val' }, c.attempts),
          h('button', { class: 'btn', 'aria-label': 'More attempts', onclick: () => { c.attempts++; draw(); } }, '+'))),
      field('Date', h('input', {
        class: 'input', type: 'date', value: toDateInput(c.date),
        onchange: e => { if (e.target.value) c.date = new Date(`${e.target.value}T12:00`).getTime(); },
      })),
      field('Notes / beta', h('textarea', {
        class: 'input', rows: 3, value: c.notes, placeholder: 'Beta, crux move, what to try next time…',
        oninput: e => { c.notes = e.target.value; },
      })));
  }
  draw();

  openSheet(existing ? 'Edit climb' : 'Add climb', body, [
    existing && h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm('Delete this climb and its photos?')) return;
        for (const id of existing.photoIds ?? []) await db.del('photos', id);
        await remove('climbs', c.id);
        closeSheet();
        render();
      },
    }, 'Delete'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        for (const [id, p] of newPhotos) {
          await db.put('photos', { id, blob: p.blob });
          photoUrls.set(id, Promise.resolve(p.url));
        }
        for (const id of removedPhotos) { await db.del('photos', id); photoUrls.delete(id); }
        const g = grade(c.grade, c.gymId);
        Object.assign(c, { gradeName: g.name, gradeColor: g.color });
        await save('climbs', c);
        onSaved?.(c);
        const running = activeSession();
        if (running && c.sessionId === running.id) { touch(running); save('sessions', running); }
        closeSheet();
        render();
        if (!existing) toast(c.status === 'project' ? 'Project saved' : `${STATUS[c.status]}! Nice 🎉`);
      },
    }, 'Save'),
  ]);
}

// Settings tab
const ACCENTS = [
  ['Purple', '#8a30ff'], ['Lavender', '#a78bfa'], ['Pink', '#ec4899'], ['Teal', '#14b8a6'],
  ['Blue', '#3b82f6'], ['Orange', '#f97316'], ['Lime', '#65a30d'], ['Red', '#ef4444'],
];
const DEFAULT_ACCENT = ACCENTS[0][1];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyAccent() {
  const accent = state.settings.accent || DEFAULT_ACCENT;
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  // White text on dark accents, near-black on light ones — whichever reads better
  root.setProperty('--accent-ink', 1.05 / (luminance(accent) + 0.05) >= (luminance(accent) + 0.05) / 0.06 ? '#ffffff' : '#141414');
}

async function setAccent(color) {
  state.settings.accent = color;
  applyAccent();
  await saveSettings();
  render();
}

function settingsRow(title, sub, onclick) {
  return h('button', { class: 'card list-row', onclick },
    h('div', { class: 'grow' }, h('div', { class: 'card-title' }, title), sub && h('p', { class: 'muted small' }, sub)),
    h('span', { class: 'chev' }, '›'));
}

function planMenu(p) {
  const action = (iconName, label, fn, cls = '') =>
    h('button', { class: `card list-row menu-item ${cls}`, onclick: () => { closeSheet(); fn(); } }, icon(iconName), label);
  openSheet(p.name, h('div', { class: 'stack' },
    action('edit', 'Edit plan', () => planSheet(p)),
    action('rename', 'Rename', async () => {
      const name = prompt('Rename plan', p.name)?.trim();
      if (!name) return;
      await save('plans', { ...p, name });
      render();
    }),
    action('duplicate', 'Duplicate', async () => {
      await save('plans', { ...structuredClone(p), id: uid(), name: `${p.name} (copy)`, createdAt: Date.now() });
      render();
    }),
    action('trash', 'Delete', async () => {
      if (!confirm(`Delete “${p.name}”? Past sessions are kept.`)) return;
      await remove('plans', p.id);
      render();
    }, 'danger-text')));
}

function settingsView() {
  const current = (state.settings.accent || DEFAULT_ACCENT).toLowerCase();
  const isPreset = ACCENTS.some(([, c]) => c === current);
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Settings')),
    h('h3', { class: 'section-title' }, 'Accent colour'),
    h('div', {},
      h('div', { class: 'accent-grid' },
        ACCENTS.map(([name, c]) => h('button', {
          class: `accent-opt${c === current ? ' on' : ''}`, 'aria-label': name, 'aria-pressed': String(c === current),
          onclick: () => setAccent(c),
        }, h('span', { style: { background: c } }), name)),
        h('label', { class: `accent-opt${isPreset ? '' : ' on'}` },
          h('span', { class: 'custom', style: isPreset ? null : { background: current } }, isPreset ? '+' : ''),
          'Custom',
          h('input', { type: 'color', value: current, class: 'visually-hidden', onchange: e => setAccent(e.target.value) })))),
    h('div', { class: 'section-row' },
      h('h3', { class: 'section-title' }, 'Gyms'),
      h('button', { class: 'btn small ghost', onclick: () => gymSheet(null) }, '+ Add gym')),
    h('p', { class: 'muted small', style: { margin: '0 2px 10px' } }, 'Tap a gym to make it your current one. Each gym has its own grades, and climbs remember where they were logged.'),
    h('div', { class: 'stack' }, state.settings.gyms.map(gym => {
      const on = gym.id === activeGym().id;
      return h('div', { class: `card gym-card${on ? ' on' : ''}` },
        h('button', { class: 'gym-main', 'aria-pressed': String(on), onclick: () => setActiveGym(gym.id) },
          h('span', { class: 'radio', 'aria-hidden': 'true' }),
          h('div', { class: 'grow' },
            h('div', { class: 'card-title' }, gym.name),
            h('div', { class: 'gym-dots' }, gymGrades(gym).map(g => h('span', { class: 'swatch', title: g.name, style: { background: g.color } })),
              gym.scale === 'v' ? h('span', { class: 'muted small' }, 'V-scale') : null))),
        h('button', { class: 'icon-btn', 'aria-label': `Edit ${gym.name}`, onclick: () => gymSheet(gym) }, icon('edit')));
    })),
    h('h3', { class: 'section-title' }, 'Your data'),
    h('div', { class: 'stack' },
      settingsRow('Back up data', `${lastBackupText()} · saves everything, photos included`, exportData),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Backup reminder'),
        h('p', { class: 'muted small' }, 'After a session, remind me if my last backup is older than:'),
        h('div', { class: 'seg', style: { marginTop: '10px', marginBottom: 0 } }, BACKUP_INTERVALS.map(([days, label]) =>
          h('button', {
            class: backupEvery() === days ? 'on' : '',
            onclick: async () => { state.settings.backupEveryDays = days; await saveSettings(); render(); },
          }, label)))),
      h('label', { class: 'card list-row' },
        h('div', { class: 'grow' }, h('div', { class: 'card-title' }, 'Restore from backup'), h('p', { class: 'muted small' }, 'Replaces everything on this device')),
        h('span', { class: 'chev' }, '›'),
        h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => importData(e.target.files[0]) }))),
    h('h3', { class: 'section-title' }, 'About'),
    settingsRow('About BetaLab', 'Hobby project · no ads, no tracking', aboutSheet),
    settingsRow('What’s new', `Version ${APP_VERSION} · ${fmtDay(CHANGES[0].date)}`, () => whatsNewSheet()),
    h('button', { class: 'data-note', onclick: dataInfoSheet }, 'Your data stays on this device', icon('info')));
}

function aboutSheet() {
  const point = (title, text) => h('div', { class: 'info-point' }, h('strong', {}, title), h('p', { class: 'muted small' }, text));
  openSheet('About BetaLab', h('div', { class: 'stack' },
    h('p', {}, 'BetaLab is a hobby project, made by a climber for a climber (myself), but I wanted to share it. No ads, no accounts, no tracking.'),
    point('Train at your own risk', 'BetaLab isn’t a coach. Any plans, exercises or tips you add or get from others aren’t professional advice. Warm up properly, listen to your body, and be especially careful with finger training like hangboarding. If something hurts, stop and seek a professional.'),
    point('No warranty', 'It’s a personal project, provided as-is. Bugs can happen, and your data lives only on your phone, so use Back up data now and then.'),
    point('Feedback and bugs', 'Found a bug or have an idea? Open an issue on GitHub.'),
    h('a', { class: 'btn ghost full', href: 'https://github.com/y3l4h/betalab/issues', target: '_blank', rel: 'noopener' }, 'Report a bug or suggest a feature'),
    h('button', { class: 'btn ghost full', onclick: () => { closeSheet(); dataInfoSheet(); } }, 'How your data is stored')));
}

function dataInfoSheet() {
  const point = (title, text) => h('div', { class: 'info-point' }, h('strong', {}, title), h('p', { class: 'muted small' }, text));
  openSheet('How your data is stored', h('div', { class: 'stack' },
    point('Nothing is uploaded', 'BetaLab has no account and no server. Your plans, sessions, climbs, notes and photos are saved in the app’s private storage on this phone. They never leave your phone, and nobody else can see them.'),
    point('Photos', 'When you add a photo, BetaLab makes a smaller copy (about 0.2–0.5 MB) and saves it inside the app. Your original photo in the Photos app is not changed or shared.'),
    point('Where exactly', 'Everything sits in a small database inside your browser’s storage for this website (IndexedDB), on your phone’s own storage. Only BetaLab can read it, because browsers lock each website’s storage to that website.'),
    point('Install it to your home screen', 'The app files come from GitHub Pages, like loading any website, but your data never goes there. On iPhone, Safari may clear a website’s data after about a week without visits, and a Safari tab keeps separate data from the Home Screen app, so use the installed app. On Android, Chrome keeps the data, and the installed app and the Chrome tab share it.'),
    point('When data is deleted', 'Removing BetaLab from your home screen (iPhone) or clearing the browser’s site data (iPhone and Android) deletes everything in it. Use Back up data now and then and keep the file somewhere safe, like iCloud Drive, Google Drive or Files.'),
    point('Sharing with friends', 'Each person who installs BetaLab gets their own empty copy. Nothing is shared between phones unless you send someone a backup file.')));
}

// The plan being edited is a draft: closing the editor any way except Save/Discard just minimises it
const DRAFT_KEY = 'betalab.planDraft';
function persistDraft() {
  try {
    const d = state.planDraft;
    d ? localStorage.setItem(DRAFT_KEY, JSON.stringify({ plan: d.plan, sourceId: d.sourceId })) : localStorage.removeItem(DRAFT_KEY);
  } catch {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d?.plan) state.planDraft = { ...d, open: false };
  } catch {}
}

// Reopen the draft even if its plan was deleted meanwhile
function resumeDraft() {
  const id = state.planDraft?.sourceId;
  planSheet(id ? state.plans.find(p => p.id === id) ?? { id } : null);
}

function unsavedDraftSheet(then) {
  const d = state.planDraft;
  const name = d.plan.name || 'your new plan';
  openSheet('Unsaved changes', h('p', {}, `You’re still editing “${name}”. Save or discard it first.`), [
    h('button', { class: 'btn', onclick: () => { state.planDraft = null; persistDraft(); closeSheet(); then(); } }, 'Discard'),
    h('button', { class: 'btn', onclick: () => { closeSheet(); resumeDraft(); } }, 'Keep editing'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        if (!d.plan.name.trim()) { closeSheet(); toast('Give the plan a name'); planSheet(null); return; }
        await save('plans', d.plan);
        state.planDraft = null;
        persistDraft();
        closeSheet();
        then();
      },
    }, 'Save'),
  ]);
}

function planSheet(existing) {
  const sourceId = existing?.id ?? null;
  if (state.planDraft && state.planDraft.sourceId !== sourceId) { unsavedDraftSheet(() => planSheet(existing)); return; }
  state.planDraft ??= {
    plan: existing ? structuredClone(existing) : { id: uid(), name: '', description: '', exercises: [], createdAt: Date.now() },
    sourceId,
  };
  state.planDraft.open = true;
  const p = state.planDraft.plan;
  const body = h('div');
  const move = (i, d) => { const [x] = p.exercises.splice(i, 1); p.exercises.splice(i + d, 0, x); draw(); };

  function draw() {
    body.replaceChildren(
      field('Name', h('input', { class: 'input', value: p.name, placeholder: 'e.g. Capacity circuit', oninput: e => { p.name = e.target.value; } })),
      field('Description', h('textarea', { class: 'input', rows: 2, value: p.description, placeholder: 'What is this session for?', oninput: e => { p.description = e.target.value; } })),
      h('div', { class: 'field' }, h('span', {}, 'Type of training'),
        h('div', { class: 'type-grid' }, TRAINING_TYPES.map(t => h('button', {
          class: `type-opt${p.type === t.id ? ' on' : ''}`, 'aria-pressed': String(p.type === t.id),
          onclick: () => { p.type = p.type === t.id ? null : t.id; draw(); },
        }, icon(t.id), h('span', {}, t.name))))),
      h('h3', { class: 'section-title' }, 'Exercises'),
      ...p.exercises.map((ex, i) => h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('button', { class: 'grow list-row', style: { border: 0, background: 'none', padding: 0 }, onclick: () => exerciseSheet(ex, upd => { p.exercises[i] = upd; draw(); }) },
            h('div', { class: 'grow' },
              h('div', { class: 'card-title' }, ex.name),
              h('p', { class: 'muted small' }, [ex.section, repsLabel(ex), ex.rest ? `rest ${fmtTime(ex.rest)}` : null].filter(Boolean).join(' · ')),
              ex.tip && tipText(ex.tip, `plan-${p.id}-${i}`))),
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === p.exercises.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { p.exercises.splice(i, 1); draw(); } }, '✕')))),
      h('button', { class: 'btn ghost full', onclick: () => exerciseSheet(null, ex => { p.exercises.push(ex); draw(); }) }, '+ Add exercise'));
  }
  draw();

  // Edits happen on a copy; only Save writes it back
  const finish = () => { state.planDraft = null; persistDraft(); closeSheet(); };
  openSheet(existing ? 'Edit plan' : 'New plan', body, [
    h('button', {
      class: 'btn',
      onclick: () => { if (confirm('Discard your changes to this plan?')) finish(); },
    }, 'Discard'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        if (!p.name.trim()) { toast('Give the plan a name'); return; }
        await save('plans', p);
        finish();
      },
    }, 'Save plan'),
  ], {
    onClose: () => {
      if (state.planDraft) { state.planDraft.open = false; persistDraft(); }
      render();
    },
  });
  renderBars();
}

function exerciseSheet(existing, onSave) {
  const ex = existing ? { ...existing } : { section: 'Main', name: '', sets: 3, reps: '', rest: 120, tip: '' };
  const rests = REST_OPTIONS.includes(ex.rest) ? REST_OPTIONS : [...REST_OPTIONS, ex.rest].sort((a, b) => a - b);
  const setsVal = h('span', { class: 'val' }, ex.sets);
  const body = h('div', {},
    field('Exercise', h('input', { class: 'input', value: ex.name, placeholder: 'e.g. Pull-ups', oninput: e => { ex.name = e.target.value; } })),
    field('Section', h('input', { class: 'input', value: ex.section, list: 'sections', oninput: e => { ex.section = e.target.value; } })),
    h('datalist', { id: 'sections' }, SECTIONS.map(s => h('option', { value: s }))),
    h('div', { class: 'field-row' },
      h('div', { class: 'field' }, h('span', {}, 'Sets'),
        h('div', { class: 'stepper' },
          h('button', { class: 'btn', 'aria-label': 'Fewer sets', onclick: () => { ex.sets = Math.max(1, ex.sets - 1); setsVal.textContent = ex.sets; } }, '−'),
          setsVal,
          h('button', { class: 'btn', 'aria-label': 'More sets', onclick: () => { ex.sets++; setsVal.textContent = ex.sets; } }, '+'))),
      field('Rest between sets', h('select', { class: 'input', onchange: e => { ex.rest = Number(e.target.value); } },
        rests.map(r => h('option', { value: r, selected: r === ex.rest }, r ? fmtTime(r) : 'None'))))),
    field('Reps / detail', h('input', { class: 'input', value: ex.reps, placeholder: '8 reps, 10 s hang, 4 problems…', oninput: e => { ex.reps = e.target.value; } })),
    field('How-to / tips', h('textarea', { class: 'input', rows: 3, value: ex.tip, placeholder: 'Cues, which wall, weight…', oninput: e => { ex.tip = e.target.value; } })),
    h('label', { class: 'check-row' },
      h('input', { type: 'checkbox', checked: !!ex.trackClimbs, onchange: e => { ex.trackClimbs = e.target.checked; } }),
      h('span', {}, h('strong', {}, 'Track individual climbs'), h('br'), h('span', { class: 'muted small' }, 'Add the problems you’re doing and tick each one per round'))));

  openSheet(existing ? 'Edit exercise' : 'Add exercise', body, [
    h('button', {
      class: 'btn primary',
      onclick: () => {
        if (!ex.name.trim()) { toast('Give the exercise a name'); return; }
        closeSheet();
        onSave(ex);
      },
    }, 'Save'),
  ]);
}

// Progress tab
function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function progressView() {
  const sends = state.climbs.filter(c => c.status !== 'project');
  const done = state.sessions.filter(s => s.endedAt);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  // Grades only compare within a gym, so the grade stats follow the selected gym; totals cover every gym
  const gymSends = sends.filter(inActiveGym);
  const hardest = gymSends.reduce((best, c) => (gradeIndex(c.grade) > gradeIndex(best?.grade) ? c : best), null);
  const grades = activeGrades();
  const perGrade = grades.map(g => ({
    g, sent: gymSends.filter(c => c.grade === g.id).length, flash: gymSends.filter(c => c.grade === g.id && c.status === 'flash').length,
  }));
  const multiGym = state.settings.gyms.length > 1;
  const maxSent = Math.max(1, ...perGrade.map(x => x.sent));

  const thisWeek = weekStart(Date.now());
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = thisWeek - (7 - i) * 7 * 86400000;
    const end = start + 7 * 86400000;
    return {
      start,
      sessions: done.filter(s => s.startedAt >= start && s.startedAt < end).length,
      sends: sends.filter(c => (c.sentAt ?? c.date) >= start && (c.sentAt ?? c.date) < end).length,
    };
  });
  const maxWeek = Math.max(1, ...weeks.map(w => w.sends));

  const tile = (label, value) => h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  const last = done.reduce((a, b) => (!a || b.startedAt > a.startedAt ? b : a), null);
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Progress')),
    h('button', { class: 'card list-row', onclick: sessionsSheet },
      h('div', { class: 'grow' },
        h('div', { class: 'card-title' }, 'Sessions'),
        h('p', { class: 'muted small' }, last
          ? `${done.length} session${done.length === 1 ? '' : 's'} · last ${fmtDate(last.startedAt)}, ${last.name}`
          : 'Finished sessions show up here')),
      h('span', { class: 'chev' }, '›')),
    h('h3', { class: 'section-title' }, 'Stats'),
    h('div', { class: 'tiles' },
      tile('Sessions this month', done.filter(s => s.startedAt >= monthStart.getTime()).length),
      tile('Total sends', sends.length),
      tile(multiGym ? `Hardest at ${activeGym().name}` : 'Hardest send', hardest ? [climbSwatch(hardest, 'lg'), climbGrade(hardest).name] : '—'),
      tile('Open projects', state.climbs.filter(c => c.status === 'project').length)),
    h('h3', { class: 'section-title' }, multiGym ? `Sends by grade · ${activeGym().name}` : 'Sends by grade'),
    gymSwitcher(),
    h('div', { class: 'card' }, [...perGrade].reverse().map(({ g, sent, flash }) =>
      h('div', { class: 'pyramid-row', title: `${g.name}: ${sent} sent, ${flash} flashed` },
        h('span', { class: 'name' }, swatch(g.id, '', activeGym().id), g.name),
        h('div', { class: 'track' }, sent ? h('div', { class: 'bar', style: { width: `${(sent / maxSent) * 100}%`, background: g.color } }) : null),
        h('span', { class: 'count' }, h('strong', {}, sent), flash ? ` (${flash}⚡)` : '')))),
    h('p', { class: 'muted small', style: { marginTop: '6px' } }, '⚡ = flashed'),
    h('h3', { class: 'section-title' }, 'Sends per week'),
    h('div', { class: 'card' },
      h('div', { class: 'weeks' }, weeks.map(w =>
        h('div', { class: 'week', title: `Week of ${fmtDate(w.start)}: ${w.sends} sends, ${w.sessions} sessions` },
          w.sends ? h('span', { class: 'v' }, w.sends) : null,
          h('div', { class: 'bar', style: { height: `${(w.sends / maxWeek) * 100}%` } })))),
      h('div', { class: 'week-labels' }, weeks.map((w, i) =>
        h('span', {}, i === 7 ? 'Now' : new Date(w.start).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }))))));
}

function gymSheet(existing) {
  const gym = existing ? structuredClone(existing) : { id: uid(), name: '', scale: 'colours', grades: [] };
  const grades = gym.grades ?? [];
  const body = h('div');
  const move = (i, d) => { const [x] = grades.splice(i, 1); grades.splice(i + d, 0, x); draw(); };
  const usedHere = g => state.climbs.some(c => c.grade === g.id && climbGymId(c) === gym.id);
  function draw() {
    body.replaceChildren(
      field('Gym name', h('input', { class: 'input', value: gym.name, placeholder: 'e.g. Urban Climb Collingwood', oninput: e => { gym.name = e.target.value; } })),
      h('div', { class: 'field' }, h('span', {}, 'Grading'),
        h('div', { class: 'seg', style: { marginBottom: 0 } }, [['colours', 'Colours'], ['v', 'V-scale']].map(([id, label]) =>
          h('button', { class: gym.scale === id ? 'on' : '', onclick: () => { gym.scale = id; draw(); } }, label)))),
      gym.scale === 'v'
        ? h('p', { class: 'muted small', style: { marginTop: '10px' } }, V_SCALE.map(g => g.name).join(' → '))
        : gradeEditor());
  }
  function gradeEditor() {
    return h('div', {},
      !existing && h('div', { class: 'field' }, h('span', {}, 'Start from'),
        h('div', { class: 'chip-row' }, GYM_PRESETS.map(p => h('button', {
          class: 'chip', onclick: () => { grades.splice(0, grades.length, ...structuredClone(p.grades)); draw(); },
        }, `${p.name} colours`)))),
      h('p', { class: 'muted small', style: { marginTop: '14px' } }, 'Colours from easiest (top) to hardest (bottom).'),
      h('div', { style: { marginTop: '10px' } }, grades.map((g, i) => h('div', { class: 'grade-edit' },
        h('input', { type: 'color', value: g.color, 'aria-label': `${g.name} colour`, oninput: e => { g.color = e.target.value; } }),
        h('input', { class: 'input', value: g.name, oninput: e => { g.name = e.target.value; } }),
        h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === grades.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Remove',
          onclick: () => {
            if (usedHere(g) && !confirm(`Some climbs at this gym use ${g.name}. Remove it anyway?`)) return;
            grades.splice(i, 1);
            draw();
          },
        }, '✕')))),
      h('button', { class: 'btn ghost full', onclick: () => { grades.push({ id: uid(), name: 'New', color: '#888888' }); draw(); } }, '+ Add colour'));
  }
  draw();

  const others = state.settings.gyms.filter(g => g.id !== gym.id);
  openSheet(existing ? 'Edit gym' : 'Add gym', body, [
    existing && others.length && h('button', {
      class: 'btn danger',
      onclick: async () => {
        const count = state.climbs.filter(c => climbGymId(c) === gym.id).length;
        const moveTo = gym.id === state.settings.gyms[0].id ? others[0] : state.settings.gyms[0];
        if (!confirm(`Delete ${gym.name}?${count ? ` Your ${count} climb${count > 1 ? 's' : ''} logged there will show under ${moveTo.name}.` : ''}`)) return;
        if (gym.map?.photoId) await db.del('photos', gym.map.photoId);
        state.settings.gyms = others;
        if (state.settings.activeGymId === gym.id) state.settings.activeGymId = others[0].id;
        await saveSettings();
        closeSheet();
        render();
      },
    }, 'Delete'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        if (!gym.name.trim()) { toast('Give the gym a name'); return; }
        gym.grades = grades.filter(g => g.name.trim());
        if (gym.scale === 'colours' && !gym.grades.length) { toast('Add at least one colour'); return; }
        const i = state.settings.gyms.findIndex(g => g.id === gym.id);
        if (i >= 0) state.settings.gyms[i] = gym; else state.settings.gyms.push(gym);
        if (!existing) state.settings.activeGymId = gym.id;
        await saveSettings();
        closeSheet();
        render();
      },
    }, existing ? 'Save' : 'Add gym'),
  ]);
}

// Backup / restore
const blobToDataUrl = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

async function buildBackup() {
  flushPending();
  const photos = await db.getAll('photos');
  const data = {
    app: 'betalab', version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, plans: state.plans, sessions: state.sessions, climbs: state.climbs,
    photos: await Promise.all(photos.map(async p => ({ id: p.id, data: await blobToDataUrl(p.blob) }))),
  };
  const name = `betalab-backup-${toDateInput(Date.now())}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  const size = file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`;
  return { file, summary: `${state.climbs.length} climbs, ${state.sessions.length} sessions, ${photos.length} photos · ${size}` };
}

async function markBackedUp() {
  state.settings.lastBackupAt = Date.now();
  await saveSettings();
  render();
  toast('Backup saved');
}

// The save button for a built backup. Sharing needs a fresh tap on iOS, so the file is built before the button shows
function backupButton(file, label) {
  if (navigator.canShare?.({ files: [file] })) {
    return h('button', {
      class: 'btn primary',
      onclick: () => navigator.share({ files: [file], title: 'BetaLab backup' })
        .then(() => { closeSheet(); markBackedUp(); })
        .catch(() => {}),
    }, label);
  }
  // Android Chrome can't share .json files, so it downloads instead (lands in Downloads)
  return h('a', {
    class: 'btn primary', href: URL.createObjectURL(file), download: file.name,
    onclick: () => setTimeout(() => { closeSheet(); markBackedUp(); }, 300),
  }, label);
}

async function exportData() {
  toast('Preparing backup…');
  const { file, summary } = await buildBackup();
  openSheet('Backup ready', h('div', {},
    h('p', {}, summary),
    h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Save it to iCloud Drive, Google Drive or Files. Restore it from Settings → Restore from backup.')), [
    backupButton(file, 'Save backup file'),
  ]);
}

const BACKUP_INTERVALS = [[3, '3 days'], [7, 'Week'], [14, '2 wks'], [30, 'Month'], [0, 'Off']];
const backupEvery = () => state.settings.backupEveryDays ?? 7;
const daysSince = ts => Math.floor((Date.now() - ts) / 86400000);
function lastBackupText() {
  const at = state.settings.lastBackupAt;
  if (!at) return 'Never backed up';
  const d = daysSince(at);
  return `Last backup ${d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}`;
}

// After a session, nudge for a backup when the last one is older than the chosen interval
async function maybeRemindBackup() {
  const every = backupEvery();
  if (!every) return;
  const at = state.settings.lastBackupAt;
  if (at && daysSince(at) < every) return;
  const { file, summary } = await buildBackup();
  openSheet('Time for a backup', h('div', {},
    h('p', {}, `${lastBackupText()}. Save a copy so you don’t lose your climbs if your phone is lost or the app is removed.`),
    h('p', { class: 'muted small', style: { marginTop: '8px' } }, `${summary}. Change how often you’re reminded in Settings.`)), [
    h('button', { class: 'btn', onclick: closeSheet }, 'Later'),
    backupButton(file, 'Back up now'),
  ]);
}

async function importData(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file is not a Beta Lab backup'); return; }
  if (data?.app !== 'betalab') { toast('That file is not a Beta Lab backup'); return; }
  if (!confirm(`Restore backup from ${new Date(data.exportedAt).toLocaleString()}? This replaces everything on this device.`)) return;
  for (const s of db.storeNames) await db.clear(s);
  for (const p of data.photos ?? []) await db.put('photos', { id: p.id, blob: await (await fetch(p.data)).blob() });
  for (const store of ['plans', 'sessions', 'climbs']) for (const x of data[store] ?? []) await db.put(store, x);
  await db.put('meta', { ...data.settings, id: 'settings' });
  photoUrls.clear();
  await loadAll();
  toast('Backup restored');
  render();
}

// What's new: show the changes someone hasn't seen yet, once, after an update
const SEEN_KEY = 'betalab.seenVersion';
const fmtDay = iso => new Date(`${iso}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function whatsNewSheet(changes = CHANGES, title = 'What’s new') {
  openSheet(title, h('div', { class: 'stack' }, changes.map(c => h('div', { class: 'info-point' },
    h('strong', {}, `Version ${c.version}`), h('span', { class: 'muted small' }, ` · ${fmtDay(c.date)}`),
    h('ul', { class: 'change-list' }, c.items.map(item => h('li', {}, item)))))));
}

function maybeShowWhatsNew() {
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch {}
  try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch {}
  if (seen === APP_VERSION) return;
  // Brand-new users don't need release notes; people who already have data do
  const hasData = state.plans.length || state.sessions.length || state.climbs.length;
  if (!seen && !hasData) return;
  const i = seen ? CHANGES.findIndex(c => c.version === seen) : 1;
  const unseen = CHANGES.slice(0, i < 0 ? CHANGES.length : Math.max(i, 1));
  whatsNewSheet(unseen, 'BetaLab was updated');
}

// A new version finished downloading in the background: offer a reload instead of waiting for the next launch
function watchForUpdates() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.getElementById('update-banner')) return;
    document.body.append(h('div', { id: 'update-banner', class: 'update-banner', role: 'status' },
      h('span', {}, 'A new version of BetaLab is ready'),
      h('button', { class: 'btn small primary', onclick: () => location.reload() }, 'Update')));
  });
}

// Settings from before gyms existed had one colour list (and maybe the V-scale switch): turn that into gyms
function migrateGyms(settings) {
  if (settings.gyms) return;
  const presets = structuredClone(GYM_PRESETS);
  if (settings.grades) presets[0].grades = settings.grades;
  settings.gyms = presets;
  settings.activeGymId = presets[0].id;
  if (settings.gradeScale === 'v') {
    const vGym = { id: uid(), name: 'V-scale gym', scale: 'v' };
    settings.gyms.push(vGym);
    settings.activeGymId = vGym.id;
  }
  delete settings.grades;
  delete settings.gradeScale;
  settings.needsSave = true;
}

async function loadAll() {
  const [plans, sessions, climbs, settings] = await Promise.all([
    db.getAll('plans'), db.getAll('sessions'), db.getAll('climbs'), db.get('meta', 'settings'),
  ]);
  state.plans = plans.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  state.sessions = sessions;
  state.climbs = climbs;
  state.settings = settings ?? { id: 'settings' };
  migrateGyms(state.settings);
  if (state.settings.needsSave) { delete state.settings.needsSave; await saveSettings(); }
  applyAccent();
}

async function init() {
  await loadAll();
  if (!(await db.get('meta', 'settings'))) {
    await saveSettings();
  } else if (!(await db.get('meta', 'trackClimbs'))) {
    // Plans seeded before per-climb tracking existed: switch it on for the climbing exercises
    for (const item of [...state.plans, ...state.sessions.filter(s => !s.endedAt)]) {
      for (const e of item.exercises) if (e.trackClimbs === undefined && CLIMB_EXERCISES.includes(e.name)) e.trackClimbs = true;
      await db.put(item.endedAt === undefined ? 'plans' : 'sessions', item);
    }
  }
  await db.put('meta', { id: 'trackClimbs', at: Date.now() });
  state.sessionOpen = !!activeSession();
  loadDraft();
  navigator.storage?.persist?.();
  document.querySelectorAll('.tabbar button').forEach(b => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushPending(); persistDraft(); } else checkForgottenSession();
  });
  timer.init();
  setInterval(tickClocks, 1000);
  render();
  maybeShowWhatsNew();
  checkForgottenSession();
  watchForUpdates();
}

init();
