// The crew console's instruments: the traverse dial, the elevation scale, the
// XY pads, the levers and the landing-gear switch, and the small DOM and
// readout helpers they are built from. Split out of `model-crew.js`, which
// keeps the stations, the keys and the collapse. The gear's travel is owned
// here; the console asks for its heading or stops it.

import { FREE_RANGE, GEAR_INPUT } from './model-rig.js';

export const AIM = { x: 'c_PIMouseLookX', y: 'c_PIMouseLookY' };
export const STICK = { x: 'c_PIRoll', y: 'c_PIPitch' };
export const DRIVE = { x: 'c_PIYaw', y: 'c_PIThrottle' };

export const SHORT_LABEL = {
  c_PIYaw: 'Steer',
  c_PIThrottle: 'Throttle',
  c_PIMouseLookX: 'Traverse',
  c_PIMouseLookY: 'Elevate',
  c_PIPitch: 'Pitch',
  c_PIRoll: 'Roll',
  c_PILandingGear: 'Gear',
};

/** Where a positional axis sits for input `t`, exactly as applyRig() poses it. */
export function degreesAt(spec, t) {
  if (spec.free) return t * FREE_RANGE;
  if (spec.input === GEAR_INPUT) return spec.min + t * (spec.max - spec.min);
  return t < 0 ? -t * spec.min : t * spec.max;
}

/** The input that puts a part nearest `degrees`, preferring the smaller input on
 *  a tie so a one-sided range (0..40) never snaps to its far end. */
export function inputFor(spec, degrees) {
  let best = 0;
  let bestGap = Math.abs(degreesAt(spec, 0) - degrees);
  for (let step = -200; step <= 200; step++) {
    const t = step / 200;
    const gap = Math.abs(degreesAt(spec, t) - degrees);
    if (gap < bestGap - 1e-9) {
      best = t;
      bestGap = gap;
    }
  }
  return best;
}

export function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export const signedDegrees = degrees => {
  const rounded = Math.round(degrees);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}°`;
};
// Live readouts sit in auto-width stations, so a value that gains a digit or
// a sign would widen its station and shove every station after it. In a mono
// face a fixed character count is a fixed width.
export const steady = (text, width) => text.padStart(width);
export const signedPercent = value => {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}`;
};

/** Pointer drag with capture; `onPoint` gets every move while held. */
export function draggable(element, onPoint, onRelease) {
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    element.classList.add('dragging');
    onPoint(event);
  });
  element.addEventListener('pointermove', event => {
    if (element.hasPointerCapture(event.pointerId)) onPoint(event);
  });
  const release = event => {
    if (!element.classList.contains('dragging')) return;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.classList.remove('dragging');
    onRelease?.();
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
}

export function rangeText(spec) {
  return spec.driver === 'rate' ? 'continuous'
    : spec.free ? 'free 360°'
    : `${spec.min}°..${spec.max}°`;
}

/**
 * `page` is the console's own bag. `setCrewInput` and `refreshCrew` are the
 * console's; `onRefresh(fn)` registers a readout with the stations being built.
 */
export function createCrewInstruments(page, { setCrewInput, refreshCrew, onRefresh }) {
  let gear = null;   // { key, from, to, t } while the gear travels

  /** Where the gear is going (or sits), for a key or a switch. */
  function gearHeading(key) {
    return gear?.key === key ? gear.to : (page.inputValues.get(key) ?? 0);
  }

  /** A new model: whatever the gear was doing, it is not doing it any more. */
  function stopGear() {
    gear = null;
  }

  /** Top-down traverse dial: the hull points up, the needle is the turret. */
  function traverseDial(input) {
    const spec = input.specs.find(item => item.axis === 'yaw' && item.driver !== 'rate') || input.specs[0];
    const low = spec.free ? -180 : Math.min(spec.min, spec.max);
    const high = spec.free ? 180 : Math.max(spec.min, spec.max);
    const at = (radius, degrees) => {
      const radians = degrees * Math.PI / 180;
      return `${(radius * Math.sin(radians)).toFixed(2)} ${(-radius * Math.cos(radians)).toFixed(2)}`;
    };
    const ticks = [];
    for (let degrees = 0; degrees < 360; degrees += 30) {
      const major = degrees % 90 === 0;
      ticks.push(`<path class="dial-tick${major ? ' is-major' : ''}" d="M${at(major ? 36 : 40, degrees)} L${at(46, degrees)}"/>`);
    }
    // Positive authored yaw turns right: the exporter's Z mirror flips the sign
    // (SIGN.yaw), and a negative turn about +Y is clockwise seen from above.
    const arc = spec.free ? ''
      : `<path class="dial-arc" d="M${at(42, low)} A42 42 0 ${high - low > 180 ? 1 : 0} 1 ${at(42, high)}"/>`;

    const wrap = make('div', 'instrument');
    const dial = make('div', 'dial');
    dial.tabIndex = 0;
    dial.setAttribute('role', 'slider');
    dial.setAttribute('aria-label', 'Traverse');
    dial.setAttribute('aria-valuemin', String(low));
    dial.setAttribute('aria-valuemax', String(high));
    dial.title = `Drag to traverse · double-click to centre\n${input.driven.join('\n')}`;
    dial.innerHTML = '<svg viewBox="-50 -50 100 100" aria-hidden="true">'
      + '<circle class="dial-face" r="46"/>'
      + ticks.join('')
      + arc
      + '<rect class="dial-hull" x="-8" y="-13" width="16" height="26" rx="2"/>'
      + '<path class="dial-hull" d="M-4 -17 L0 -21 L4 -17"/>'
      + '<g class="dial-pointer"><path class="dial-needle" d="M0 0 L0 -35"/><circle class="dial-tip" cy="-35" r="3"/></g>'
      + '<circle class="dial-hub" r="2.5"/>'
      + '</svg>';
    const pointer = dial.querySelector('.dial-pointer');
    const read = make('div', 'instrument-read');
    wrap.append(make('div', 'instrument-label', 'Traverse'), dial, read);

    const setDegrees = degrees => setCrewInput(input.key, inputFor(spec, Math.max(low, Math.min(high, degrees))));
    draggable(dial, event => {
      const rect = dial.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      setDegrees(Math.atan2(dx, -dy) * 180 / Math.PI);
    });
    dial.addEventListener('dblclick', () => setCrewInput(input.key, 0));
    dial.addEventListener('keydown', event => {
      const degrees = degreesAt(spec, page.inputValues.get(input.key) ?? 0);
      const step = event.shiftKey ? 15 : 3;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') setDegrees(degrees - step);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') setDegrees(degrees + step);
      else if (event.key === 'Home') setCrewInput(input.key, 0);
      else return;
      event.preventDefault();
      event.stopPropagation();
    });

    onRefresh(() => {
      const degrees = degreesAt(spec, page.inputValues.get(input.key) ?? 0);
      pointer.setAttribute('transform', `rotate(${degrees.toFixed(2)})`);
      read.textContent = spec.free
        ? `${String(Math.round(((degrees % 360) + 360) % 360)).padStart(3, '0')}°`
        : steady(signedDegrees(degrees), 5);
      dial.setAttribute('aria-valuenow', degrees.toFixed(0));
    });
    return wrap;
  }

  /** Elevation scale: the gun's reachable arc, highest at the top. */
  function elevationScale(input) {
    const spec = input.specs.find(item => item.axis === 'pitch' && item.driver !== 'rate') || input.specs[0];
    // Refractor pitch is positive nose-down (a Sherman gun reads -20..5: twenty
    // up, five down), so the scale shows the negated angle as elevation.
    const top = spec.free ? 90 : Math.max(-spec.min, -spec.max);
    const bottom = spec.free ? -90 : Math.min(-spec.min, -spec.max);
    const clampElevation = value => Math.max(bottom, Math.min(top, value));
    const yOf = value => ((top - clampElevation(value)) / ((top - bottom) || 1)) * 100;

    const wrap = make('div', 'instrument');
    const holder = make('div', 'elev-wrap');
    const scale = make('div', 'elev');
    scale.tabIndex = 0;
    scale.setAttribute('role', 'slider');
    scale.setAttribute('aria-label', 'Elevation');
    scale.setAttribute('aria-orientation', 'vertical');
    scale.setAttribute('aria-valuemin', String(bottom));
    scale.setAttribute('aria-valuemax', String(top));
    scale.title = `Drag to elevate · double-click to level\n${input.driven.join('\n')}`;
    const zero = make('div', 'elev-zero');
    zero.style.top = `${yOf(0)}%`;
    const fill = make('div', 'elev-fill');
    const mark = make('div', 'elev-mark');
    scale.append(zero, fill, mark);
    const topLabel = make('span', 'elev-lim is-top', signedDegrees(top));
    const bottomLabel = make('span', 'elev-lim is-bottom', signedDegrees(bottom));
    holder.append(scale, topLabel, bottomLabel);
    const read = make('div', 'instrument-read');
    wrap.append(make('div', 'instrument-label', 'Elevate'), holder, read);

    const setElevation = value => setCrewInput(input.key, inputFor(spec, -clampElevation(value)));
    draggable(scale, event => {
      const rect = scale.getBoundingClientRect();
      const share = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      setElevation(top - share * (top - bottom));
    });
    scale.addEventListener('dblclick', () => setCrewInput(input.key, 0));
    scale.addEventListener('keydown', event => {
      const elevation = -degreesAt(spec, page.inputValues.get(input.key) ?? 0);
      const step = event.shiftKey ? 5 : 1;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setElevation(elevation + step);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setElevation(elevation - step);
      else if (event.key === 'Home') setCrewInput(input.key, 0);
      else return;
      event.preventDefault();
      event.stopPropagation();
    });

    onRefresh(() => {
      const elevation = -degreesAt(spec, page.inputValues.get(input.key) ?? 0);
      const markY = yOf(elevation);
      const zeroY = yOf(0);
      mark.style.top = `${markY}%`;
      fill.style.top = `${Math.min(markY, zeroY)}%`;
      fill.style.height = `${Math.abs(markY - zeroY)}%`;
      read.textContent = steady(signedDegrees(elevation), 5);
      scale.setAttribute('aria-valuenow', elevation.toFixed(0));
    });
    return wrap;
  }

  /** Two inputs on one square: a stick, or a drive pad that springs home. */
  function xyPad(inputX, inputY, { label, xName, yName, spring }) {
    const wrap = make('div', 'instrument');
    const pad = make('div', 'pad');
    pad.tabIndex = 0;
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', label);
    pad.title = `${spring ? 'Hold and drag' : 'Drag'} · double-click to centre\n${[...inputX.driven, ...inputY.driven].join('\n')}`;
    const knob = make('div', 'pad-knob');
    pad.append(knob);
    const read = make('div', 'instrument-read');
    wrap.append(make('div', 'instrument-label', label), pad, read);

    const setBoth = (x, y) => {
      page.setInput(inputX.key, x);
      page.setInput(inputY.key, y);
      page.applyRig();
      refreshCrew();
      page.startAnimating();
    };
    const clamp = value => Math.max(-1, Math.min(1, Math.round(value * 100) / 100));
    draggable(pad, event => {
      const rect = pad.getBoundingClientRect();
      setBoth(
        clamp(((event.clientX - rect.left) / rect.width) * 2 - 1),
        clamp(1 - ((event.clientY - rect.top) / rect.height) * 2),
      );
    }, spring ? () => setBoth(0, 0) : null);
    // Dead centre is hard to hit by hand.
    pad.addEventListener('dblclick', () => setBoth(0, 0));

    onRefresh(() => {
      const x = page.inputValues.get(inputX.key) ?? 0;
      const y = page.inputValues.get(inputY.key) ?? 0;
      knob.style.left = `${(x + 1) * 50}%`;
      knob.style.top = `${(1 - y) * 50}%`;
      read.textContent = `${xName} ${steady(signedPercent(x), 4)} · ${yName} ${steady(signedPercent(y), 4)}`;
    });
    return wrap;
  }

  /** One input on a slider. Rate inputs (a propeller's throttle) reset on double-click. */
  function lever(input, label) {
    const wrap = make('div', 'instrument lever');
    const head = make('div', 'lever-head');
    const read = make('span', 'instrument-read');
    head.append(make('span', 'instrument-label', `${label}${input.rate ? ' · rate' : ''}`), read);
    const slider = make('input', 'range');
    slider.type = 'range';
    slider.min = '-1';
    slider.max = '1';
    slider.step = '0.01';
    slider.setAttribute('aria-label', label);
    slider.title = input.driven.join('\n');
    wrap.append(head, slider);
    slider.addEventListener('input', () => setCrewInput(input.key, Number(slider.value)));
    slider.addEventListener('dblclick', () => setCrewInput(input.key, 0));
    onRefresh(() => {
      const value = page.inputValues.get(input.key) ?? 0;
      slider.value = String(value);
      page.syncRange(slider);
      read.textContent = steady(signedPercent(value), 4);
    });
    return wrap;
  }

  function tweenGear(key, target) {
    gear = { key, from: page.inputValues.get(key) ?? 0, to: target, t: 0 };
    page.startAnimating();
  }

  /** Landing gear travels rather than teleports. True while moving. */
  function advanceGear(dt) {
    if (!gear) return false;
    gear.t = Math.min(1, gear.t + dt / 0.9);
    const eased = gear.t < .5 ? 2 * gear.t * gear.t : 1 - ((-2 * gear.t + 2) ** 2) / 2;
    page.setInput(gear.key, gear.from + (gear.to - gear.from) * eased);
    page.applyRig();
    refreshCrew();
    if (gear.t >= 1) gear = null;
    return true;
  }

  function gearSwitch(input) {
    const wrap = make('div', 'instrument');
    const seg = make('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Landing gear');
    seg.title = input.driven.join('\n');
    const down = make('button', '', 'Down');
    const up = make('button', '', 'Up');
    for (const [button, target] of [[down, 0], [up, 1]]) {
      button.type = 'button';
      button.addEventListener('click', () => tweenGear(input.key, target));
      seg.append(button);
    }
    wrap.append(make('div', 'instrument-label', 'Gear'), seg);
    onRefresh(() => {
      const target = gearHeading(input.key);
      down.setAttribute('aria-pressed', String(target < .5));
      up.setAttribute('aria-pressed', String(target >= .5));
    });
    return wrap;
  }

  return { advanceGear, elevationScale, gearHeading, gearSwitch, lever, stopGear, traverseDial, tweenGear, xyPad };
}
