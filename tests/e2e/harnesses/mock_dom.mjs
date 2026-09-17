// tests/e2e/harnesses/mock_dom.mjs
/**
 * Zero-dependency Browser Mock Environment for Node.js (v25+)
 * Provides Mock DOM, Web Audio API, VirtualClock, and WebGL stubs for progress.js & map.html testing.
 */

export class VirtualClock {
  constructor() {
    this.now = 0;
    this.rafQueue = [];
    this.timers = [];
    this.nextId = 1;
  }

  performanceNow() {
    return this.now;
  }

  setTimeout(fn, delay = 0) {
    const id = this.nextId++;
    this.timers.push({ id, fn, triggerAt: this.now + Math.max(0, delay) });
    return id;
  }

  clearTimeout(id) {
    this.timers = this.timers.filter(t => t.id !== id);
  }

  requestAnimationFrame(fn) {
    const id = this.nextId++;
    this.rafQueue.push({ id, fn });
    return id;
  }

  cancelAnimationFrame(id) {
    this.rafQueue = this.rafQueue.filter(r => r.id !== id);
  }

  tick(deltaMs) {
    const target = this.now + deltaMs;
    while (this.now < target) {
      const step = Math.min(16.67, target - this.now);
      this.now += step;

      // Fire due timers
      const due = this.timers.filter(t => t.triggerAt <= this.now);
      this.timers = this.timers.filter(t => t.triggerAt > this.now);
      for (const t of due) {
        try { t.fn(); } catch (_) {}
      }

      // Fire current RAF queue
      const rafs = this.rafQueue;
      this.rafQueue = [];
      for (const r of rafs) {
        try { r.fn(this.now); } catch (_) {}
      }
    }
  }
}

export class MockClassList extends Set {
  add(...tokens) {
    for (const t of tokens) if (t) super.add(t);
  }

  remove(...tokens) {
    for (const t of tokens) super.delete(t);
  }

  contains(t) {
    return super.has(t);
  }

  toggle(t, force) {
    if (force !== undefined) {
      if (force) this.add(t); else this.remove(t);
      return force;
    }
    if (this.contains(t)) {
      this.remove(t);
      return false;
    }
    this.add(t);
    return true;
  }

  toString() {
    return Array.from(this).join(' ');
  }
}

export class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList();
    this.attributes = {};
    this.listeners = new Map();
    this._textContent = '';
    this._hidden = false;
    this.id = '';
    this.className = '';
    this.type = '';
    this._rect = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(v) {
    this._textContent = String(v ?? '');
  }

  get innerHTML() {
    return this._rawHTML || this.children.map(c => c.innerHTML).join('');
  }

  get hidden() {
    return this._hidden;
  }

  set hidden(v) {
    this._hidden = Boolean(v);
  }

  get clientWidth() {
    return parseFloat(this.style.width || this._rect.width || 0);
  }

  get clientHeight() {
    return parseFloat(this.style.height || this._rect.height || 0);
  }

  get offsetWidth() {
    return this.clientWidth;
  }

  get offsetHeight() {
    return this.clientHeight;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  setAttribute(k, v) {
    const key = k.toLowerCase();
    this.attributes[key] = String(v);
    if (key === 'id') this.id = String(v);
    if (key === 'class') {
      this.className = String(v);
      this.classList.clear();
      for (const c of String(v).split(/\s+/)) if (c) this.classList.add(c);
    }
    if (key === 'type') this.type = String(v);
    if (key.startsWith('data-')) {
      const prop = key.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }

  getAttribute(k) {
    return this.attributes[k.toLowerCase()] ?? null;
  }

  removeAttribute(k) {
    const key = k.toLowerCase();
    delete this.attributes[key];
    if (key === 'id') this.id = '';
    if (key === 'class') {
      this.className = '';
      this.classList.clear();
    }
  }

  hasAttribute(k) {
    return k.toLowerCase() in this.attributes;
  }

  addEventListener(event, fn, opts) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push({ fn, once: !!(opts && opts.once) });
  }

  removeEventListener(event, fn) {
    if (!this.listeners.has(event)) return;
    this.listeners.set(event, this.listeners.get(event).filter(l => l.fn !== fn));
  }

  dispatchEvent(evt) {
    const eventObj = typeof evt === 'string' ? { type: evt } : { ...evt };
    eventObj.target = eventObj.target || this;
    const list = [...(this.listeners.get(eventObj.type) || [])];
    for (const l of list) {
      const currentList = this.listeners.get(eventObj.type) || [];
      if (!currentList.some(item => item.fn === l.fn)) continue;
      l.fn.call(this, eventObj);
      if (l.once) {
        this.removeEventListener(eventObj.type, l.fn);
      }
    }
    if (this.parentElement && !eventObj.cancelBubble) {
      this.parentElement.dispatchEvent(eventObj);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  contains(child) {
    if (!child) return false;
    if (child === this) return true;
    for (const c of this.children) {
      if (c === child || (c.contains && c.contains(child))) return true;
    }
    return false;
  }

  createElement(tag) {
    return new MockElement(tag);
  }

  set innerHTML(html) {
    this._rawHTML = html;
    this.children = [];
    const tokens = html.match(/(<[^>]+>|[^<]+)/g) || [];
    const stack = [this];
    for (const token of tokens) {
      if (token.startsWith('</')) {
        if (stack.length > 1) stack.pop();
      } else if (token.startsWith('<')) {
        const isSelfClosing = token.endsWith('/>') || /^<(img|input|br|hr|meta|link)/i.test(token);
        const tagMatch = token.match(/^<([a-z0-9-]+)/i);
        if (!tagMatch) continue;
        const tag = tagMatch[1];
        const el = new MockElement(tag);
        const attrRegex = /([a-z0-9-]+)(?:="([^"]*)")?/gi;
        let am;
        const rawAttrs = token.slice(tag.length + 1, isSelfClosing ? -2 : -1);
        while ((am = attrRegex.exec(rawAttrs)) !== null) {
          const k = am[1].toLowerCase();
          const val = am[2] ?? '';
          el.setAttribute(k, val);
        }
        stack[stack.length - 1].appendChild(el);
        if (!isSelfClosing) stack.push(el);
      } else {
        const text = token.trim();
        if (text && stack.length) stack[stack.length - 1].textContent += text;
      }
    }
  }

  querySelector(sel) {
    const parts = sel.trim().split(/\s+/);
    const matchSingle = (node, s) => {
      if (!s) return false;
      if (s.startsWith('.')) return node.classList.contains(s.slice(1));
      if (s.startsWith('#')) return node.id === s.slice(1);
      if (s.includes('[')) {
        const m = s.match(/^([a-z0-9-]*)\[([a-z0-9-]+)(?:="([^"]*)")?\]/i);
        if (m) {
          const [_, tag, attr, val] = m;
          if (tag && tag.toLowerCase() !== node.tagName.toLowerCase()) return false;
          return val !== undefined ? node.getAttribute(attr) === val : node.hasAttribute(attr);
        }
      }
      return s.toLowerCase() === node.tagName.toLowerCase();
    };

    const search = (node, partIdx) => {
      if (partIdx >= parts.length) return null;
      const target = parts[partIdx];
      for (const child of node.children) {
        if (matchSingle(child, target)) {
          if (partIdx === parts.length - 1) return child;
          const res = search(child, partIdx + 1);
          if (res) return res;
        }
        const res = search(child, partIdx);
        if (res) return res;
      }
      return null;
    };
    return search(this, 0);
  }

  querySelectorAll(sel) {
    const matches = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) {
          matches.push(child);
        } else if (sel.startsWith('#') && child.id === sel.slice(1)) {
          matches.push(child);
        } else if (sel.toLowerCase() === child.tagName.toLowerCase()) {
          matches.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return matches;
  }
}

export class MockAudioParam {
  constructor(initial = 1.0, clock = null) {
    this.value = initial;
    this.clock = clock;
    this.events = [];
    this.rampEndTime = 0;
    this.targetVal = initial;
  }

  setValueAtTime(val, time) {
    this.events.push({ type: 'setValue', val, time });
    this.value = val;
  }

  linearRampToValueAtTime(val, time) {
    this.events.push({ type: 'linearRamp', val, time });
    this.targetVal = val;
    this.rampEndTime = time;
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancelScheduled', time });
  }

  getValueAtTime(t) {
    if (!this.rampEndTime || t <= 0) return this.value;
    if (t >= this.rampEndTime) return this.targetVal;
    return this.value + (this.targetVal - this.value) * (t / this.rampEndTime);
  }
}

export class MockGainNode {
  constructor(clock) {
    this.clock = clock;
    this.gain = new MockAudioParam(1.0, clock);
    this.connectedTo = null;
    this.disconnected = false;
  }

  connect(dest) {
    this.connectedTo = dest;
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
    this.connectedTo = null;
  }
}

export class MockAudioContext {
  constructor(clock) {
    this.clock = clock;
    this.state = 'running'; // or 'suspended'
    this.destination = { name: 'destination' };
  }

  get currentTime() {
    return (this.clock ? this.clock.now : 0) / 1000;
  }

  createGain() {
    return new MockGainNode(this.clock);
  }

  createMediaElementSource(element) {
    return {
      element,
      connect(target) {},
      disconnect() {},
    };
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

export class MockHTMLAudioElement extends MockElement {
  constructor(clock, rejectPlay = false) {
    super('AUDIO');
    this.clock = clock;
    this.src = '';
    this.loop = false;
    this.crossOrigin = null;
    this.volume = 1.0;
    this.paused = true;
    this.currentTime = 0;
    this.rejectPlay = rejectPlay;
    this.playCount = 0;
    this.pauseCount = 0;
    this.onerror = null;
  }

  play() {
    this.playCount++;
    if (this.rejectPlay) {
      const err = new Error('The play() request was interrupted by the autoplay policy.');
      err.name = 'NotAllowedError';
      this.paused = true;
      return Promise.reject(err);
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauseCount++;
    this.paused = true;
  }

  load() {
    // no-op reset
  }

  dispatchEvent(evt) {
    super.dispatchEvent(evt);
    const type = typeof evt === 'string' ? evt : evt.type;
    if (type === 'error' && typeof this.onerror === 'function') {
      this.onerror(evt);
    }
  }
}

export class MockDocument extends MockElement {
  constructor() {
    super('#document');
    this.head = new MockElement('head');
    this.body = new MockElement('body');
    this.appendChild(this.head);
    this.appendChild(this.body);
  }

  createElement(tag) {
    return new MockElement(tag);
  }

  getElementById(id) {
    const search = (el) => {
      if (el.id === id) return el;
      for (const child of el.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(this.head) || search(this.body);
  }
}

export class MockWebGLRenderer {
  constructor() {
    this.domElement = new MockElement('CANVAS');
    this.renderCalls = [];
  }

  render(scene, camera) {
    this.renderCalls.push({ scene, camera, time: Date.now() });
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.domElement.style.width = `${width}px`;
    this.domElement.style.height = `${height}px`;
  }
}

export function createMockEnvironment() {
  const clock = new VirtualClock();
  const document = new MockDocument();
  let lastAudio = null;

  class AudioFactory extends MockHTMLAudioElement {
    constructor() {
      super(clock);
      lastAudio = this;
    }
  }

  const window = {
    document,
    performance: { now: () => clock.performanceNow() },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    requestAnimationFrame: (fn) => clock.requestAnimationFrame(fn),
    cancelAnimationFrame: (id) => clock.cancelAnimationFrame(id),
    AudioContext: function() { return new MockAudioContext(clock); },
    Audio: AudioFactory,
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: (evt, fn, opts) => document.addEventListener(evt, fn, opts),
    removeEventListener: (evt, fn) => document.removeEventListener(evt, fn),
    dispatchEvent: (evt) => document.dispatchEvent(evt),
  };

  return {
    clock,
    document,
    body: document.body,
    head: document.head,
    window,
    getLastAudio: () => lastAudio,
  };
}
