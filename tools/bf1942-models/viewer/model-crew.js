// The model browser's crew console: one station per seat (its traverse dial,
// elevation scale, stick and drive pads, levers, gear switch, engine switch,
// triggers and seat camera), the keys that work them, and the panel's
// collapse. The rig it drives is `model-rig.js`. Lifted out of index.html
// (features/vehicle-instance-refactor, Part 2c).

import { FREE_RANGE, GEAR_INPUT, keyOf } from './model-rig.js';

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

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `animatedNodes`, `applyRig`, `browser`, `buildTrigger`, `engineRunning`,
 * `fireGroups`, `goToView`, `inputValues`, `mixer`, `orbitView`,
 * `renderHints`, `rigged`, `seatViews`, `setEngine`, `setInput`,
 * `startAnimating`, `startFiring`, `stopFiring`, `syncRange`,
 * `updateTouchpadUI`.
 */
export function createCrewConsole(page) {
  const crewConsole = {};

  // --- crew console ------------------------------------------------------------
  //
  // Every rig input, every FireArms template and every camera template names the
  // PlayerControlObject it belongs to. That name is a seat, and the console gives
  // each seat one station: how it aims, what it fires and where its camera sits,
  // side by side. As three sidebar sections that each spanned every seat, the
  // commander's Browning trigger sat a screen away from the dial that points it.

  const crewEl = document.getElementById('crew');
  const crewRow = document.getElementById('crew-row');
  const crew = {
    stations: [],
    active: 0,
    view: null,
    gear: null,
    held: new Map(),      // key -> { inputKey, direction }
    keyGuns: new Map(),   // key -> fire group it started
    refreshers: [],
  };

  const KNOWN_INPUTS = new Set([...Object.values(AIM), ...Object.values(STICK), ...Object.values(DRIVE), GEAR_INPUT]);

  // Held keys push an input to its end stop and let it spring home on release,
  // like the real controls — and they leave the mouse free for a dial.
  const KEY_INPUTS = {
    w: [DRIVE.y, 1], s: [DRIVE.y, -1], a: [DRIVE.x, -1], d: [DRIVE.x, 1],
    ArrowUp: [STICK.y, 1], ArrowDown: [STICK.y, -1],
    ArrowLeft: [STICK.x, -1], ArrowRight: [STICK.x, 1],
  };

  const EYE_ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const signedDegrees = degrees => {
    const rounded = Math.round(degrees);
    return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}°`;
  };
  // Live readouts sit in auto-width stations, so a value that gains a digit or
  // a sign would widen its station and shove every station after it. In a mono
  // face a fixed character count is a fixed width.
  const steady = (text, width) => text.padStart(width);
  const signedPercent = value => {
    const rounded = Math.round(value * 100);
    return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}`;
  };

  function refreshCrew() {
    for (const refresh of crew.refreshers) refresh();
  }

  function setCrewInput(key, value) {
    page.setInput(key, Math.max(-1, Math.min(1, value)));
    page.applyRig();
    refreshCrew();
    page.startAnimating();
  }

  /** Pointer drag with capture; `onPoint` gets every move while held. */
  function draggable(element, onPoint, onRelease) {
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

  function rangeText(spec) {
    return spec.driver === 'rate' ? 'continuous'
      : spec.free ? 'free 360°'
      : `${spec.min}°..${spec.max}°`;
  }

  function cleanControl(control, entry) {
    const root = (entry?.name || '').toLowerCase();
    let label = control;
    if (root && label.toLowerCase().startsWith(root)) label = label.slice(root.length);
    return label
      .replace(/^eod_/i, '')
      .replace(/pco/ig, '')
      .replace(/_+/g, ' ')
      .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function labelStations(stations, entry) {
    let unnamed = 0;
    for (const seat of stations) {
      if (seat.root) {
        seat.name = entry?.category === 'air' ? 'Pilot'
          : entry?.category === 'sea' ? 'Helm'
          : entry?.category === 'land' ? 'Driver'
          : entry?.category === 'emplacement' ? 'Gunner'
          : 'Weapon';
        continue;
      }
      const cleaned = cleanControl(seat.control, entry);
      if (!cleaned || /^\d+$/.test(cleaned)) {
        unnamed += 1;
        seat.name = `${seat.guns.length || seat.inputs.size ? 'Gunner' : 'Seat'} ${cleaned || unnamed}`;
      } else {
        seat.name = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
    }
    // "Browning 1" with no Browning 2 beside it is just "Browning".
    const numbered = seat => /^(.*) \d+$/.exec(seat.name)?.[1];
    const bases = new Map();
    for (const seat of stations) {
      const base = numbered(seat);
      if (base) bases.set(base, (bases.get(base) || 0) + 1);
    }
    for (const seat of stations) {
      const base = numbered(seat);
      if (base && bases.get(base) === 1 && !stations.some(other => other.name === base)) seat.name = base;
    }
  }

  function stationRole(seat) {
    const has = input => seat.inputs.has(input);
    return [
      has(DRIVE.x) || has(DRIVE.y) ? (crew.category === 'air' ? 'throttle' : 'drive') : null,
      has(AIM.x) || has(AIM.y) ? 'aim' : null,
      has(STICK.x) || has(STICK.y) ? 'stick' : null,
      has(GEAR_INPUT) ? 'gear' : null,
      seat.guns.length ? `${seat.guns.length} gun${seat.guns.length === 1 ? '' : 's'}` : null,
      seat.engine ? 'engine' : null,
      seat.riders ? `${seat.views.length} camera${seat.views.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
  }

  function collectStations(entry) {
    const byControl = new Map();
    const seatFor = control => {
      const key = control || 'vehicle';
      if (!byControl.has(key)) {
        byControl.set(key, { control: key, inputs: new Map(), guns: [], views: [] });
      }
      return byControl.get(key);
    };
    for (const part of page.rigged) {
      for (const [axis, spec] of Object.entries(part.axes)) {
        const seat = seatFor(part.control);
        if (!seat.inputs.has(spec.input)) {
          seat.inputs.set(spec.input, {
            key: keyOf(seat.control, spec.input), input: spec.input, specs: [], driven: [], rate: false,
          });
        }
        const input = seat.inputs.get(spec.input);
        input.specs.push({ ...spec, axis });
        input.driven.push(`${part.node.name} · ${axis} ${rangeText(spec)}`);
        if (spec.driver === 'rate') input.rate = true;
      }
    }
    for (const group of page.fireGroups) seatFor(group.stats.control).guns.push(group);
    const riderLabels = new Map();
    for (const node of page.seatViews) {
      const seat = seatFor(node.userData.cameraView.control);
      seat.views.push({ node });
      riderLabels.set(node, cleanControl(seat.control, entry));
    }

    const rootName = (entry?.name || '').toLowerCase();
    const seats = [...byControl.values()];
    for (const seat of seats) {
      seat.root = seat.control === 'vehicle' || seat.control.toLowerCase() === rootName;
    }
    // Driver or pilot first; every other seat in the order it was authored.
    seats.sort((a, b) => Number(b.root) - Number(a.root));
    const stations = seats.filter(seat => seat.inputs.size || seat.guns.length);
    if (page.mixer) {
      let home = stations.find(seat => seat.root);
      if (!home) {
        home = seats.find(seat => seat.root) || seatFor('vehicle');
        home.root = true;
        stations.unshift(home);
      }
      home.engine = true;
    }
    labelStations(stations, entry);
    // Seats that only ride (the Hanomag's four passengers) share one station of
    // cameras rather than four empty columns.
    const riders = seats.filter(seat => !stations.includes(seat) && seat.views.length);
    if (riders.length) {
      stations.push({
        control: 'riders',
        riders: true,
        name: 'Passengers',
        inputs: new Map(),
        guns: [],
        views: riders.flatMap(seat => seat.views.map(view => ({
          node: view.node,
          label: riderLabels.get(view.node) || seat.control,
        }))),
      });
    }
    return stations;
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

    crew.refreshers.push(() => {
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

    crew.refreshers.push(() => {
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

    crew.refreshers.push(() => {
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
    crew.refreshers.push(() => {
      const value = page.inputValues.get(input.key) ?? 0;
      slider.value = String(value);
      page.syncRange(slider);
      read.textContent = steady(signedPercent(value), 4);
    });
    return wrap;
  }

  function tweenGear(key, target) {
    crew.gear = { key, from: page.inputValues.get(key) ?? 0, to: target, t: 0 };
    page.startAnimating();
  }

  /** Landing gear travels rather than teleports. True while moving. */
  function advanceGear(dt) {
    const gear = crew.gear;
    if (!gear) return false;
    gear.t = Math.min(1, gear.t + dt / 0.9);
    const eased = gear.t < .5 ? 2 * gear.t * gear.t : 1 - ((-2 * gear.t + 2) ** 2) / 2;
    page.setInput(gear.key, gear.from + (gear.to - gear.from) * eased);
    page.applyRig();
    refreshCrew();
    if (gear.t >= 1) crew.gear = null;
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
    crew.refreshers.push(() => {
      const target = crew.gear?.key === input.key ? crew.gear.to : (page.inputValues.get(input.key) ?? 0);
      down.setAttribute('aria-pressed', String(target < .5));
      up.setAttribute('aria-pressed', String(target >= .5));
    });
    return wrap;
  }

  function viewButton(view, seat, text) {
    const button = make('button', text ? 'crew-btn' : 'crew-btn station-view');
    button.type = 'button';
    button.dataset.view = '';
    button.viewNode = view.node;
    button.setAttribute('aria-pressed', 'false');
    if (text) {
      button.textContent = text;
    } else {
      button.innerHTML = EYE_ICON;
      button.setAttribute('aria-label', `Look from the ${seat.name.toLowerCase()} seat`);
      button.title = `Seat camera · ${view.node.name}`;
    }
    button.addEventListener('click', () => {
      markActiveView(view.node);
      page.goToView(view.node);
    });
    return button;
  }

  function buildStation(seat, index, entry) {
    const station = make('div', 'station');
    station.dataset.active = 'false';
    station.title = seat.riders ? '' : seat.control;
    station.addEventListener('pointerdown', () => setActiveStation(index));

    const head = make('div', 'station-head');
    if (index < 9) head.append(make('kbd', 'station-key', String(index + 1)));
    head.append(make('span', 'station-name', seat.name), make('span', 'station-role', stationRole(seat)));
    if (!seat.riders && seat.views.length) head.append(viewButton(seat.views[0], seat));
    station.append(head);

    if (seat.riders) {
      const views = make('div', 'station-views');
      for (const view of seat.views) views.append(viewButton(view, seat, view.label));
      station.append(views);
      return station;
    }

    const body = make('div', 'station-body');
    const controls = make('div', 'station-controls');
    const inputs = seat.inputs;
    const air = entry?.category === 'air';

    if (inputs.has(AIM.x) || inputs.has(AIM.y)) {
      const sight = make('div', 'instrument-row');
      if (inputs.has(AIM.x)) sight.append(traverseDial(inputs.get(AIM.x)));
      if (inputs.has(AIM.y)) sight.append(elevationScale(inputs.get(AIM.y)));
      controls.append(sight);
    }
    if (inputs.has(STICK.x) && inputs.has(STICK.y)) {
      controls.append(xyPad(inputs.get(STICK.x), inputs.get(STICK.y),
        { label: 'Stick', xName: 'roll', yName: 'pitch', spring: false }));
    }
    if (inputs.has(DRIVE.x) && inputs.has(DRIVE.y)) {
      controls.append(xyPad(inputs.get(DRIVE.x), inputs.get(DRIVE.y), {
        label: air ? 'Rudder · throttle' : 'Drive',
        xName: air ? 'rud' : 'str',
        yName: 'thr',
        spring: true,
      }));
    }
    const paired = new Set();
    for (const pair of [STICK, DRIVE]) {
      if (inputs.has(pair.x) && inputs.has(pair.y)) paired.add(pair.x).add(pair.y);
    }
    const levers = make('div', 'instrument-row');
    for (const [name, input] of inputs) {
      if (name === AIM.x || name === AIM.y || paired.has(name) || name === GEAR_INPUT) continue;
      const label = name === DRIVE.x && air ? 'Rudder' : SHORT_LABEL[name] || name.replace(/^c_PI/, '');
      levers.append(lever(input, KNOWN_INPUTS.has(name) ? label : label));
    }
    if (levers.childElementCount) controls.append(levers);
    if (inputs.has(GEAR_INPUT) || seat.engine) {
      const extras = make('div', 'instrument');
      if (inputs.has(GEAR_INPUT)) extras.append(gearSwitch(inputs.get(GEAR_INPUT)));
      if (seat.engine) {
        const engine = make('button', 'crew-btn', 'Engine');
        engine.type = 'button';
        engine.title = page.animatedNodes.length ? `Spins ${page.animatedNodes.join(', ')}` : 'Run the baked engine clips';
        engine.addEventListener('click', () => page.setEngine(!page.engineRunning));
        crew.refreshers.push(() => engine.setAttribute('aria-pressed', String(page.engineRunning)));
        const engineWrap = make('div', 'instrument');
        engineWrap.append(make('div', 'instrument-label', 'Engine'), engine);
        extras.append(engineWrap);
      }
      controls.append(extras);
    }

    const triggers = make('div', 'station-triggers');
    seat.guns.forEach((group, slot) => {
      triggers.append(page.buildTrigger(group, entry, slot === 0 ? 'Space' : slot === 1 ? 'F' : null));
    });
    body.append(controls, triggers);
    station.append(body);
    return station;
  }

  function setActiveStation(index) {
    if (!crew.stations[index] || index === crew.active) {
      if (crew.stations[index]) crewRow.children[index].dataset.active = 'true';
      page.updateTouchpadUI();
      return;
    }
    crew.active = index;
    [...crewRow.children].forEach((node, position) => {
      node.dataset.active = String(position === index);
    });
    page.updateTouchpadUI();
  }

  function markActiveView(node) {
    crew.view = node;
    document.getElementById('view-orbit').setAttribute('aria-pressed', String(!node));
    for (const button of crewRow.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.viewNode === node));
    }
  }

  function renderCrewKeys() {
    const has = input => crew.stations.some(seat => seat.inputs.has(input));
    const keys = [];
    if (crew.stations.length > 1) keys.push([`1–${Math.min(crew.stations.length, 9)}`, 'station']);
    if (crew.stations.some(seat => seat.guns.length)) keys.push(['Space', 'fire']);
    if (crew.stations.some(seat => seat.guns.length > 1)) keys.push(['F', 'second gun']);
    if (has(DRIVE.x) || has(DRIVE.y)) keys.push(['WASD', 'drive']);
    if (has(STICK.x) || has(STICK.y)) keys.push(['Arrows', 'stick']);
    if (has(GEAR_INPUT)) keys.push(['G', 'gear']);
    if (page.mixer) keys.push(['E', 'engine']);
    if (page.seatViews.length) keys.push(['V', 'seat view'], ['O', 'orbit']);
    document.getElementById('crew-keys').innerHTML =
      keys.map(([key, what]) => `<span><kbd>${key}</kbd>${what}</span>`).join('');
  }

  function releaseCrewKeys() {
    const keys = new Set([...crew.held.values()].map(held => held.inputKey));
    crew.held.clear();
    for (const inputKey of keys) setCrewInput(inputKey, 0);
    for (const group of crew.keyGuns.values()) page.stopFiring(group);
    crew.keyGuns.clear();
  }

  function buildCrew(entry) {
    crew.held.clear();
    crew.keyGuns.clear();
    crew.gear = null;
    crew.refreshers = [];
    crew.active = -1;
    crew.category = entry?.category || null;
    crew.stations = collectStations(entry);
    crewRow.replaceChildren(...crew.stations.map((seat, index) => buildStation(seat, index, entry)));
    crewEl.hidden = !crew.stations.length;
    setActiveStation(0);
    const count = crew.stations.length;
    document.getElementById('crew-count').textContent = `${count} ${count === 1 ? 'station' : 'stations'}`;
    document.getElementById('view-orbit').hidden = !page.seatViews.length;
    markActiveView(null);
    renderCrewKeys();
    refreshCrew();
    page.renderHints();
    page.updateTouchpadUI();
  }

  function stationWith(input) {
    const active = crew.stations[crew.active];
    if (active?.inputs.has(input)) return active;
    return crew.stations.find(seat => seat.inputs.has(input)) || null;
  }

  /** The active station's gun in `slot`, or the first station that has one. */
  function gunInSlot(slot) {
    if (!crew.stations[crew.active]?.guns[slot]) {
      const index = crew.stations.findIndex(seat => seat.guns[slot]);
      if (index < 0) return null;
      setActiveStation(index);
    }
    return crew.stations[crew.active].guns[slot];
  }

  function crewKey(event, down) {
    if (crewEl.hidden || !page.browser.hidden) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return false;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (KEY_INPUTS[key]) {
      const [inputName, direction] = KEY_INPUTS[key];
      const seat = stationWith(inputName);
      if (!seat) return false;
      const inputKey = keyOf(seat.control, inputName);
      if (down) {
        if (event.repeat) return true;
        crew.held.set(key, { inputKey, direction });
      } else {
        crew.held.delete(key);
      }
      let value = 0;
      for (const held of crew.held.values()) if (held.inputKey === inputKey) value += held.direction;
      setCrewInput(inputKey, value);
      return true;
    }

    if (key === ' ' || key === 'f') {
      // A focused control outside the console keeps its own Space.
      if (key === ' ' && target.tagName === 'BUTTON' && !crewEl.contains(target)) return false;
      if (!down) {
        const group = crew.keyGuns.get(key);
        crew.keyGuns.delete(key);
        if (group) page.stopFiring(group);
        return Boolean(group);
      }
      if (event.repeat) return crew.keyGuns.has(key);
      const group = gunInSlot(key === ' ' ? 0 : 1);
      if (!group) return false;
      crew.keyGuns.set(key, group);
      page.startFiring(group);
      return true;
    }

    if (!down || event.repeat) return false;
    if (/^[1-9]$/.test(key) && crew.stations[Number(key) - 1]) {
      setActiveStation(Number(key) - 1);
      return true;
    }
    if (key === 'g') {
      const seat = stationWith(GEAR_INPUT);
      if (!seat) return false;
      const inputKey = keyOf(seat.control, GEAR_INPUT);
      const heading = crew.gear?.key === inputKey ? crew.gear.to : (page.inputValues.get(inputKey) ?? 0);
      tweenGear(inputKey, heading < .5 ? 1 : 0);
      return true;
    }
    if (key === 'e' && page.mixer) {
      page.setEngine(!page.engineRunning);
      return true;
    }
    if (key === 'v') {
      const view = crew.stations[crew.active]?.views[0]
        || crew.stations.find(seat => seat.views.length)?.views[0];
      if (!view) return false;
      markActiveView(view.node);
      page.goToView(view.node);
      return true;
    }
    if (key === 'o' && page.seatViews.length) {
      page.orbitView();
      return true;
    }
    return false;
  }

  addEventListener('keydown', event => { if (crewKey(event, true)) event.preventDefault(); });
  addEventListener('keyup', event => { if (crewKey(event, false)) event.preventDefault(); });
  // A key released while the tab is in the background never sends keyup.
  addEventListener('blur', releaseCrewKeys);

  const CREW_COLLAPSED_KEY = 'bf42-mesh-crew-collapsed';
  function setCrewCollapsed(collapsed) {
    crewEl.dataset.collapsed = String(collapsed);
    const button = document.getElementById('crew-collapse');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand crew stations' : 'Collapse crew stations');
    try {
      if (collapsed) localStorage.setItem(CREW_COLLAPSED_KEY, '1');
      else localStorage.removeItem(CREW_COLLAPSED_KEY);
    } catch { /* private mode: the console just opens expanded next time */ }
  }
  try {
    if (localStorage.getItem(CREW_COLLAPSED_KEY)) setCrewCollapsed(true);
  } catch { /* unreadable storage: default expanded */ }
  document.getElementById('crew-collapse').addEventListener('click', () =>
    setCrewCollapsed(crewEl.dataset.collapsed !== 'true'));
  document.getElementById('view-orbit').addEventListener('click', page.orbitView);

  Object.assign(crewConsole, {
    advanceGear,
    buildCrew,
    crew,
    markActiveView,
    refreshCrew,
    setActiveStation,
    setCrewInput,
    stationRole,
  });
  return crewConsole;
}
