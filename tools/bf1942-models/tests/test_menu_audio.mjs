/**
 * `viewer/audio.js`'s mute switch, under node against a stub Audio element.
 *
 * The switch exists because the Instant Battle screen stays up while its
 * loop plays, where the loading screen's "click to enable" badge is only
 * half the control the player needs. What is worth pinning is the half that
 * is easy to get wrong: muted has to outrank the autoplay machinery, so that
 * a click somewhere else on the page — which is a gesture, and which the
 * controller listens for — cannot start the music behind the player's back,
 * and neither can the next track.
 */
import assert from 'node:assert/strict';
import { AudioState, LoadingAudioController } from '../viewer/audio.js';

// --- the stubs ---------------------------------------------------------------

class StubAudio {
  constructor() {
    this.paused = true;
    this.src = '';
    this.volume = 1;
    this.loop = false;
    this.crossOrigin = null;
    this.currentTime = 0;
    this.plays = 0;
    this.pauses = 0;
    this._listeners = new Map();
    // What the browser does on the next play(): null allows it, an error
    // name refuses it the way the autoplay policy does.
    this.refuse = null;
  }

  play() {
    this.plays++;
    if (this.refuse) {
      const err = new Error('blocked');
      err.name = this.refuse;
      return Promise.reject(err);
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauses++;
    this.paused = true;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); }
}

/** Just enough document for the gesture unlock and the toggle button. */
function stubDocument() {
  const gestures = new Map();
  const elements = [];
  const make = () => {
    const el = {
      tagName: 'BUTTON', type: '', className: '', innerHTML: '', id: '',
      style: {}, children: [], attrs: new Map(), classes: new Set(),
      clicks: [],
      setAttribute(k, v) { this.attrs.set(k, String(v)); },
      getAttribute(k) { return this.attrs.get(k) ?? null; },
      appendChild(child) { this.children.push(child); return child; },
      contains(child) { return this.children.includes(child); },
      addEventListener(type, fn) { if (type === 'click') this.clicks.push(fn); },
      classList: {
        toggle: (name, on) => { if (on) el.classes.add(name); else el.classes.delete(name); },
        contains: name => el.classes.has(name),
      },
      click() { for (const fn of this.clicks) fn({}); },
    };
    elements.push(el);
    return el;
  };
  const head = make();
  const body = make();
  return {
    head,
    body,
    elements,
    gestures,
    createElement: () => make(),
    getElementById: () => null,
    addEventListener(type, fn) { gestures.set(type, fn); },
    removeEventListener(type) { gestures.delete(type); },
  };
}

function controller() {
  const doc = stubDocument();
  const audio = new StubAudio();
  const ctrl = new LoadingAudioController({
    audioClass: function () { return audio; },
    audioContextClass: null,
    documentRef: doc,
    windowRef: { addEventListener() {}, removeEventListener() {} },
  });
  return { ctrl, audio, doc };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// --- plain playback ----------------------------------------------------------

{
  const { ctrl, audio } = controller();
  ctrl.start('menu.mp3');
  await settle();
  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
  assert.equal(audio.paused, false);
  assert.equal(ctrl.muted, false);
  assert.equal(ctrl.silent, false, 'sound is on by default');
}

// --- the switch --------------------------------------------------------------

{
  const { ctrl, audio } = controller();
  ctrl.start('menu.mp3');
  await settle();

  assert.equal(ctrl.setMuted(true), true);
  assert.equal(audio.paused, true, 'muting stops the track');
  assert.equal(ctrl.state, AudioState.MUTED);
  assert.equal(ctrl.silent, true);

  // Setting it again changes nothing: one pause, not two.
  const pauses = audio.pauses;
  ctrl.setMuted(true);
  assert.equal(audio.pauses, pauses);

  ctrl.setMuted(false);
  await settle();
  assert.equal(audio.paused, false, 'unmuting plays again');
  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
  assert.equal(ctrl.silent, false);
}

// --- muted outranks the autoplay machinery -----------------------------------

{
  // A track that starts blocked arms a document-wide gesture unlock. Muting
  // has to disarm it, or the player's next click anywhere starts the music.
  const { ctrl, audio, doc } = controller();
  audio.refuse = 'NotAllowedError';
  ctrl.start('menu.mp3');
  await settle();
  assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);
  assert.ok(doc.gestures.size > 0, 'the gesture unlock is armed while blocked');

  ctrl.setMuted(true);
  assert.equal(doc.gestures.size, 0, 'muting disarms it');

  audio.refuse = null;
  await ctrl.unlock();
  await settle();
  assert.equal(audio.paused, true, 'an unlock while muted plays nothing');
  assert.equal(ctrl.state, AudioState.MUTED);
}

{
  // And neither does the next track: the level's loading music must not undo
  // what the player turned off on the menu.
  const { ctrl, audio } = controller();
  ctrl.setMuted(true);
  ctrl.start('menu.mp3');
  await settle();
  assert.equal(audio.plays, 0, 'a muted start loads but does not play');
  assert.equal(audio.src, 'menu.mp3', 'it is still the track that was asked for');
  assert.equal(ctrl.state, AudioState.MUTED);

  ctrl.setMuted(false);
  await settle();
  assert.equal(audio.paused, false);
}

// --- the toggle button -------------------------------------------------------

{
  const { ctrl, audio, doc } = controller();
  ctrl.start('menu.mp3');
  await settle();

  const changes = [];
  const btn = ctrl.attachMuteToggle(doc.body, { onChange: m => changes.push(m) });
  assert.ok(btn, 'the toggle is built');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.ok(!btn.classList.contains('ld-mute-off'), 'playing: the speaker is on');
  assert.ok(btn.innerHTML.includes('<svg'), 'an icon, not a glyph');

  btn.click();
  await settle();
  assert.deepEqual(changes, [true]);
  assert.equal(ctrl.muted, true);
  assert.equal(audio.paused, true);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.ok(btn.classList.contains('ld-mute-off'));
  assert.match(btn.getAttribute('aria-label'), /on$/, 'it now offers to turn it on');

  btn.click();
  await settle();
  assert.deepEqual(changes, [true, false]);
  assert.equal(ctrl.muted, false);
  assert.equal(audio.paused, false);
  assert.ok(!btn.classList.contains('ld-mute-off'));

  // Asking twice hands back the same button rather than stacking them.
  assert.equal(ctrl.attachMuteToggle(doc.body), btn);
}

{
  // Blocked, not muted: the click is the gesture the autoplay policy wanted,
  // so the button unblocks rather than toggling a mute the player never set.
  const { ctrl, audio, doc } = controller();
  audio.refuse = 'NotAllowedError';
  ctrl.start('menu.mp3');
  await settle();
  const btn = ctrl.attachMuteToggle(doc.body);
  assert.ok(btn.classList.contains('ld-mute-off'), 'blocked reads as off');
  assert.equal(ctrl.muted, false, 'the player did not mute it, the browser did');

  audio.refuse = null;
  btn.click();
  await settle();
  assert.equal(ctrl.muted, false);
  assert.equal(audio.paused, false, 'the click played it');
  assert.ok(!btn.classList.contains('ld-mute-off'));
}

console.log('menu-audio: ok');
