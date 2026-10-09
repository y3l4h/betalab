// Zoomable gym map with pins. Pins are stored as fractions of the image (0–1), so they stay put at any size.
// Pins that land close together on screen merge into a numbered bubble; zooming in splits them apart.
const MAX_ZOOM = 8;
const CLUSTER_PX = 28;

export function createMapViewer({ url, width, height, pins = [], view, onPin, onCluster, onTap, selected }) {
  const stage = document.createElement('div');
  stage.className = 'map-stage';
  const img = document.createElement('img');
  img.className = 'map-img';
  img.alt = 'Gym map';
  img.draggable = false;
  Promise.resolve(url).then(u => { if (u) img.src = u; });
  const layer = document.createElement('div');
  layer.className = 'map-pins';
  stage.append(img, layer);

  // s = zoom (1 = whole map fits), tx/ty = image position inside the stage in px
  const t = { s: 1, tx: 0, ty: 0, base: 1, ready: false };
  let stageW = 0, stageH = 0;

  function fit() {
    stageW = stage.clientWidth;
    stageH = stage.clientHeight;
    if (!stageW || !stageH) return false;
    t.base = Math.min(stageW / width, stageH / height);
    if (!t.ready) {
      Object.assign(t, view?.s ? { s: view.s, tx: view.tx, ty: view.ty } : { s: 1, tx: (stageW - width * t.base) / 2, ty: (stageH - height * t.base) / 2 });
      t.ready = true;
    }
    clamp();
    return true;
  }

  function clamp() {
    t.s = Math.min(MAX_ZOOM, Math.max(1, t.s));
    const w = width * t.base * t.s, hgt = height * t.base * t.s;
    t.tx = w <= stageW ? (stageW - w) / 2 : Math.min(0, Math.max(stageW - w, t.tx));
    t.ty = hgt <= stageH ? (stageH - hgt) / 2 : Math.min(0, Math.max(stageH - hgt, t.ty));
  }

  const toScreen = p => ({ x: t.tx + p.x * width * t.base * t.s, y: t.ty + p.y * height * t.base * t.s });
  const toMap = (x, y) => ({ x: (x - t.tx) / (width * t.base * t.s), y: (y - t.ty) / (height * t.base * t.s) });

  function draw() {
    img.style.transform = `translate(${t.tx}px, ${t.ty}px)`;
    img.style.width = `${width * t.base * t.s}px`;
    img.style.height = `${height * t.base * t.s}px`;
    if (view) Object.assign(view, { s: t.s, tx: t.tx, ty: t.ty });
    drawPins();
  }

  function drawPins() {
    const clusters = [];
    // Fully zoomed in, every climb gets its own dot so each one can be tapped
    const radius = t.s >= MAX_ZOOM - 0.01 ? 0 : CLUSTER_PX;
    for (const pin of pins) {
      const p = toScreen(pin);
      if (pin.id === selected?.id) continue;
      const near = clusters.find(c => Math.hypot(c.x - p.x, c.y - p.y) < radius);
      if (near) {
        near.items.push(pin);
        near.x = (near.x * (near.items.length - 1) + p.x) / near.items.length;
        near.y = (near.y * (near.items.length - 1) + p.y) / near.items.length;
      } else clusters.push({ x: p.x, y: p.y, items: [pin] });
    }
    const els = clusters.map(c => {
      const b = document.createElement('button');
      b.style.left = `${c.x}px`;
      b.style.top = `${c.y}px`;
      if (c.items.length === 1) {
        const pin = c.items[0];
        b.className = `map-pin${pin.ring ? ' ring' : ''}${pin.faint ? ' faint' : ''}`;
        b.style.background = pin.color;
        b.setAttribute('aria-label', pin.label ?? 'Climb');
        b.onclick = e => { e.stopPropagation(); if (!moved) onPin?.(pin); };
      } else {
        const colors = new Set(c.items.map(i => i.color));
        const size = Math.min(52, 26 + c.items.length * 2);
        b.className = `map-cluster${c.items.some(i => i.faint) ? ' faint' : ''}`;
        b.style.width = b.style.height = `${size}px`;
        if (colors.size === 1) { b.style.background = c.items[0].color; b.classList.add('single-colour'); }
        b.textContent = c.items.length;
        b.setAttribute('aria-label', `${c.items.length} climbs here`);
        b.onclick = e => { e.stopPropagation(); if (!moved) onCluster?.(c.items.map(i => i.item)); };
      }
      if (!onPin && !onCluster) b.tabIndex = -1;
      return b;
    });
    if (selected) {
      const p = toScreen(selected);
      const mark = document.createElement('div');
      mark.className = 'map-pin selected';
      mark.style.left = `${p.x}px`;
      mark.style.top = `${p.y}px`;
      mark.style.background = selected.color;
      els.push(mark);
    }
    layer.replaceChildren(...els);
  }

  function zoomAt(x, y, factor) {
    const s = Math.min(MAX_ZOOM, Math.max(1, t.s * factor));
    t.tx = x - (x - t.tx) * (s / t.s);
    t.ty = y - (y - t.ty) * (s / t.s);
    t.s = s;
    clamp();
    draw();
  }

  // Gestures: one finger pans, two fingers pinch, a quick tap places/selects, double tap zooms in
  const pointers = new Map();
  let moved = false, startX = 0, startY = 0, startT = 0, lastTap = 0, pinch = null;
  const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  stage.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) { moved = false; startX = e.clientX; startY = e.clientY; startT = e.timeStamp; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: t.s };
      moved = true;
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const now = local(e);
    pointers.set(e.pointerId, now);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(mid.x, mid.y, (pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist) / t.s);
      return;
    }
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) moved = true;
    if (moved && pointers.size === 1) {
      t.tx += now.x - prev.x;
      t.ty += now.y - prev.y;
      clamp();
      draw();
    }
  });
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size || moved || e.timeStamp - startT > 400) return;
    if (e.timeStamp - lastTap < 300) { lastTap = 0; zoomAt(p.x, p.y, 2); return; }
    lastTap = e.timeStamp;
    if (e.target === stage || e.target === img || e.target === layer) {
      const m = toMap(p.x, p.y);
      if (m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1) onTap?.(m);
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch = null; });
  stage.addEventListener('wheel', e => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });

  // Size is only known once the stage is on screen, and changes when the phone rotates
  const refit = () => { if (fit()) draw(); };
  new ResizeObserver(refit).observe(stage);
  img.addEventListener('load', refit);
  setTimeout(refit, 0);

  return {
    el: stage,
    setSelected(p) { selected = p; drawPins(); },
    zoomIn() { zoomAt(stageW / 2, stageH / 2, 1.6); },
    zoomOut() { zoomAt(stageW / 2, stageH / 2, 1 / 1.6); },
  };
}
