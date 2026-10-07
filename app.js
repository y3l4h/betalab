import * as db from './db.js';
import * as timer from './timer.js';
import { CLIMB_EXERCISES, DEFAULT_GRADES, SECTIONS, defaultPlans } from './defaults.js';

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
const grade = id => state.settings.grades.find(g => g.id === id) ?? { id, name: '?', color: '#888888' };
const gradeIndex = id => state.settings.grades.findIndex(g => g.id === id);
const swatch = (id, cls = '') => h('span', { class: `swatch ${cls}`, style: { background: grade(id).color } });
const activeSession = () => state.sessions.find(s => !s.endedAt);
const repsLabel = e => (e.sets > 1 ? `${e.sets} × ${e.reps || 'sets'}` : e.reps || '1 set');
const setCounts = s => s.exercises.reduce((n, e) => [n[0] + e.done.filter(Boolean).length, n[1] + e.done.length], [0, 0]);
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
  if (i >= 0) list[i] = obj; else list.unshift(obj);
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
async function compressImage(file, max = 1600, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}
function lightbox(src) {
  const box = h('div', { class: 'lightbox', onclick: () => box.remove() }, h('img', { src, alt: '' }));
  document.body.append(box);
}

// Bottom sheets (stackable)
function openSheet(title, body, actions = []) {
  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeSheet }, '✕')),
      h('div', { class: 'sheet-body' }, body),
      actions.filter(Boolean).length ? h('div', { class: 'sheet-actions' }, actions) : null));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
  document.body.append(overlay);
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  const all = document.querySelectorAll('.overlay');
  all[all.length - 1]?.remove();
  if (all.length <= 1) document.body.classList.remove('sheet-open');
}

function render() {
  const main = document.getElementById('main');
  const y = window.scrollY;
  const same = main.dataset.tab === state.tab;
  const views = { train: trainView, climbs: climbsView, plans: plansView, progress: progressView };
  main.replaceChildren(views[state.tab]());
  main.dataset.tab = state.tab;
  window.scrollTo(0, same ? y : 0);
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  tickElapsed();
}
function tickElapsed() {
  document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = fmtDuration(Date.now() - Number(el.dataset.elapsed)); });
}

// Train tab
function trainView() {
  const s = activeSession();
  if (s) return sessionView(s);
  const history = state.sessions.filter(x => x.endedAt).sort((a, b) => b.startedAt - a.startedAt);
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Train')),
    h('h3', { class: 'section-title' }, 'Start a session'),
    state.plans.length
      ? state.plans.map(p => h('button', { class: 'card plan-card', 'aria-label': `Start ${p.name}`, onclick: () => startSession(p) },
        h('div', { class: 'grow' },
          h('div', { class: 'card-title' }, p.name),
          p.description && h('p', { class: 'muted small' }, p.description)),
        h('span', { class: 'play', 'aria-hidden': 'true' }, '▶')))
      : h('p', { class: 'muted' }, 'No plans yet. Make one in Plans.'),
    h('button', { class: 'btn ghost full', onclick: () => startSession(null) }, 'Start an empty session'),
    h('h3', { class: 'section-title' }, 'Quick rest timer'),
    h('div', { class: 'chip-row' }, [60, 90, 120, 180, 240, 300].map(sec =>
      h('button', { class: 'chip', onclick: () => timer.start(sec) }, fmtTime(sec)))),
    h('h3', { class: 'section-title' }, 'History'),
    history.length ? history.map(historyRow) : h('p', { class: 'muted small' }, 'Finished sessions show up here.'));
}

function historyRow(s) {
  const [done, total] = setCounts(s);
  const climbs = state.climbs.filter(c => c.sessionId === s.id).length;
  const bits = [fmtDate(s.startedAt), fmtDuration(s.endedAt - s.startedAt), total && `${done}/${total} sets`, climbs && `${climbs} climb${climbs > 1 ? 's' : ''}`];
  return h('button', { class: 'card list-row', onclick: () => sessionSheet(s) },
    h('div', { class: 'grow' },
      h('div', { class: 'card-title' }, s.name),
      h('p', { class: 'muted small' }, bits.filter(Boolean).join(' · '))),
    h('span', { class: 'chev' }, '›'));
}

async function startSession(plan) {
  if (activeSession()) {
    toast('Finish your current session first');
    state.tab = 'train';
    render();
    return;
  }
  const s = {
    id: uid(), planId: plan?.id ?? null, name: plan?.name ?? 'Session', startedAt: Date.now(), endedAt: null, notes: '',
    exercises: (plan?.exercises ?? []).map(e => ({ ...e, id: uid(), done: Array(e.sets).fill(false), note: '', climbIds: [], climbDone: {} })),
  };
  await save('sessions', s);
  state.tab = 'train';
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
    h('header', { class: 'page-head' },
      h('div', { class: 'grow' }, h('p', { class: 'eyebrow' }, 'In session'), h('h1', {}, s.name)),
      h('div', { class: 'elapsed', 'data-elapsed': s.startedAt })),
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
    h('div', { class: 'row gap' },
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!confirm('Discard this session? Climbs you logged stay in your climb log.')) return;
          timer.stop();
          await remove('sessions', s.id);
          render();
        },
      }, 'Discard'),
      h('button', {
        class: 'btn primary grow',
        onclick: async () => {
          flushPending();
          s.endedAt = Date.now();
          await save('sessions', s);
          timer.stop();
          render();
          toast('Session saved 💪');
        },
      }, 'Finish session')));
}

function exerciseCard(s, e) {
  const complete = e.done.length > 0 && e.done.every(Boolean);
  const showNote = openNotes.has(e.id) || e.note;
  const meta = [repsLabel(e), e.rest ? `rest ${fmtTime(e.rest)}` : null].filter(Boolean).join(' · ');
  return h('div', { class: `card ex-card${complete ? ' complete' : ''}` },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'card-title' }, e.name), h('p', { class: 'muted small' }, meta)),
      h('button', {
        class: 'icon-btn', 'aria-label': 'Add note',
        onclick: () => { openNotes.has(e.id) ? openNotes.delete(e.id) : openNotes.add(e.id); render(); },
      }, '✎')),
    e.tip && h('details', {
      class: 'tip', open: openTips.has(e.id),
      ontoggle: ev => (ev.target.open ? openTips.add(e.id) : openTips.delete(e.id)),
    }, h('summary', {}, 'How to'), h('p', {}, e.tip)),
    h('div', { class: 'sets' },
      e.done.map((d, i) => h('button', {
        class: `set${d ? ' done' : ''}`, 'aria-label': `Set ${i + 1}${d ? ' done' : ''}`,
        onclick: () => toggleSet(s, e, i),
      }, d ? '✓' : i + 1)),
      h('button', {
        class: 'set add', 'aria-label': 'Add a set',
        onclick: () => {
          e.done.push(false);
          for (const arr of Object.values(e.climbDone ?? {})) arr.push(false);
          e.sets = e.done.length;
          save('sessions', s);
          render();
        },
      }, '+')),
    e.trackClimbs && exerciseClimbs(s, e),
    showNote && h('textarea', {
      class: 'input ex-note', rows: 2, placeholder: 'Notes: weight used, how it felt…', value: e.note || '',
      oninput: ev => { e.note = ev.target.value; saveLater('sessions', s); },
    }));
}

// Climbs attached to an exercise each get a dot per round; a round is done when every climb in it is ticked
const linkedClimbs = e => (e.climbIds ?? []).map(id => state.climbs.find(c => c.id === id)).filter(Boolean);

function syncRounds(e) {
  const climbs = linkedClimbs(e);
  if (climbs.length) e.done = e.done.map((_, i) => climbs.every(c => e.climbDone[c.id]?.[i]));
}

function exerciseClimbs(s, e) {
  return h('div', { class: 'ex-climbs' },
    linkedClimbs(e).map(c => h('div', { class: 'ex-climb' },
      h('button', { class: 'ex-climb-thumb', 'aria-label': `Edit ${c.name || grade(c.grade).name}`, onclick: () => climbSheet(c) },
        c.photoIds?.[0] ? photoImg(c.photoIds[0]) : h('span', { style: { background: grade(c.grade).color } })),
      h('div', { class: 'grow' },
        h('div', { class: 'row tight' },
          swatch(c.grade),
          h('strong', { class: 'grow ex-climb-name' }, c.name || grade(c.grade).name),
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
    h('button', { class: 'btn small ghost', style: { marginTop: '10px' }, onclick: () => attachClimbSheet(s, e) }, '+ Add climb to this'));
}

function toggleSet(s, e, i) {
  const value = !e.done[i];
  for (const c of linkedClimbs(e)) e.climbDone[c.id][i] = value;
  e.done[i] = value;
  if (value && e.rest > 0) timer.start(e.rest, `Rest · ${e.name}`);
  save('sessions', s);
  render();
}

function toggleClimbRound(s, e, climbId, i) {
  const wasDone = e.done[i];
  e.climbDone[climbId][i] = !e.climbDone[climbId][i];
  syncRounds(e);
  if (!wasDone && e.done[i] && e.rest > 0) timer.start(e.rest, `Rest · ${e.name} · round ${i + 1}`);
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

function sessionSheet(s) {
  const climbs = state.climbs.filter(c => c.sessionId === s.id);
  const body = h('div', {},
    h('p', { class: 'muted' }, `${fmtDate(s.startedAt)} · ${fmtDuration(s.endedAt - s.startedAt)}`),
    s.exercises.length ? h('h3', { class: 'section-title' }, 'Exercises') : null,
    s.exercises.map(e => h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'grow card-title' }, e.name),
        h('span', { class: 'muted small' }, `${e.done.filter(Boolean).length}/${e.done.length}`)),
      linkedClimbs(e).length ? h('p', { class: 'muted small' }, linkedClimbs(e).map(c => c.name || grade(c.grade).name).join(', ')) : null,
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
        closeSheet();
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
    .filter(c => (f === 'all' || (f === 'project' ? c.status === 'project' : c.status !== 'project')) && (!g || c.grade === g))
    .sort((a, b) => b.date - a.date);
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Climbs'), h('button', { class: 'btn primary', onclick: () => climbSheet(null) }, '+ Add climb')),
    h('div', { class: 'seg' }, [['all', 'All'], ['project', 'Projects'], ['sent', 'Sent']].map(([k, label]) =>
      h('button', { class: f === k ? 'on' : '', onclick: () => { state.climbFilter = k; render(); } }, label))),
    h('div', { class: 'chip-row' }, state.settings.grades.map(gr =>
      h('button', {
        class: `chip${g === gr.id ? ' on' : ''}`,
        onclick: () => { state.gradeFilter = g === gr.id ? null : gr.id; render(); },
      }, swatch(gr.id), gr.name))),
    list.length
      ? h('div', { class: 'climb-grid', style: { marginTop: '8px' } }, list.map(c => climbTile(c)))
      : h('div', { class: 'empty' }, state.climbs.length ? 'Nothing matches that filter.' : 'No climbs yet. Tap “Add climb” and snap a photo of your first one.'));
}

function climbTile(c, onClick = () => climbSheet(c)) {
  const meta = [fmtDate(c.date), c.status !== 'flash' && c.attempts ? `${c.attempts} ${c.attempts === 1 ? 'go' : 'goes'}` : null];
  return h('button', { class: 'climb-tile', onclick: onClick },
    c.photoIds?.[0] ? photoImg(c.photoIds[0], 'tile-img') : h('div', { class: 'tile-img placeholder', style: { background: grade(c.grade).color } }),
    h('div', { class: 'tile-meta' },
      h('div', { class: 'row tight' }, swatch(c.grade), h('strong', {}, c.name || grade(c.grade).name)),
      h('span', { class: `badge ${c.status}` }, STATUS[c.status]),
      h('span', { class: 'muted small' }, meta.filter(Boolean).join(' · '))));
}

function climbSheet(existing, sessionId = null, onSaved = null) {
  const lastGrade = [...state.climbs].sort((a, b) => b.date - a.date)[0]?.grade;
  const c = existing ? structuredClone(existing) : {
    id: uid(), date: Date.now(), grade: lastGrade ?? state.settings.grades[0]?.id, name: '', status: 'project',
    attempts: 1, notes: '', photoIds: [], sessionId: sessionId ?? activeSession()?.id ?? null, sentAt: null,
  };
  const newPhotos = new Map();
  const removedPhotos = [];
  const body = h('div');

  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: async e => {
      for (const file of e.target.files) {
        const blob = await compressImage(file);
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
        h('label', { class: 'photo-add' }, h('span', {}, '📷'), 'Add photo', fileInput)),
      h('div', { class: 'field' }, h('span', {}, 'Colour'),
        h('div', { class: 'grade-picker' }, state.settings.grades.map(g =>
          h('button', { class: `grade-opt${c.grade === g.id ? ' on' : ''}`, onclick: () => { c.grade = g.id; draw(); } },
            swatch(g.id, 'lg'), g.name)))),
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
        await save('climbs', c);
        onSaved?.(c);
        closeSheet();
        render();
        if (!existing) toast(c.status === 'project' ? 'Project saved' : `${STATUS[c.status]}! Nice 🎉`);
      },
    }, 'Save'),
  ]);
}

// Plans tab
function plansView() {
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Plans'), h('button', { class: 'btn primary', onclick: () => planSheet(null) }, '+ New plan')),
    state.plans.map(p => h('div', { class: 'card' },
      h('div', { class: 'card-title' }, p.name),
      p.description && h('p', { class: 'muted small' }, p.description),
      h('p', { class: 'muted small' }, `${p.exercises.length} exercises · ${p.exercises.reduce((n, e) => n + e.sets, 0)} sets`),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn small', onclick: () => planSheet(p) }, 'Edit'),
        h('button', {
          class: 'btn small',
          onclick: async () => {
            await save('plans', { ...structuredClone(p), id: uid(), name: `${p.name} (copy)`, createdAt: Date.now() });
            render();
          },
        }, 'Duplicate'),
        h('button', { class: 'btn small primary', onclick: () => startSession(p) }, 'Start')))),
    !state.plans.length && h('div', { class: 'empty' }, 'No plans. Create one, or restore the starter plans from Progress → Settings.'));
}

function planSheet(existing) {
  const p = existing ? structuredClone(existing) : { id: uid(), name: '', description: '', exercises: [], createdAt: Date.now() };
  const body = h('div');
  const move = (i, d) => { const [x] = p.exercises.splice(i, 1); p.exercises.splice(i + d, 0, x); draw(); };

  function draw() {
    body.replaceChildren(
      field('Name', h('input', { class: 'input', value: p.name, placeholder: 'e.g. Capacity circuit', oninput: e => { p.name = e.target.value; } })),
      field('Description', h('textarea', { class: 'input', rows: 2, value: p.description, placeholder: 'What is this session for?', oninput: e => { p.description = e.target.value; } })),
      h('h3', { class: 'section-title' }, 'Exercises'),
      ...p.exercises.map((ex, i) => h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('button', { class: 'grow list-row', style: { border: 0, background: 'none', padding: 0 }, onclick: () => exerciseSheet(ex, upd => { p.exercises[i] = upd; draw(); }) },
            h('div', { class: 'grow' },
              h('div', { class: 'card-title' }, ex.name),
              h('p', { class: 'muted small' }, [ex.section, repsLabel(ex), ex.rest ? `rest ${fmtTime(ex.rest)}` : null].filter(Boolean).join(' · ')))),
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === p.exercises.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { p.exercises.splice(i, 1); draw(); } }, '✕')))),
      h('button', { class: 'btn ghost full', onclick: () => exerciseSheet(null, ex => { p.exercises.push(ex); draw(); }) }, '+ Add exercise'));
  }
  draw();

  openSheet(existing ? 'Edit plan' : 'New plan', body, [
    existing && h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm(`Delete “${p.name}”? Past sessions are kept.`)) return;
        await remove('plans', p.id);
        closeSheet();
        render();
      },
    }, 'Delete'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        if (!p.name.trim()) { toast('Give the plan a name'); return; }
        await save('plans', p);
        closeSheet();
        render();
      },
    }, 'Save plan'),
  ]);
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
  const hardest = sends.reduce((best, c) => (gradeIndex(c.grade) > gradeIndex(best?.grade) ? c : best), null);
  const grades = state.settings.grades;
  const perGrade = grades.map(g => ({
    g, sent: sends.filter(c => c.grade === g.id).length, flash: sends.filter(c => c.grade === g.id && c.status === 'flash').length,
  }));
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
  return h('div', {},
    h('header', { class: 'page-head' }, h('h1', {}, 'Progress')),
    h('div', { class: 'tiles' },
      tile('Sessions this month', done.filter(s => s.startedAt >= monthStart.getTime()).length),
      tile('Total sends', sends.length),
      tile('Hardest send', hardest ? [swatch(hardest.grade, 'lg'), grade(hardest.grade).name] : '—'),
      tile('Open projects', state.climbs.filter(c => c.status === 'project').length)),
    h('h3', { class: 'section-title' }, 'Sends by colour'),
    h('div', { class: 'card' }, [...perGrade].reverse().map(({ g, sent, flash }) =>
      h('div', { class: 'pyramid-row', title: `${g.name}: ${sent} sent, ${flash} flashed` },
        h('span', { class: 'name' }, swatch(g.id), g.name),
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
        h('span', {}, i === 7 ? 'Now' : new Date(w.start).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }))))),
    h('h3', { class: 'section-title' }, 'Settings'),
    h('div', { class: 'stack' },
      h('button', { class: 'card list-row', onclick: gradesSheet },
        h('div', { class: 'grow' }, h('div', { class: 'card-title' }, 'Grade colours'), h('p', { class: 'muted small' }, grades.map(g => g.name).join(' → '))),
        h('span', { class: 'chev' }, '›')),
      h('button', { class: 'card list-row', onclick: exportData },
        h('div', { class: 'grow' }, h('div', { class: 'card-title' }, 'Back up data'), h('p', { class: 'muted small' }, 'Save everything (incl. photos) to a file. Do this now and then!')),
        h('span', { class: 'chev' }, '›')),
      h('label', { class: 'card list-row' },
        h('div', { class: 'grow' }, h('div', { class: 'card-title' }, 'Restore from backup'), h('p', { class: 'muted small' }, 'Replaces everything on this device')),
        h('span', { class: 'chev' }, '›'),
        h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => importData(e.target.files[0]) })),
      h('button', {
        class: 'card list-row',
        onclick: async () => {
          if (!confirm('Add the 3 starter plans back? Your own plans are kept.')) return;
          await seedPlans();
          toast('Starter plans added');
          render();
        },
      }, h('div', { class: 'grow' }, h('div', { class: 'card-title' }, 'Restore starter plans')), h('span', { class: 'chev' }, '›'))),
    h('p', { class: 'muted small', style: { marginTop: '16px', textAlign: 'center' } }, 'Your data lives only on this phone.'));
}

function gradesSheet() {
  const grades = structuredClone(state.settings.grades);
  const body = h('div');
  const move = (i, d) => { const [x] = grades.splice(i, 1); grades.splice(i + d, 0, x); draw(); };
  function draw() {
    body.replaceChildren(
      h('p', { class: 'muted small' }, 'Easiest at the top, hardest at the bottom.'),
      h('div', { style: { marginTop: '12px' } }, grades.map((g, i) => h('div', { class: 'grade-edit' },
        h('input', { type: 'color', value: g.color, 'aria-label': `${g.name} colour`, oninput: e => { g.color = e.target.value; } }),
        h('input', { class: 'input', value: g.name, oninput: e => { g.name = e.target.value; } }),
        h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === grades.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Remove',
          onclick: () => {
            if (state.climbs.some(c => c.grade === g.id) && !confirm(`Some climbs use ${g.name}. Remove it anyway?`)) return;
            grades.splice(i, 1);
            draw();
          },
        }, '✕')))),
      h('button', { class: 'btn ghost full', onclick: () => { grades.push({ id: uid(), name: 'New', color: '#888888' }); draw(); } }, '+ Add colour'));
  }
  draw();
  openSheet('Grade colours', body, [
    h('button', { class: 'btn', onclick: () => { grades.splice(0, grades.length, ...structuredClone(DEFAULT_GRADES)); draw(); } }, 'Reset'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        state.settings.grades = grades.filter(g => g.name.trim());
        await saveSettings();
        closeSheet();
        render();
      },
    }, 'Save'),
  ]);
}

// Backup / restore
const blobToDataUrl = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

async function exportData() {
  toast('Preparing backup…');
  flushPending();
  const photos = await db.getAll('photos');
  const data = {
    app: 'betalab', version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, plans: state.plans, sessions: state.sessions, climbs: state.climbs,
    photos: await Promise.all(photos.map(async p => ({ id: p.id, data: await blobToDataUrl(p.blob) }))),
  };
  const name = `betalab-backup-${toDateInput(Date.now())}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  const url = URL.createObjectURL(file);
  // Sharing needs a fresh tap on iOS, so the backup is offered from a sheet once it's built
  const canShare = navigator.canShare?.({ files: [file] });
  openSheet('Backup ready', h('div', {},
    h('p', {}, `${state.climbs.length} climbs, ${state.sessions.length} sessions, ${photos.length} photos · ${file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`}`),
    h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Save it to Files, iCloud Drive or send it to yourself. Restore it from Progress → Restore from backup.')), [
    canShare
      ? h('button', { class: 'btn primary', onclick: () => navigator.share({ files: [file], title: 'Beta Lab backup' }).then(closeSheet).catch(() => {}) }, 'Save / share file')
      : h('a', { class: 'btn primary', href: url, download: name, onclick: () => setTimeout(closeSheet, 300) }, 'Download file'),
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

async function seedPlans() {
  const now = Date.now();
  for (const [i, p] of defaultPlans().entries()) {
    await db.put('plans', { ...p, id: uid(), createdAt: now + i, exercises: p.exercises.map(e => ({ ...e })) });
  }
  await loadAll();
}

async function loadAll() {
  const [plans, sessions, climbs, settings] = await Promise.all([
    db.getAll('plans'), db.getAll('sessions'), db.getAll('climbs'), db.get('meta', 'settings'),
  ]);
  state.plans = plans.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  state.sessions = sessions;
  state.climbs = climbs;
  state.settings = settings ?? { id: 'settings', grades: structuredClone(DEFAULT_GRADES) };
}

async function init() {
  await loadAll();
  if (!(await db.get('meta', 'seeded'))) {
    await seedPlans();
    await db.put('meta', { id: 'seeded', at: Date.now() });
    await saveSettings();
  } else if (!(await db.get('meta', 'trackClimbs'))) {
    // Plans seeded before per-climb tracking existed: switch it on for the climbing exercises
    for (const item of [...state.plans, ...state.sessions.filter(s => !s.endedAt)]) {
      for (const e of item.exercises) if (e.trackClimbs === undefined && CLIMB_EXERCISES.includes(e.name)) e.trackClimbs = true;
      await db.put(item.endedAt === undefined ? 'plans' : 'sessions', item);
    }
  }
  await db.put('meta', { id: 'trackClimbs', at: Date.now() });
  navigator.storage?.persist?.();
  document.querySelectorAll('.tabbar button').forEach(b => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
  timer.init();
  setInterval(tickElapsed, 15000);
  render();
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js');
}

init();
