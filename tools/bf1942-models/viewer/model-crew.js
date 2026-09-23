// The model browser's crew console: one station per seat (its traverse dial,
// elevation scale, stick and drive pads, levers, gear switch, engine switch,
// triggers and seat camera), the keys that work them, and the panel's
// collapse. The rig it drives is `model-rig.js`. Lifted out of index.html
// (features/vehicle-instance-refactor, Part 2c).

import { GEAR_INPUT, keyOf } from './model-rig.js';
import { AIM, DRIVE, SHORT_LABEL, STICK, createCrewInstruments, make, rangeText } from './crew-instruments.js';

export { AIM, STICK, DRIVE, SHORT_LABEL, degreesAt, inputFor } from './crew-instruments.js';

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

  function refreshCrew() {
    for (const refresh of crew.refreshers) refresh();
  }

  function setCrewInput(key, value) {
    page.setInput(key, Math.max(-1, Math.min(1, value)));
    page.applyRig();
    refreshCrew();
    page.startAnimating();
  }

  const instruments = createCrewInstruments(page, {
    setCrewInput, refreshCrew, onRefresh: fn => crew.refreshers.push(fn),
  });
  const { advanceGear, elevationScale, gearSwitch, lever, traverseDial, tweenGear, xyPad } = instruments;

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
    instruments.stopGear();
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
      tweenGear(inputKey, instruments.gearHeading(inputKey) < .5 ? 1 : 0);
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
