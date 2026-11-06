// Rebinding: the OPTIONS > CONTROLS screen's boxes as an editable table, and
// the `.con` files written back from it the way retail's SAVE writes them.
//
// The model is retail's own (features/browser-play-feedback-2026-11-06, #1):
// every row of the screen (`controls-rows.js`) has a primary and an alternate
// box, each holding one input or nothing. A box is filled by DEFINE KEY
// (`handleControlsInput` 0x006c67d0) and written by `setKey` (0x006c6040):
//
//   - an alternate set while the row's primary is empty fills the primary;
//   - an alternate equal to the primary is cleared, whichever was set;
//   - an axis fills both halves of its pair (FORWARD and BACKWARD are one
//     channel, `getNextAxisIndex` pairs them), and replacing or unbinding an
//     axis in one half clears it from the other.
//
// Conflicts (`checkKeyCollision` 0x006c1520) are allowed while editing and
// marked per box. They are checked per control map the game builds: Common
// with Infantry, Common with Land & Sea, Common with Air; an input bound on
// INFANTRY and on AIR is no conflict. SAVE (`SaveAllControls` 0x006c6410)
// refuses while any box is marked.
//
// Writing keeps every line the screen does not own (the `c_GI*` game map,
// the look axes, `c_PIRun`, the numpad camera, `game.set*` words, comments)
// and rewrites the rows' lines in place in retail's formats (0x009222b0 ..
// 0x009224c8): the alternate box's lines end in ` 1`, an axis row pair is one
// `addKeysToAxisMapping` / `addAxisToAxisMapping` / `addButtonsToAxisMapping`
// / `addButtonAndKeyToAxisMapping` / `addKeyAndButtonToAxisMapping` line per
// box, and the COMMON rows go into Common.con and the "Common Player Input"
// block every context file repeats.

import { CONTROLS_DEFAULTS } from './controls-defaults.js';
import { CONTROL_ROWS } from './controls-rows.js';
import { UNBOUND_KEY_ID, codeToKeyId, gameKeyName, parseCon } from './controls.js';

export const EDIT_CONTEXTS = ['common', 'infantry', 'air', 'land'];

/** The three control maps the game builds, each Common plus one context. */
export const CONTROL_MAPS = ['infantry', 'land', 'air'];

/** The retail names the conflict text gives each map. */
export const MAP_NAMES = { common: 'Common', infantry: 'Infantry', land: 'Land/Sea', air: 'Air' };

/** A row key's control map, from its lexicon prefix (the game's own keys
 *  drop an S on AIR 4-6). */
export function rowContext(key) {
  if (key.startsWith('CONTROLS_COMMON_')) return 'common';
  if (key.startsWith('CONTROLS_INFANTRY_')) return 'infantry';
  if (key.startsWith('CONTROLS_AIR_') || key.startsWith('CONTROL_AIR_')) return 'air';
  if (key.startsWith('CONTROLS_LANDSEA_')) return 'land';
  return null;
}

/** A row's identity inside its map: `T:c_PIUse`, or `A:c_PIThrottle:+` for
 *  the positive half of an axis. */
export const rowId = spec => (spec.axis ? `A:${spec.axis}:${spec.sign > 0 ? '+' : '-'}` : `T:${spec.trigger}`);

/** Per map, its rows in the screen's order: `{ key, id, spec }`. */
export const EDIT_ROWS = (() => {
  const out = Object.fromEntries(EDIT_CONTEXTS.map(c => [c, []]));
  for (const [key, spec] of Object.entries(CONTROL_ROWS)) {
    const context = rowContext(key);
    if (!context || out[context].some(r => r.id === rowId(spec))) continue;
    out[context].push({ key, id: rowId(spec), spec });
  }
  return out;
})();

/** The COMMON rows the game map (`defaultGameControlMap`) repeats under its
 *  own trigger. Retail's SAVE writes the scoreboard's binding into both maps
 *  (the owner's Common.con carries `c_GIShowScoreBoard ... IDButton_15 ... 1`,
 *  the joystick button only the screen could have put there, and a
 *  `c_GIScreenShot` the shipped file lacks); the page reads the game map's
 *  twins too (a dead player's chat line is `c_GISayAll`). */
export const GAME_MAP_TWINS = {
  c_PISayAll: 'c_GISayAll',
  c_PISayTeam: 'c_GISayTeam',
  c_PIShowScoreBoard: 'c_GIShowScoreBoard',
  c_PIScreenShot: 'c_GIScreenShot',
  c_PIToolTip: 'c_GIToolTip',
  c_PIShowMapVote: 'c_GIShowMapVote',
};

// --- inputs ----------------------------------------------------------------
//
// What a box holds, one of:
//   { type: 'key', code }                 a keyboard key, by `event.code`
//   { type: 'mouse', button }             DirectInput numbering: 0 left, 1 right, 2 middle
//   { type: 'pad', button }               the first game controller's button
//   { type: 'wheel', dir }                MWheelUp (+1) / MWheelDown (-1), a button row
//   { type: 'mouseAxis', axis, dir }      mouse X (0), Y (1) or the wheel (2) as an axis
//   { type: 'padAxis', axis, dir }        a stick axis; `dir` is the push that drives this half

export const isAxisInput = c => c?.type === 'mouseAxis' || c?.type === 'padAxis';
const isButton = c => c?.type === 'mouse' || c?.type === 'pad';

export function sameInput(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  switch (a.type) {
    case 'key': return a.code === b.code;
    case 'mouse': case 'pad': return a.button === b.button;
    case 'wheel': return a.dir === b.dir;
    default: return a.axis === b.axis && a.dir === b.dir;
  }
}

/** What two boxes must share to conflict: the physical input. An axis is
 *  one input whichever way it is pushed (its two halves are one binding);
 *  the wheel's two directions are two, as retail's MWheelUp / MWheelDown. */
export function inputId(c) {
  switch (c?.type) {
    case 'key': return `K:${c.code}`;
    case 'mouse': return `M:${c.button}`;
    case 'pad': return `J:${c.button}`;
    case 'wheel': return `W:${c.dir}`;
    case 'mouseAxis': return c.axis === 2 ? `W:${c.dir}` : `MA:${c.axis}`;
    case 'padAxis': return `JA:${c.axis}`;
    default: return null;
  }
}

/** A box's text, in the game's words. `names` is the keyboard layout's
 *  legends (`gameKeyName`). */
export function inputLabel(c, names = null) {
  switch (c?.type) {
    case 'key': return gameKeyName(c.code, names);
    case 'mouse': return `MOUSE ${c.button + 1}`;
    case 'pad': return `JOYSTICK ${c.button + 1}`;
    case 'wheel': return c.dir > 0 ? 'MOUSE WHEEL UP' : 'MOUSE WHEEL DOWN';
    case 'mouseAxis':
      if (c.axis === 2) return c.dir > 0 ? 'MOUSE WHEEL UP' : 'MOUSE WHEEL DOWN';
      if (c.axis === 0) return c.dir > 0 ? 'MOUSE RIGHT' : 'MOUSE LEFT';
      return c.dir > 0 ? 'MOUSE DOWN' : 'MOUSE UP';
    case 'padAxis': return `JOYSTICK AXIS ${c.axis + 1}${c.dir > 0 ? '+' : '-'}`;
    default: return '';
  }
}

// --- reading the files into boxes -------------------------------------------

/** One parsed binding's part (a key or a button of a mixed pair) as a box. */
function partInput(p) {
  if (!p) return null;
  if (p.device === 'keyboard') return p.code ? { type: 'key', code: p.code } : null;
  if (p.device === 'controller') return p.index === 0 ? { type: 'pad', button: p.button } : null;
  if (p.device === 'mouse') return { type: 'mouse', button: p.button };
  return null;
}

/** A trigger line's box. */
function triggerInput(b) {
  if (b.device === 'keyboard') return { type: 'key', code: b.code };
  if (b.device === 'mouse') return { type: 'mouse', button: b.button };
  if (b.device === 'controller' && b.index === 0) return { type: 'pad', button: b.button };
  return null;
}

/** An axis line's two halves, positive first. */
function axisHalves(b) {
  if (b.device === 'keyboard') return b.codes.map(code => (code ? { type: 'key', code } : null));
  if (b.device === 'mixed') return b.parts.map(partInput);
  const type = b.device === 'mouse' ? 'mouseAxis' : b.device === 'controller' && b.index === 0 ? 'padAxis' : null;
  if (!type) return [null, null];
  const push = b.invert ? -1 : 1;
  return [{ type, axis: b.axis, dir: push }, { type, axis: b.axis, dir: -push }];
}

/** The boxes of one map's rows out of one file, the way the engine fills its
 *  slots (ledger MLK-15): a line writes the slot it names, a later line for
 *  that slot replaces it, and an alternate line for a channel with no
 *  primary line yet is refused. The wheel pair's line names no slot; it
 *  takes the first box its row leaves empty. */
function readRows(text, rows) {
  const ids = new Set(rows.map(r => r.id));
  const boxes = new Map(rows.map(r => [r.id, [null, null]]));
  const primed = new Set();
  const put = (id, secondary, cell, channel = id) => {
    if (!ids.has(id)) return;
    if (secondary && !primed.has(channel)) return;
    boxes.get(id)[secondary ? 1 : 0] = cell;
  };
  const { bindings } = parseCon(text);
  const wheels = [];
  for (const b of bindings) {
    if (b.kind === 'trigger') {
      const id = `T:${b.trigger}`;
      if (!ids.has(id)) continue;
      put(id, b.secondary, triggerInput(b));
      if (!b.secondary) primed.add(id);
    } else if (b.kind === 'axis') {
      const pos = `A:${b.trigger}:+`;
      const neg = `A:${b.trigger}:-`;
      if (!ids.has(pos) && !ids.has(neg)) continue;
      const [p, n] = axisHalves(b);
      const channel = `A:${b.trigger}`;
      put(pos, b.secondary, p, channel);
      put(neg, b.secondary, n, channel);
      if (!b.secondary) primed.add(channel);
    } else if (b.kind === 'axistrigger' && b.axis === 2) {
      wheels.push(b);
    }
  }
  for (const b of wheels) {
    for (const [trigger, dir] of [[b.trigger, 1], [b.triggerNeg, -1]]) {
      const box = boxes.get(`T:${trigger}`);
      if (!box) continue;
      const at = box.findIndex(c => !c);
      if (at >= 0) box[at] = { type: 'wheel', dir };
    }
  }
  return boxes;
}

/** Every box of every map out of the four files: `context|id` -> [primary,
 *  alternate]. COMMON's rows are Common.con's (the context files' copies of
 *  that block are written from it). */
export function readBoxes(files) {
  const out = new Map();
  for (const context of EDIT_CONTEXTS) {
    const text = files?.[context] ?? CONTROLS_DEFAULTS.files[context] ?? '';
    for (const [id, cells] of readRows(text, EDIT_ROWS[context])) out.set(`${context}|${id}`, cells);
  }
  return out;
}

// --- writing the boxes back --------------------------------------------------

const VERB = /^ControlMap\.(\w+)\s+(.*)$/;

/** Which owned item a `ControlMap.*` line binds: `T:<trigger>` or
 *  `A:<channel>`; a wheel pair line names both of its triggers. */
function lineItems(line) {
  const m = VERB.exec(line.trim());
  if (!m) return [];
  const [verb, rest] = [m[1], m[2].split(/\s+/)];
  if (verb === 'addKeyToTriggerMapping' || verb === 'addButtonToTriggerMapping') return [`T:${rest[0]}`];
  if (verb === 'addAxisToTriggerMapping') return [`T:${rest[0]}`, `T:${rest[1]}`];
  if (/ToAxisMapping$/.test(verb)) return [`A:${rest[0]}`];
  return [];
}

/** The `c_CM*` flag a trigger's lines carry in this file, else in the
 *  shipped maps, else non-repetitive. */
function flagFinder(text) {
  const seen = new Map();
  const scan = t => {
    for (const raw of String(t ?? '').split('\n')) {
      const m = VERB.exec(raw.trim());
      if (!m || !/^add(Key|Button)ToTriggerMapping$/.test(m[1])) continue;
      const [trigger, , , flag] = m[2].split(/\s+/);
      if (flag?.startsWith('c_CM') && !seen.has(trigger)) seen.set(trigger, flag);
    }
  };
  scan(text);
  const shipped = new Map();
  for (const file of Object.values(CONTROLS_DEFAULTS.files)) {
    for (const raw of String(file).split('\n')) {
      const m = VERB.exec(raw.trim());
      if (!m || !/^add(Key|Button)ToTriggerMapping$/.test(m[1])) continue;
      const [trigger, , , flag] = m[2].split(/\s+/);
      if (flag?.startsWith('c_CM') && !shipped.has(trigger)) shipped.set(trigger, flag);
    }
  }
  return (trigger, twin = null) => seen.get(trigger) ?? (twin && seen.get(twin))
    ?? shipped.get(trigger) ?? (twin && shipped.get(twin)) ?? 'c_CMNonRepetive';
}

const slotTail = slot => (slot ? ' 1' : '');
const deviceName = c => (c.type === 'pad' || c.type === 'padAxis' ? 'IDFGameController_0' : 'IDFMouse');
const keyName = c => (c?.type === 'key' ? codeToKeyId(c.code) ?? UNBOUND_KEY_ID : UNBOUND_KEY_ID);

/** A button row's box as its line (a wheel is written as a pair, elsewhere). */
function triggerLine(trigger, c, slot, flag) {
  if (c.type === 'key') {
    const id = codeToKeyId(c.code);
    return id ? `ControlMap.addKeyToTriggerMapping ${trigger} IDFKeyboard ${id} ${flag}${slotTail(slot)}` : null;
  }
  if (isButton(c)) {
    return `ControlMap.addButtonToTriggerMapping ${trigger} ${deviceName(c)} IDButton_${c.button} ${flag}${slotTail(slot)}`;
  }
  return null;
}

/** One channel's box (its positive and negative half) as its line. */
export function axisLine(channel, pos, neg, slot) {
  if (!pos && !neg) return null;
  const axis = [pos, neg].find(isAxisInput);
  if (axis) {
    // The positive half's push is the line's sense: pushing the axis its
    // own positive way drives the channel positive unless inverted.
    const invert = isAxisInput(pos) ? pos.dir < 0 : neg.dir > 0;
    return `ControlMap.addAxisToAxisMapping ${channel} ${deviceName(axis)} IDAxis_${axis.axis} ${invert ? 1 : 0}${slotTail(slot)}`;
  }
  if (isButton(pos) && isButton(neg) && pos.type === neg.type) {
    return `ControlMap.addButtonsToAxisMapping ${channel} ${deviceName(pos)} IDButton_${pos.button} IDButton_${neg.button}${slotTail(slot)}`;
  }
  if (isButton(pos)) {
    return `ControlMap.addButtonAndKeyToAxisMapping ${channel} ${deviceName(pos)} IDButton_${pos.button} IDFKeyboard ${keyName(neg)}${slotTail(slot)}`;
  }
  if (isButton(neg)) {
    return `ControlMap.addKeyAndButtonToAxisMapping ${channel} IDFKeyboard ${keyName(pos)} ${deviceName(neg)} IDButton_${neg.button}${slotTail(slot)}`;
  }
  return `ControlMap.addKeysToAxisMapping ${channel} IDFKeyboard ${keyName(pos)} ${keyName(neg)}${slotTail(slot)}`;
}

/** A row's two boxes as written: a primary-less alternate is written as the
 *  primary, since the engine refuses an alternate line for a channel with no
 *  primary (MLK-15). */
function written(cells) {
  const [a, b] = cells ?? [null, null];
  return a || !b ? [a, b] : [b, null];
}

/** The section ranges of one file: `[start, end)` line spans. */
function sections(lines, context) {
  const creates = [];
  lines.forEach((l, i) => { if (/^ControlMap\.create\s/.test(l.trim())) creates.push(i); });
  const marker = lines.findIndex(l => /^rem \*\*\* Common Player Input \*\*\*/.test(l.trim()));
  if (context === 'common') {
    const game = lines.findIndex(l => /^ControlMap\.create\s+defaultGameControlMap\b/.test(l.trim()));
    const player = lines.findIndex(l => /^ControlMap\.create\s+defaultPlayerInputControlMap\b/.test(l.trim()));
    const out = {};
    if (game >= 0) out.game = [game + 1, player > game ? (marker > game && marker < player ? marker : player) : lines.length];
    out.common = player >= 0 ? [player + 1, lines.length] : null;
    return out;
  }
  const first = creates[0] ?? -1;
  return {
    player: first >= 0 ? [first + 1, marker > first ? marker : lines.length] : null,
    common: marker >= 0 ? [marker + 1, lines.length] : null,
  };
}

/**
 * One file rewritten from the boxes. Lines binding an item this file owns
 * are taken out; the item's new lines go where its first old line was, or
 * at the end of its section's bindings when it had none. Everything else is
 * kept as it stood.
 */
export function serializeCon(text, context, boxes) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const flagOf = flagFinder(text);
  const spans = sections(lines, context);
  // Which section owns which item, and the lines each item writes.
  const owned = new Map();   // item -> section
  const emit = new Map();    // item -> () => string[]
  const wheelPairs = [];     // per section: [{ up, down }] pairs, by item
  const box = (ctx, id) => written(boxes.get(`${ctx}|${id}`));

  const rowsOf = ctx => EDIT_ROWS[ctx];
  const addRows = (section, ctx, rename = null) => {
    const wheels = { up: [], down: [] };
    for (const row of rowsOf(ctx)) {
      const { spec } = row;
      if (spec.axis) {
        const item = `A:${spec.axis}`;
        if (owned.has(item)) continue;
        owned.set(item, section);
        emit.set(item, () => [0, 1].map(slot => axisLine(spec.axis,
          box(ctx, `A:${spec.axis}:+`)[slot], box(ctx, `A:${spec.axis}:-`)[slot], slot)).filter(Boolean));
        continue;
      }
      if (rename && !rename(spec.trigger)) continue;
      const trigger = rename ? rename(spec.trigger) : spec.trigger;
      const item = `T:${trigger}`;
      owned.set(item, section);
      const cells = box(ctx, row.id);
      cells.forEach(c => {
        if (c?.type === 'wheel') (c.dir > 0 ? wheels.up : wheels.down).push(trigger);
      });
      emit.set(item, () => cells.map((c, slot) => (c && c.type !== 'wheel'
        ? triggerLine(trigger, c, slot, flagOf(trigger, spec.trigger)) : null)).filter(Boolean));
    }
    // Retail writes a wheel only as the pair `addAxisToTriggerMapping <up>
    // <down> IDFMouse IDAxis_2` (0x00922760), and only when it finds both
    // directions; a lone wheel direction is not written.
    const n = Math.min(wheels.up.length, wheels.down.length);
    for (let i = 0; i < n; i++) wheelPairs.push({ section, up: wheels.up[i], down: wheels.down[i] });
  };

  if (context === 'common') {
    addRows('common', 'common', t => (t.startsWith('c_PI') ? t : null));
    addRows('game', 'common', t => (t.startsWith('c_GI') ? t : GAME_MAP_TWINS[t] ?? null));
  } else {
    addRows('player', context);
    addRows('common', 'common', t => (t.startsWith('c_PI') ? t : null));
  }
  for (const pair of wheelPairs) {
    const line = `ControlMap.addAxisToTriggerMapping ${pair.up} ${pair.down} IDFMouse IDAxis_2`;
    const up = `T:${pair.up}`;
    const prev = emit.get(up);
    emit.set(up, () => [...prev(), line]);
  }

  // Take the owned lines out, leaving a placeholder where each item's first
  // line stood inside its own section.
  const inSection = (i, name) => spans[name] && i >= spans[name][0] && i < spans[name][1];
  const placed = new Set();
  const out = [];   // { src, line } or { src, item }
  lines.forEach((line, src) => {
    const items = lineItems(line).filter(item => owned.has(item));
    if (!items.length) { out.push({ src, line }); return; }
    for (const item of items) {
      if (!placed.has(item) && inSection(src, owned.get(item))) {
        placed.add(item);
        out.push({ src, item });
      }
    }
  });
  // Items with no old line go after their section's last binding.
  for (const name of context === 'common' ? ['game', 'common'] : ['player', 'common']) {
    const missing = [...owned].filter(([item, s]) => s === name && !placed.has(item)).map(([item]) => item);
    if (!missing.length) continue;
    for (const item of missing) placed.add(item);
    const adds = missing.map(item => ({ src: -1, item }));
    const span = spans[name];
    let at = -1;
    if (span) {
      out.forEach((e, j) => {
        if (e.src < span[0] - 1 || e.src >= span[1]) return;
        if (e.item || /^ControlMap\.(add|create)/.test(e.line.trim())) at = j;
      });
      // A section whose lines were all taken out keeps its place: after the
      // line before it.
      if (at < 0) at = out.findIndex(e => e.src >= span[0]) - 1;
    }
    if (at >= 0) { out.splice(at + 1, 0, ...adds); continue; }
    if (name === 'common' && context !== 'common') {
      // A context file without the block gets one, as retail writes it.
      while (out.length && out[out.length - 1].line === '') out.pop();
      out.push({ src: -1, line: '' }, { src: -1, line: 'rem *** Common Player Input ***' });
    }
    out.push(...adds);
  }
  return out.flatMap(e => (e.item ? emit.get(e.item)() : [e.line])).join('\n');
}

/** The four files rewritten from the boxes, over `base`. */
export function serializeFiles(base, boxes) {
  const out = {};
  for (const context of EDIT_CONTEXTS) {
    out[context] = serializeCon(base?.[context] ?? CONTROLS_DEFAULTS.files[context], context, boxes);
  }
  return out;
}

// --- conflicts ---------------------------------------------------------------

/** Every box that shares its input with another box in one of the game's
 *  three maps: `context|id|slot` -> the set of maps it conflicts in. An axis
 *  in both halves of its own channel is one binding, not two. */
export function findConflicts(boxes) {
  const marks = new Map();
  for (const map of CONTROL_MAPS) {
    const byInput = new Map();
    for (const context of ['common', map]) {
      for (const row of EDIT_ROWS[context]) {
        const cells = boxes.get(`${context}|${row.id}`) ?? [];
        cells.forEach((c, slot) => {
          const id = inputId(c);
          if (!id) return;
          const entry = { key: `${context}|${row.id}|${slot}`, channel: row.spec.axis ? `${context}|${row.spec.axis}` : null,
                          axis: isAxisInput(c) };
          if (!byInput.has(id)) byInput.set(id, []);
          byInput.get(id).push(entry);
        });
      }
    }
    for (const group of byInput.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = [group[i], group[j]];
          if (a.axis && b.axis && a.channel && a.channel === b.channel) continue;
          for (const e of [a, b]) {
            if (!marks.has(e.key)) marks.set(e.key, new Set());
            marks.get(e.key).add(map);
          }
        }
      }
    }
  }
  return marks;
}

/** The red bar's text over a conflicted box: "CONFLICT DETECTED", and on
 *  the COMMON tab which maps the clash is in (retail builds "Infantry",
 *  " and Land/Sea", " and Air" the same way). */
export function conflictText(maps, context) {
  const set = new Set(maps ?? []);
  if (!set.size || context !== 'common') return 'CONFLICT DETECTED';
  const names = CONTROL_MAPS.filter(m => set.has(m)).map(m => MAP_NAMES[m].toUpperCase());
  return `CONFLICT DETECTED: ${names.join(' AND ')}`;
}

// --- the draft -----------------------------------------------------------------

/**
 * The screen's edits until SAVE: the boxes read from `files`, changed box by
 * box with retail's `setKey` rules, and written back over `files` (or over
 * the shipped maps after DEFAULT, which refills every box and every
 * `game.set*` word from them, as `DefaultAllControls` 0x006c6520 loads the
 * default files).
 */
export function createDraft(files) {
  let base = { ...files };
  let boxes = readBoxes(base);
  let dirty = false;
  let conflicts = null;

  const cellsOf = (context, id) => {
    const key = `${context}|${id}`;
    if (!boxes.has(key)) boxes.set(key, [null, null]);
    return boxes.get(key);
  };
  const partnerId = id => (id.endsWith(':+') ? `${id.slice(0, -1)}-` : id.endsWith(':-') ? `${id.slice(0, -1)}+` : null);
  const touch = () => { dirty = true; conflicts = null; };

  /** `setKey`'s first step: a box that held an axis takes it out of the
   *  other half of its pair too. */
  function dropAxisPartner(context, id, slot) {
    const cell = cellsOf(context, id)[slot];
    const partner = partnerId(id);
    if (!partner || !isAxisInput(cell)) return;
    const other = cellsOf(context, partner);
    if (isAxisInput(other[slot]) && other[slot].type === cell.type && other[slot].axis === cell.axis) other[slot] = null;
  }

  /** The alternate never repeats the primary. */
  function dedupeRow(context, id) {
    const cells = cellsOf(context, id);
    if (cells[0] && cells[1] && sameInput(cells[0], cells[1])) cells[1] = null;
  }

  const draft = {
    get dirty() { return dirty; },
    get base() { return base; },
    get boxes() { return boxes; },

    /** A row's two boxes. */
    cells: (context, id) => [...cellsOf(context, id)],

    /** Put `input` in a box, retail's way. Returns the slot it landed in. */
    set(context, id, slot, input) {
      const cells = cellsOf(context, id);
      // An alternate defined while the primary is empty becomes the primary.
      if (slot === 1 && !cells[0]) slot = 0;
      dropAxisPartner(context, id, slot);
      const partner = partnerId(id);
      if (isAxisInput(input)) {
        if (!partner) return -1;     // a button row takes no axis
        cells[slot] = { ...input };
        const other = cellsOf(context, partner);
        dropAxisPartner(context, partner, slot);
        other[slot] = { ...input, dir: -input.dir };
        dedupeRow(context, partner);
      } else {
        cells[slot] = { ...input };
        if (partner) {
          // A box line holds one device's pair: an axis left in the other
          // half, or a button of the other device, cannot share the line.
          const other = cellsOf(context, partner);
          const o = other[slot];
          if (isAxisInput(o) || (isButton(input) && isButton(o) && o.type !== input.type)) other[slot] = null;
        }
      }
      dedupeRow(context, id);
      touch();
      return slot;
    },

    /** Escape while a box waits: the box is unbound (`setKey("")`,
     *  0x006c6816..0x006c683f), an axis from both halves. */
    clear(context, id, slot) {
      dropAxisPartner(context, id, slot);
      cellsOf(context, id)[slot] = null;
      touch();
    },

    /** DEFAULT: every box, and the files under them, back to the shipped
     *  maps. Nothing is written until SAVE. */
    reset(defaults = CONTROLS_DEFAULTS.files) {
      base = { ...defaults };
      boxes = readBoxes(base);
      touch();
    },

    /** `context|id|slot` -> the maps it conflicts in. */
    conflicts() { return (conflicts ??= findConflicts(boxes)); },
    hasConflicts() { return draft.conflicts().size > 0; },

    /** The four files SAVE writes. */
    files: () => serializeFiles(base, boxes),
  };
  return draft;
}
