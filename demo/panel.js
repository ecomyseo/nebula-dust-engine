/**
 * A small control panel for the demo, in the manner of guspira
 * (https://github.com/spite/guspira, MIT License, Copyright (c) 2026 Jaume
 * Sanchez), the panel of spite's bumpy-metaballs-2026. The code is this demo's
 * own; the class names follow guspira's so that its stylesheet, adapted in
 * panel.css with its licence notice, applies.
 *
 *   const gui = new Panel('Title', parent, { storageKey: 'my-demo' });
 *   gui.addTab('Group');
 *   gui.addSection('Color', { key: 'color' });
 *   const c = gui.addSlider('Opacity', 0.8, 0, 1, 0.01, { key: 'opacity', onChange });
 *   c.set(0.5);          // moves the control without calling onChange
 *   c.randomize();       // what a click on its label does
 *
 * As in guspira: sections fold when their title is clicked, the panel folds
 * from its title, the open tab and sections are remembered, a slider's reading
 * turns into a text field when clicked, and clicking a label rerolls that
 * control (`randomizable: false` or `c.randomize = null` opts out).
 *
 * Every control's element carries id="ctl-<key>" and they are all in
 * `gui.controllers`, which is what the tests drive.
 */

const store = {
  get(k) {
    try { return globalThis.localStorage ? globalThis.localStorage.getItem(k) : null; } catch { return null; }
  },
  set(k, v) {
    try { if (globalThis.localStorage) globalThis.localStorage.setItem(k, v); } catch { /* private window */ }
  }
};

let randomSource = Math.random;
/** The random source of every reroll (tests pass a seeded one). */
export function setRandomSource(fn) {
  randomSource = typeof fn === 'function' ? fn : Math.random;
}
export const random = () => randomSource();

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function chevron() {
  const c = el('span', 'gui-chevron');
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** Decimals to show for a step (0.01 → 2). */
function decimals(step) {
  const s = String(step);
  if (s.includes('e-')) return Math.min(4, Number(s.split('e-')[1]) || 0);
  return s.includes('.') ? Math.min(4, s.split('.')[1].length) : 0;
}

function snap(v, min, max, step) {
  const n = step > 0 ? min + Math.round((v - min) / step) * step : v;
  return Math.min(max, Math.max(min, Number(n.toFixed(6))));
}

function randomHex() {
  const h = random() * 6;
  const s = 0.35 + random() * 0.5;
  const l = 0.35 + random() * 0.4;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

export class Panel {
  constructor(title, parent, { storageKey = '', collapsed = null } = {}) {
    this.storageKey = storageKey;
    this.controllers = new Map();
    this.tabs = new Map();
    this.sections = new Map();
    this.root = el('div', 'gui visible');
    this.titleEl = el('button', 'gui-title');
    this.titleEl.type = 'button';
    this.titleEl.id = 'gui-title';
    const text = el('span', 'gui-title-text', title);
    this.subtitleEl = el('span', 'gui-title-preset');
    this.subtitleEl.id = 'gui-subtitle';
    text.appendChild(this.subtitleEl);
    this.titleEl.appendChild(text);
    this.titleEl.appendChild(chevron());
    this.scroller = el('div', 'gui-scroller');
    this.rows = el('div', 'gui-rows visible');
    this.rows.id = 'gui-rows';
    this.scroller.appendChild(this.rows);
    this.root.appendChild(this.titleEl);
    this.root.appendChild(this.scroller);
    parent.appendChild(this.root);
    this._target = this.rows;
    this._tabPanel = null;
    this._tabbar = null;
    this.titleEl.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    const saved = storageKey ? store.get(storageKey + ':collapsed') : null;
    this.setCollapsed(collapsed !== null ? collapsed : saved === '1', { save: false });
  }

  get collapsed() {
    return this.root.classList.contains('collapsed');
  }

  setCollapsed(on, { save = true } = {}) {
    this.root.classList.toggle('collapsed', Boolean(on));
    this.rows.classList.toggle('visible', !on);
    this.titleEl.setAttribute('aria-expanded', String(!on));
    if (save && this.storageKey) store.set(this.storageKey + ':collapsed', on ? '1' : '0');
  }

  setSubtitle(text) {
    const t = String(text || '');
    if (this.subtitleEl.textContent !== t) this.subtitleEl.textContent = t;
  }

  /* ---------------------------------------------------------------- structure */
  /** Rows added after this call go into a new tab. */
  addTab(name, { key = name.toLowerCase() } = {}) {
    if (!this._tabbar) {
      this._tabbar = el('div', 'gui-tabbar');
      this._tabbar.setAttribute('role', 'tablist');
      this.rows.appendChild(this._tabbar);
    }
    const button = el('button', 'gui-tab-btn', name);
    button.type = 'button';
    button.id = 'tab-' + key;
    button.setAttribute('role', 'tab');
    const panel = el('div', 'gui-tab-panel');
    panel.id = 'tabpanel-' + key;
    panel.setAttribute('role', 'tabpanel');
    this._tabbar.appendChild(button);
    this.rows.appendChild(panel);
    this.tabs.set(name, { button, panel, key });
    button.addEventListener('click', () => this.selectTab(name));
    this._tabPanel = panel;
    this._target = panel;
    const saved = this.storageKey ? store.get(this.storageKey + ':tab') : null;
    if (this.tabs.size === 1 || saved === name) this.selectTab(name, { save: false });
    return panel;
  }

  selectTab(name, { save = true } = {}) {
    if (!this.tabs.has(name)) return;
    for (const [n, t] of this.tabs) {
      const on = n === name;
      t.button.classList.toggle('active', on);
      t.button.setAttribute('aria-selected', String(on));
      t.panel.classList.toggle('active', on);
    }
    this.activeTab = name;
    if (save && this.storageKey) store.set(this.storageKey + ':tab', name);
  }

  /** Rows added after this call go into a folding section of the current tab. */
  addSection(name, { open = true, key = '' } = {}) {
    const host = this._tabPanel || this.rows;
    const saved = key && this.storageKey ? store.get(this.storageKey + ':sec:' + key) : null;
    const isOpen = saved === null ? open : saved === '1';
    const section = el('div', 'gui-section' + (isOpen ? ' open' : ''));
    const head = el('button', 'gui-section-title gui-collapsible');
    head.type = 'button';
    if (key) {
      head.id = 'sec-' + key;
      section.id = 'section-' + key;
    }
    head.appendChild(el('span', '', name));
    head.appendChild(chevron());
    head.setAttribute('aria-expanded', String(isOpen));
    const body = el('div', 'gui-section-body');
    section.appendChild(head);
    section.appendChild(body);
    host.appendChild(section);
    const storageKey = this.storageKey;
    const api = {
      el: section,
      head,
      body,
      get open() { return section.classList.contains('open'); },
      setOpen(on, { save = true } = {}) {
        section.classList.toggle('open', Boolean(on));
        head.setAttribute('aria-expanded', String(Boolean(on)));
        if (save && key && storageKey) store.set(storageKey + ':sec:' + key, on ? '1' : '0');
      },
      setHidden(on) { section.hidden = Boolean(on); },
      setDisabled(on) { section.classList.toggle('disabled', Boolean(on)); }
    };
    head.addEventListener('click', () => api.setOpen(!api.open));
    if (key) this.sections.set(key, api);
    this._target = body;
    return api;
  }

  /** Back to the tab (or the header) after a section. */
  endSection() {
    this._target = this._tabPanel || this.rows;
  }

  /* ---------------------------------------------------------------- rows */
  _row(label, { title = '', block = false, compact = false } = {}) {
    const row = el('div', 'gui-row' + (block ? ' gui-row-block' : '') + (compact ? ' gui-compact' : ''));
    let labelEl = null;
    if (label) {
      labelEl = el('span', 'gui-label', label);
      if (title) labelEl.title = title;
      row.appendChild(labelEl);
    }
    this._target.appendChild(row);
    return { row, labelEl };
  }

  _register(key, c) {
    if (!key) return c;
    if (this.controllers.has(key)) throw new Error('Panel: two controls named ' + key);
    c.key = key;
    if (c.input && !c.input.id) c.input.id = 'ctl-' + key;
    this.controllers.set(key, c);
    return c;
  }

  /** What every controller has: its row, label, input, disabled and hidden states and a reroll. */
  _base(row, labelEl, input, { randomizable = true, title = '' } = {}) {
    let reroll = null;
    const c = {
      row,
      labelEl,
      input,
      title,
      setDisabled(on) {
        row.classList.toggle('disabled', Boolean(on));
        if (input) input.disabled = Boolean(on);
      },
      get disabled() { return row.classList.contains('disabled'); },
      setHidden(on) { row.hidden = Boolean(on); },
      get hidden() { return row.hidden; },
      get randomize() { return reroll; },
      set randomize(fn) {
        reroll = typeof fn === 'function' ? fn : null;
        if (!labelEl) return;
        labelEl.classList.toggle('gui-randomizable', Boolean(reroll));
        const hint = 'Click to randomize.';
        const base = title ? title + '\n\n' : '';
        labelEl.title = reroll ? base + hint : title;
      }
    };
    c._allowRandom = randomizable;
    if (labelEl) {
      labelEl.addEventListener('click', () => {
        if (reroll && !c.disabled && !row.hidden) reroll();
      });
    }
    return c;
  }

  /** A slider with its reading; the reading turns into a text field when clicked. */
  addSlider(label, value, min, max, step, { key = '', title = '', onChange = null, format = null, randomizable = true, range = null } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const box = el('div', 'gui-slider-container');
    const input = el('input', 'gui-slider');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const reading = el('span', 'gui-slider-val');
    reading.title = 'Click to type a value';
    box.appendChild(input);
    box.appendChild(reading);
    row.appendChild(box);
    const dp = decimals(step);
    const show = (v) => (format ? format(v) : Number(v).toFixed(dp));
    const paint = () => {
      const v = Number(input.value);
      reading.textContent = show(v);
      const p = max > min ? ((v - min) / (max - min)) * 100 : 0;
      if (input.style && typeof input.style.setProperty === 'function') input.style.setProperty('--fill', p.toFixed(2) + '%');
    };
    const c = this._base(row, labelEl, input, { randomizable, title });
    c.reading = reading;
    c.min = min;
    c.max = max;
    c.step = step;
    c.get = () => Number(input.value);
    c.set = (v) => { input.value = String(v); paint(); };
    c.fire = () => { paint(); if (onChange) onChange(Number(input.value)); };
    input.addEventListener('input', c.fire);
    /* type a value: click the reading */
    reading.addEventListener('click', () => {
      if (input.disabled) return;
      const edit = el('input', 'gui-slider-edit');
      edit.type = 'text';
      edit.value = reading.textContent;
      edit.setAttribute('aria-label', label + ' value');
      const done = (apply) => {
        if (!edit.parentNode) return;
        const n = Number(String(edit.value).replace(',', '.'));
        box.removeChild(edit);
        reading.hidden = false;
        c.editor = null;
        if (apply && Number.isFinite(n)) {
          input.value = String(Math.min(max, Math.max(min, n)));
          c.fire();
        }
      };
      edit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
        if (e.stopPropagation) e.stopPropagation();
      });
      edit.addEventListener('change', () => done(true));
      edit.addEventListener('blur', () => done(true));
      reading.hidden = true;
      box.appendChild(edit);
      c.editor = edit;
      if (typeof edit.focus === 'function') edit.focus();
      if (typeof edit.select === 'function') edit.select();
    });
    if (randomizable) {
      const [lo, hi] = range || [min, max];
      c.randomize = () => { c.set(snap(lo + random() * (hi - lo), min, max, step)); c.fire(); };
    }
    c.set(value);
    return this._register(key, c);
  }

  /**
   * options: [[value, text, disabled?], …] or [{ group: 'Title', items: [[value, text], …] }, …].
   * `buttons`: small buttons after the select (the preset row's ‹ ›).
   */
  addSelect(label, value, options, { key = '', title = '', onChange = null, randomizable = true, buttons = null } = {}) {
    const { row, labelEl } = this._row(label, { title, compact: Boolean(buttons) });
    const input = el('select', 'gui-select');
    input.setAttribute('aria-label', label);
    if (buttons && buttons[0] && buttons[0].before) {
      row.appendChild(this._miniButton(buttons[0]).input);
    }
    row.appendChild(input);
    if (buttons) for (const b of buttons) if (!b.before) row.appendChild(this._miniButton(b).input);
    const c = this._base(row, labelEl, input, { randomizable, title });
    c.setOptions = (opts) => {
      const keep = input.value;
      input.textContent = '';
      for (const o of opts) {
        if (o && o.group) {
          const g = el('optgroup');
          g.label = o.group;
          for (const it of o.items) g.appendChild(option(it));
          input.appendChild(g);
        } else {
          input.appendChild(option(o));
        }
      }
      if (keep) input.value = keep;
    };
    c.options = () => {
      const out = [];
      const walk = (e) => { for (const ch of e.children) { if (ch.tagName === 'OPTION') out.push(ch); else walk(ch); } };
      walk(input);
      return out;
    };
    c.get = () => input.value;
    c.set = (v) => { input.value = String(v ?? ''); };
    c.fire = () => { if (onChange) onChange(input.value); };
    input.addEventListener('change', c.fire);
    if (randomizable) {
      c.randomize = () => {
        const list = c.options().filter((o) => !o.disabled && o.value !== '' && o.value !== input.value);
        if (!list.length) return;
        input.value = list[Math.floor(random() * list.length)].value;
        c.fire();
      };
    }
    c.setOptions(options);
    c.set(value);
    return this._register(key, c);
  }

  _miniButton(b) {
    const button = el('button', 'gui-btn gui-btn-mini', b.label);
    button.type = 'button';
    if (b.title) button.title = b.title;
    if (b.ariaLabel) button.setAttribute('aria-label', b.ariaLabel);
    const c = { input: button, key: '', row: null };
    c.setDisabled = (on) => { button.disabled = Boolean(on); };
    c.setHidden = (on) => { button.hidden = Boolean(on); };
    c.setLabel = (t) => { button.textContent = t; };
    c.fire = () => { if (b.onClick && !button.disabled) b.onClick(); };
    button.addEventListener('click', c.fire);
    this._register(b.key, c);
    return c;
  }

  addCheckbox(label, value, { key = '', title = '', onChange = null, randomizable = false } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const input = el('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    row.appendChild(input);
    const c = this._base(row, labelEl, input, { randomizable, title });
    c.get = () => Boolean(input.checked);
    c.set = (v) => { input.checked = Boolean(v); };
    c.fire = () => { if (onChange) onChange(Boolean(input.checked)); };
    input.addEventListener('change', c.fire);
    if (randomizable) c.randomize = () => { input.checked = random() < 0.5; c.fire(); };
    /* a click on the label toggles it, as a <label> would */
    else if (labelEl) labelEl.addEventListener('click', () => { if (!c.disabled) { input.checked = !input.checked; c.fire(); } });
    c.set(value);
    return this._register(key, c);
  }

  addColor(label, value, { key = '', title = '', onChange = null, randomizable = true } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const input = el('input', 'gui-color');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    row.appendChild(input);
    const c = this._base(row, labelEl, input, { randomizable, title });
    c.get = () => input.value;
    c.set = (v) => { input.value = String(v); };
    c.fire = () => { if (onChange) onChange(input.value); };
    input.addEventListener('input', c.fire);
    if (randomizable) c.randomize = () => { input.value = randomHex(); c.fire(); };
    c.set(value);
    return this._register(key, c);
  }

  /** Several colour swatches on one row; onChange(list). Their ids are ctl-<key>-0, -1… */
  addColors(label, values, { key = '', title = '', onChange = null, randomizable = true } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const box = el('div', 'gui-colors gui-control');
    row.appendChild(box);
    const inputs = values.map((v, i) => {
      const input = el('input', 'gui-color');
      input.type = 'color';
      input.value = v;
      if (key) input.id = 'ctl-' + key + '-' + i;
      input.setAttribute('aria-label', label + ' ' + (i + 1));
      box.appendChild(input);
      return input;
    });
    const c = this._base(row, labelEl, null, { randomizable, title });
    c.inputs = inputs;
    c.get = () => inputs.map((i) => i.value);
    c.set = (list) => { inputs.forEach((input, i) => { if (list && list.length) input.value = list[Math.min(i, list.length - 1)]; }); };
    c.fire = () => { if (onChange) onChange(c.get()); };
    for (const input of inputs) input.addEventListener('input', c.fire);
    c.setDisabled = (on) => {
      row.classList.toggle('disabled', Boolean(on));
      for (const input of inputs) input.disabled = Boolean(on);
    };
    if (randomizable) c.randomize = () => { for (const input of inputs) input.value = randomHex(); c.fire(); };
    return this._register(key, c);
  }

  /** A text field; onChange runs when it is committed (Enter or leaving it). */
  addText(label, value, { key = '', title = '', onChange = null, maxLength = 200, button = null } = {}) {
    const { row, labelEl } = this._row(label, { title, compact: Boolean(button) });
    const input = el('input', 'gui-input-text');
    input.type = 'text';
    input.setAttribute('maxlength', String(maxLength));
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-label', label);
    row.appendChild(input);
    if (button) row.appendChild(this._miniButton(button).input);
    const c = this._base(row, labelEl, input, { randomizable: false, title });
    c.get = () => input.value;
    /* what is being typed is not overwritten by a refresh of the panel */
    c.set = (v, { force = false } = {}) => {
      if (!force && document.activeElement === input) return;
      input.value = String(v ?? '');
    };
    c.fire = () => { if (onChange) onChange(input.value); };
    input.addEventListener('change', c.fire);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typeof input.blur === 'function') input.blur(); });
    c.set(value);
    return this._register(key, c);
  }

  /** A joined row of buttons, one of them active: [[value, text, hint], …]. */
  addSegmented(label, value, options, { key = '', title = '', onChange = null, randomizable = true } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const box = el('div', 'gui-segmented gui-control');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', label || key);
    if (key) box.id = 'ctl-' + key;
    row.appendChild(box);
    const buttons = new Map();
    let current = value;
    const c = this._base(row, labelEl, null, { randomizable, title });
    c.buttons = buttons;
    c.el = box;
    c.get = () => current;
    c.set = (v) => {
      current = v;
      for (const [val, b] of buttons) {
        b.classList.toggle('active', val === v);
        b.setAttribute('aria-checked', String(val === v));
      }
    };
    c.pick = (v) => { c.set(v); if (onChange) onChange(v); };
    c.fire = () => { if (onChange) onChange(current); };
    for (const [val, text, hint] of options) {
      const b = el('button', 'gui-segment', text);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      if (key) b.id = 'ctl-' + key + '-' + val;
      if (hint) b.title = hint;
      b.addEventListener('click', () => { if (!b.disabled) c.pick(val); });
      box.appendChild(b);
      buttons.set(val, b);
    }
    c.setDisabled = (on) => {
      row.classList.toggle('disabled', Boolean(on));
      for (const b of buttons.values()) b.disabled = Boolean(on);
    };
    if (randomizable) {
      c.randomize = () => {
        const list = [...buttons.keys()].filter((v) => v !== current);
        if (list.length) c.pick(list[Math.floor(random() * list.length)]);
      };
    }
    c.set(value);
    return this._register(key, c);
  }

  /** A row of buttons: [{ label, key, title, onClick, mini }, …]. Each button is a controller. */
  addButtons(list, { label = '' } = {}) {
    const { row } = this._row(label);
    const group = el('div', 'gui-btn-group');
    row.appendChild(group);
    const out = [];
    for (const b of list) {
      const button = el('button', 'gui-btn' + (b.mini ? ' gui-btn-mini' : ''), b.label);
      button.type = 'button';
      if (b.title) button.title = b.title;
      if (b.ariaLabel) button.setAttribute('aria-label', b.ariaLabel);
      group.appendChild(button);
      const c = { row, input: button, labelEl: null };
      c.setDisabled = (on) => { button.disabled = Boolean(on); };
      c.setHidden = (on) => { button.hidden = Boolean(on); };
      c.setLabel = (t) => { if (button.textContent !== t) button.textContent = t; };
      c.fire = () => { if (b.onClick && !button.disabled) b.onClick(); };
      button.addEventListener('click', c.fire);
      out.push(this._register(b.key, c));
    }
    return out;
  }

  /** A read-only value on the right of its label. */
  addMonitor(label, { key = '', title = '' } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const value = el('span', 'gui-monitor', '—');
    row.appendChild(value);
    const c = this._base(row, labelEl, null, { randomizable: false, title });
    c.value = value;
    if (key) value.id = 'mon-' + key;
    c.get = () => value.textContent;
    c.set = (t) => { if (value.textContent !== String(t)) value.textContent = String(t); };
    c.setWarn = (on) => value.classList.toggle('gui-over', Boolean(on));
    return this._register(key, c);
  }

  /** A reading with its range, as bumpy-metaballs' stats: "16.4 ms   12.1–18.0". */
  addStat(label, { key = '', title = '' } = {}) {
    const { row, labelEl } = this._row(label, { title });
    const value = el('span', 'stat-value', '—');
    const range = el('span', 'stat-range', '');
    row.appendChild(value);
    row.appendChild(range);
    const c = this._base(row, labelEl, null, { randomizable: false, title });
    c.value = value;
    c.range = range;
    if (key) value.id = 'stat-' + key;
    c.get = () => value.textContent;
    c.set = (text, rangeText = '', warn = false) => {
      if (value.textContent !== String(text)) value.textContent = String(text);
      if (range.textContent !== String(rangeText)) range.textContent = String(rangeText);
      value.classList.toggle('stat-warn', Boolean(warn));
    };
    return this._register(key, c);
  }

  /** A paragraph of text (help, notes). */
  addNote(text, { key = '' } = {}) {
    const { row } = this._row('');
    const p = el('p', 'gui-text', text);
    if (key) p.id = 'note-' + key;
    row.appendChild(p);
    const c = this._base(row, null, null, { randomizable: false });
    c.el = p;
    c.set = (t) => { if (p.textContent !== String(t)) p.textContent = String(t); };
    c.get = () => p.textContent;
    return this._register(key, c);
  }

  /** Any element as a full-width row. */
  addElement(element, { key = '' } = {}) {
    const { row } = this._row('', { block: true });
    row.appendChild(element);
    const c = this._base(row, null, null, { randomizable: false });
    c.el = element;
    return this._register(key, c);
  }

  addSeparator() {
    const { row } = this._row('');
    row.appendChild(el('div', 'gui-separator'));
  }

  /** Every control that can be rerolled (not disabled, not hidden, in `keys` if given). */
  randomizable(keys = null) {
    return [...this.controllers.values()].filter((c) => c.randomize && !c.disabled && !c.hidden && (!keys || keys.includes(c.key)));
  }
}

function option(o) {
  const [value, text, disabled] = Array.isArray(o) ? o : [o, o];
  const e = el('option', '', text);
  e.value = String(value);
  if (disabled) e.disabled = true;
  return e;
}

/* ------------------------------------------------------------------ keyboard */
const bindings = new Map();
let listening = false;

function isField(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = String(t.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const binding = bindings.get(e.code);
  if (!binding) return;
  /* as guspira: nothing fires while a field has focus, and Space on a button presses the button */
  if (isField(e.target)) return;
  if (e.code === 'Space' && String(e.target && e.target.tagName).toUpperCase() === 'BUTTON') return;
  if (e.repeat && !binding.repeat) return;
  if (binding.fn(e) === false) return;
  if (binding.preventDefault && typeof e.preventDefault === 'function') e.preventDefault();
}

/**
 * A key (KeyboardEvent.code) → action, as guspira's bindKey: ignored while a
 * field has focus and with Ctrl, Cmd or Alt held, so R does not fight Ctrl+R.
 * Returning false from the action lets the key through.
 */
export function bindKey(code, fn, { preventDefault = true, repeat = false, target = globalThis.window } = {}) {
  bindings.set(code, { fn, preventDefault, repeat });
  if (!listening && target && typeof target.addEventListener === 'function') {
    target.addEventListener('keydown', onKey);
    listening = true;
  }
  return () => bindings.delete(code);
}

/** Forgets every binding (a demo that stops). */
export function unbindAllKeys(target = globalThis.window) {
  bindings.clear();
  if (listening && target && typeof target.removeEventListener === 'function') target.removeEventListener('keydown', onKey);
  listening = false;
}
