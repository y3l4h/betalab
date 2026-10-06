// Rest timer: stored as an end timestamp so it stays correct if the app is backgrounded or reloaded
const KEY = 'betalab.timer';
let timer = load();
let audio = null;
let wakeLock = null;
let lastBeepSecond = null;
let ringTimeout = null;

const el = id => document.getElementById(id);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function persist() {
  try { timer ? localStorage.setItem(KEY, JSON.stringify(timer)) : localStorage.removeItem(KEY); } catch {}
}

export function start(seconds, label = 'Rest') {
  unlockAudio();
  clearRinging();
  timer = { endAt: Date.now() + seconds * 1000, total: seconds, label };
  persist();
  keepAwake();
  update();
}

export function add(seconds) {
  if (!timer) return;
  timer.endAt = Math.max(Date.now() + 1000, timer.endAt + seconds * 1000);
  timer.total = Math.max(1, timer.total + seconds);
  persist();
  update();
}

export function stop() {
  timer = null;
  persist();
  releaseAwake();
  clearRinging();
  update();
}

export function unlockAudio() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audio = new AC();
  }
  if (audio?.state === 'suspended') audio.resume();
}

function tone(freq, at, length = 0.18, volume = 0.4) {
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.value = freq;
  o.connect(g);
  g.connect(audio.destination);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(volume, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.start(at);
  o.stop(at + length + 0.02);
}

function beep(kind) {
  if (!audio) return;
  const now = audio.currentTime;
  if (kind === 'tick') tone(660, now, 0.08, 0.25);
  else [0, 0.22, 0.44].forEach((d, i) => tone(i === 2 ? 1320 : 990, now + d, i === 2 ? 0.4 : 0.16));
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {}
}
function releaseAwake() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function ring() {
  beep('done');
  navigator.vibrate?.([200, 100, 200]);
  el('timer').classList.add('ringing');
  ringTimeout = setTimeout(clearRinging, 4000);
}
function clearRinging() {
  clearTimeout(ringTimeout);
  el('timer')?.classList.remove('ringing');
  update();
}

const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function update() {
  const box = el('timer');
  if (!box) return;
  const ringing = box.classList.contains('ringing');
  box.hidden = !timer && !ringing;
  document.body.classList.toggle('timer-open', !box.hidden);
  if (ringing) {
    el('timer-label').textContent = 'Rest over';
    el('timer-time').textContent = 'Go!';
    el('timer-fill').style.width = '0%';
    return;
  }
  if (!timer) return;
  const left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  el('timer-label').textContent = timer.label;
  el('timer-time').textContent = fmt(left);
  el('timer-fill').style.width = `${Math.min(100, (left / timer.total) * 100)}%`;
}

function tick() {
  if (timer) {
    const msLeft = timer.endAt - Date.now();
    const secLeft = Math.ceil(msLeft / 1000);
    if (msLeft <= 0) {
      const late = -msLeft;
      timer = null;
      persist();
      releaseAwake();
      if (late < 60000) ring();
    } else if (secLeft <= 3 && secLeft !== lastBeepSecond) {
      lastBeepSecond = secLeft;
      beep('tick');
    }
  }
  update();
}

export function init() {
  el('timer-minus').onclick = () => add(-15);
  el('timer-plus').onclick = () => add(15);
  el('timer-close').onclick = stop;
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (timer) keepAwake();
      tick();
    }
  });
  if (timer) keepAwake();
  setInterval(tick, 250);
  update();
}
