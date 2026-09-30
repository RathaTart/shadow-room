// Minimal overlay UI: status pill, toasts, settings panel and silhouette preview.
// Auto-hides so it never gets in the way of the wallpaper.

const SCHEMA = [
  { group: 'Your shadow' },
  { key: 'camera', label: 'Use webcam', type: 'check' },
  { key: 'demo', label: 'Demo figure (no webcam)', type: 'check' },
  { key: 'hallIntensity', label: 'Shadow light', type: 'range', min: 0.2, max: 2, step: 0.05 },
  { key: 'hallHeight', label: 'Light height (m)', type: 'range', min: 1.2, max: 2.5, step: 0.01 },
  { key: 'hallDistance', label: 'Light distance (m)', type: 'range', min: 0.8, max: 4.5, step: 0.05 },
  { key: 'shadowSoftness', label: 'Softness', type: 'range', min: 0, max: 3, step: 0.05 },
  { key: 'shadowReach', label: 'Shadow travel', type: 'range', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'interactions', label: 'Objects react to shadow', type: 'check' },
  { group: '3D window' },
  { key: 'parallax', label: 'Head-tracked parallax', type: 'range', min: 0, max: 2.5, step: 0.05 },
  { key: 'headTurn', label: 'Head turn sensitivity', type: 'range', min: 0, max: 3, step: 0.05 },
  { key: 'lookAll', label: 'Look all around (360°, up/down)', type: 'check' },
  { key: 'autoCenter', label: 'Auto-center', type: 'check' },
  { key: 'webcamFov', label: 'Webcam FOV (°)', type: 'range', min: 45, max: 100, step: 1 },
  { key: 'mirror', label: 'Mirror webcam', type: 'check' },
  { group: 'Room' },
  { key: 'cat', label: 'Cat', type: 'check' },
  { key: 'roomLight', label: 'Ceiling lamp', type: 'check' },
  { key: 'roomIntensity', label: 'Lamp brightness', type: 'range', min: 0, max: 3, step: 0.05 },
  { key: 'moon', label: 'Moonlight', type: 'check' },
  { key: 'exposure', label: 'Exposure', type: 'range', min: 0.3, max: 2, step: 0.01 },
  { group: 'Performance' },
  { key: 'quality', label: 'Quality (reloads)', type: 'select', options: ['low', 'medium', 'high'] },
  { key: 'fpsCap', label: 'FPS cap', type: 'select', options: [24, 30, 60] },
  { key: 'bloom', label: 'Bloom', type: 'check' },
  { key: 'dust', label: 'Dust in the light', type: 'check' },
  { key: 'grain', label: 'Film grain', type: 'check' },
  { key: 'showPreview', label: 'Show silhouette preview', type: 'check' },
  { key: 'showTracking', label: 'Show tracking view (V)', type: 'check' },
];

export class UI {
  constructor(root, settings, { onAction, previewSource }) {
    this.root = root;
    this.settings = settings;
    this.onAction = onAction;
    this.previewSource = previewSource;
    this.hidden = !settings.get('showHud');
    this.lastActivity = performance.now();
    this.build();
    this.bind();
  }

  build() {
    this.root.innerHTML = `
      <div class="toast" role="status" aria-live="polite"></div>
      <div class="hud">
        <span class="dot"></span><span class="status">Starting…</span>
        <button class="center" title="Set your normal head position (C)">⌖ Center</button>
        <button class="gear" title="Settings (S)" aria-label="Open settings">⚙</button>
      </div>
      <div class="aim" aria-hidden="true"></div>
      <canvas class="preview" width="160" height="130" aria-hidden="true"></canvas>
      <aside class="panel" aria-label="Settings">
        <header><strong>Shadow Room</strong><button class="close" aria-label="Close settings">✕</button></header>
        <div class="rows"></div>
        <footer>
          <button data-action="recenter">Center my head (C)</button>
          <button data-action="reset">Reset</button>
        </footer>
        <p class="hint">Keys: S settings · H hide UI · C center my head · D demo · L lamp · T TV · V tracking view. Everything runs locally; no video leaves this PC.</p>
      </aside>`;
    this.toastEl = this.root.querySelector('.toast');
    this.hud = this.root.querySelector('.hud');
    this.statusEl = this.root.querySelector('.status');
    this.dot = this.root.querySelector('.dot');
    this.panel = this.root.querySelector('.panel');
    this.aim = this.root.querySelector('.aim');
    this.preview = this.root.querySelector('.preview');
    this.previewCtx = this.preview.getContext('2d');
    const rows = this.root.querySelector('.rows');
    this.inputs = new Map();
    for (const item of SCHEMA) {
      if (item.group) {
        const h = document.createElement('h3');
        h.textContent = item.group;
        rows.appendChild(h);
        continue;
      }
      const row = document.createElement('label');
      row.className = `row ${item.type}`;
      const name = document.createElement('span');
      name.textContent = item.label;
      let input;
      if (item.type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox';
      } else if (item.type === 'range') {
        input = document.createElement('input');
        input.type = 'range';
        input.min = item.min;
        input.max = item.max;
        input.step = item.step;
      } else {
        input = document.createElement('select');
        for (const o of item.options) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          input.appendChild(opt);
        }
      }
      const value = document.createElement('output');
      row.append(name, input, value);
      rows.appendChild(row);
      this.inputs.set(item.key, { input, value, item });
      input.addEventListener('input', () => {
        const v = item.type === 'check' ? input.checked : item.type === 'range' ? Number(input.value) : input.value;
        this.settings.set(item.key, v);
        if (item.key === 'quality') this.onAction('reload');
      });
    }
    this.panel.inert = true;
    this.syncInputs();
    this.applyVisibility();
  }

  syncInputs() {
    for (const [key, { input, value, item }] of this.inputs) {
      const v = this.settings.get(key);
      if (item.type === 'check') input.checked = !!v;
      else input.value = v;
      value.textContent = item.type === 'range' ? Number(v).toFixed(item.step < 0.1 ? 2 : 1) : '';
    }
  }

  bind() {
    this.hud.querySelector('.gear').addEventListener('click', () => this.togglePanel());
    this.hud.querySelector('.center').addEventListener('click', () => this.onAction('recenter'));
    this.panel.querySelector('.close').addEventListener('click', () => this.togglePanel(false));
    this.panel.querySelectorAll('footer button').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.action;
      if (a === 'reset') { this.settings.reset(); this.syncInputs(); }
      this.onAction(a);
    }));
    this.settings.onChange(() => this.syncInputs());
    window.addEventListener('pointermove', () => this.activity());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;   // leave browser shortcuts alone
      const k = e.key.toLowerCase();
      if (k === 's') this.togglePanel();
      else if (k === 'h') { this.hidden = !this.hidden; this.settings.set('showHud', !this.hidden); this.applyVisibility(); }
      else if (k === 'escape') this.togglePanel(false);
      else this.onAction(`key:${k}`);
      this.activity();
    });
  }

  activity() {
    this.lastActivity = performance.now();
    this.root.classList.add('active');
  }

  togglePanel(force) {
    const open = force ?? !this.panel.classList.contains('open');
    this.panel.classList.toggle('open', open);
    this.root.classList.toggle('panel-open', open);   // the tracking view moves aside
    this.panel.inert = !open;   // off-screen controls must not be reachable with Tab
    if (open) { this.hidden = false; this.applyVisibility(); this.syncInputs(); }
  }

  applyVisibility() {
    this.root.classList.toggle('hidden', this.hidden);
  }

  // The target in the middle of the screen, to look at while centering.
  showAim(on) {
    this.aim.classList.toggle('show', on);
  }

  setStatus(text, kind = 'ok') {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
    this.dot.dataset.kind = kind;
  }

  // An important toast (priority > 0) is not replaced by a lesser one while it is showing.
  toast(text, ms = 3500, priority = 0) {
    const now = performance.now();
    if (priority < (this.toastPriority || 0) && now < (this.toastUntil || 0)) return;
    this.toastPriority = priority;
    this.toastUntil = now + ms;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  update(now) {
    if (now - this.lastActivity > 4000 && !this.panel.classList.contains('open')) this.root.classList.remove('active');
    const show = this.settings.get('showPreview') && !this.hidden;
    this.preview.style.display = show ? 'block' : 'none';
    if (show && this.previewSource) {
      const src = this.previewSource();
      const c = this.previewCtx;
      c.fillStyle = '#000';
      c.fillRect(0, 0, this.preview.width, this.preview.height);
      c.drawImage(src, 0, 0, this.preview.width, this.preview.height);
    }
  }
}
