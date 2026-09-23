// The model browser's touchpad: a floating disk that works the active crew
// station's aim, stick or drive by drag, and fires its first gun from the
// centre. Lifted out of index.html (features/vehicle-instance-refactor,
// Part 2c).

import { AIM, DRIVE, STICK, degreesAt, inputFor } from './model-crew.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `crew`, `inputValues`, `setActiveStation`, `setCrewInput`,
 * `startAnimating`, `startFiring`, `stopFiring`.
 */
export function createTouchpad(page) {
  const touchpad = {};

  // --- touchpad virtual controller --------------------------------------------
  //
  // A floating disk for vehicles with seats, controllable axes or weapons.
  // Dragging the disk controls turret traverse & elevation (or flight stick or
  // drive steering); pressing the central zone fires weapons while dragging.

  touchpad.touchpadOpen = false;
  touchpad.padFiring = false;
  const padVector = { x: 0, y: 0 };
  const TURRET_TRAVERSE_SPEED = 85;   // degrees / sec at full deflection
  const TURRET_ELEVATION_SPEED = 42;  // degrees / sec at full deflection
  const R_PAD_MAX = 42;               // max puck travel radius in px
  const R_PAD_FIRE = 27;              // central fire zone radius in px

  const touchpadWrap = document.getElementById('touchpad-disk-wrap');
  const touchpadDisk = document.getElementById('touchpad-disk');
  const touchpadPuck = document.getElementById('touchpad-puck');
  const touchpadPuckLabel = document.getElementById('touchpad-puck-label');
  const touchpadToggleBtn = document.getElementById('stage-touchpad-toggle');
  const touchpadCloseBtn = document.getElementById('touchpad-close-btn');
  const touchpadStationBtn = document.getElementById('touchpad-station-btn');
  const touchpadStationName = document.getElementById('touchpad-station-name');
  const viewTouchpadBtn = document.getElementById('view-touchpad');

  function hasTouchpadCapability() {
    return page.crew.stations.length > 0 && page.crew.stations.some(s => s.inputs.size > 0 || s.guns.length > 0);
  }

  function bestTouchpadStationIndex() {
    if (!page.crew.stations.length) return 0;
    // If current station has guns or aim, keep it
    const current = page.crew.stations[page.crew.active];
    if (current && (current.guns.length || current.inputs.has(AIM.x) || current.inputs.has(AIM.y))) {
      return page.crew.active;
    }
    // Otherwise find first station with both aim and guns
    const withAimAndGuns = page.crew.stations.findIndex(s => (s.inputs.has(AIM.x) || s.inputs.has(AIM.y)) && s.guns.length);
    if (withAimAndGuns !== -1) return withAimAndGuns;
    // Or station with guns
    const withGuns = page.crew.stations.findIndex(s => s.guns.length > 0);
    if (withGuns !== -1) return withGuns;
    // Or station with aim
    const withAim = page.crew.stations.findIndex(s => s.inputs.has(AIM.x) || s.inputs.has(AIM.y));
    if (withAim !== -1) return withAim;
    return 0;
  }

  function updateTouchpadUI() {
    if (!hasTouchpadCapability()) {
      if (touchpadWrap) touchpadWrap.hidden = true;
      if (touchpadToggleBtn) touchpadToggleBtn.hidden = true;
      if (viewTouchpadBtn) viewTouchpadBtn.hidden = true;
      return;
    }
    const seat = page.crew.stations[page.crew.active];
    if (touchpadStationName && seat) {
      touchpadStationName.textContent = seat.name;
    }
    if (touchpadPuckLabel && seat) {
      if (seat.guns.length > 0) {
        touchpadPuckLabel.textContent = 'FIRE';
      } else if (seat.inputs.has(AIM.x) || seat.inputs.has(AIM.y)) {
        touchpadPuckLabel.textContent = 'AIM';
      } else if (seat.inputs.has(STICK.x) || seat.inputs.has(STICK.y)) {
        touchpadPuckLabel.textContent = 'STICK';
      } else if (seat.inputs.has(DRIVE.x) || seat.inputs.has(DRIVE.y)) {
        touchpadPuckLabel.textContent = 'DRIVE';
      } else {
        touchpadPuckLabel.textContent = 'MOVE';
      }
    }
    if (touchpadToggleBtn) {
      touchpadToggleBtn.hidden = touchpad.touchpadOpen;
      touchpadToggleBtn.setAttribute('aria-pressed', String(touchpad.touchpadOpen));
    }
    if (viewTouchpadBtn) {
      viewTouchpadBtn.hidden = false;
      viewTouchpadBtn.setAttribute('aria-pressed', String(touchpad.touchpadOpen));
    }
    if (touchpadWrap) {
      touchpadWrap.hidden = !touchpad.touchpadOpen;
    }
  }

  function setTouchpadOpen(open) {
    touchpad.touchpadOpen = Boolean(open && hasTouchpadCapability());
    if (touchpad.touchpadOpen) {
      const best = bestTouchpadStationIndex();
      if (best !== page.crew.active) page.setActiveStation(best);
    } else {
      resetTouchpadState();
    }
    updateTouchpadUI();
  }

  function resetTouchpadState() {
    if (touchpad.padFiring) {
      const seat = page.crew.stations[page.crew.active];
      if (seat?.guns.length) page.stopFiring(seat.guns[0]);
      touchpad.padFiring = false;
    }
    padVector.x = 0;
    padVector.y = 0;
    if (touchpadPuck) {
      touchpadPuck.classList.remove('is-firing');
      touchpadPuck.style.transform = 'translate(-50%, -50%)';
    }
    if (touchpadDisk) {
      touchpadDisk.classList.remove('is-dragging', 'is-active');
    }
  }

  function cycleTouchpadStation() {
    if (page.crew.stations.length <= 1) return;
    resetTouchpadState();
    const next = (page.crew.active + 1) % page.crew.stations.length;
    page.setActiveStation(next);
    updateTouchpadUI();
  }

  function advanceTouchpad(dt) {
    if (padVector.x === 0 && padVector.y === 0) return false;
    const seat = page.crew.stations[page.crew.active];
    if (!seat) return false;

    if (seat.inputs.has(AIM.x) || seat.inputs.has(AIM.y)) {
      if (seat.inputs.has(AIM.x) && padVector.x !== 0) {
        const inputX = seat.inputs.get(AIM.x);
        const specX = inputX.specs.find(s => s.axis === 'yaw' && s.driver !== 'rate') || inputX.specs[0];
        if (specX) {
          const low = specX.free ? -180 : Math.min(specX.min, specX.max);
          const high = specX.free ? 180 : Math.max(specX.min, specX.max);
          let deg = degreesAt(specX, page.inputValues.get(inputX.key) ?? 0);
          deg += padVector.x * TURRET_TRAVERSE_SPEED * dt;
          if (specX.free) {
            while (deg > 180) deg -= 360;
            while (deg < -180) deg += 360;
          } else {
            deg = Math.max(low, Math.min(high, deg));
          }
          page.setCrewInput(inputX.key, inputFor(specX, deg));
        }
      }
      if (seat.inputs.has(AIM.y) && padVector.y !== 0) {
        const inputY = seat.inputs.get(AIM.y);
        const specY = inputY.specs.find(s => s.axis === 'pitch' && s.driver !== 'rate') || inputY.specs[0];
        if (specY) {
          const top = specY.free ? 90 : Math.max(-specY.min, -specY.max);
          const bottom = specY.free ? -90 : Math.min(-specY.min, -specY.max);
          let elev = -degreesAt(specY, page.inputValues.get(inputY.key) ?? 0);
          elev += padVector.y * TURRET_ELEVATION_SPEED * dt;
          elev = Math.max(bottom, Math.min(top, elev));
          page.setCrewInput(inputY.key, inputFor(specY, -elev));
        }
      }
      return true;
    }

    if (seat.inputs.has(STICK.x) || seat.inputs.has(STICK.y)) {
      const inputX = seat.inputs.get(STICK.x);
      const inputY = seat.inputs.get(STICK.y);
      if (inputX) page.setCrewInput(inputX.key, padVector.x);
      if (inputY) page.setCrewInput(inputY.key, padVector.y);
      return true;
    }

    if (seat.inputs.has(DRIVE.x) || seat.inputs.has(DRIVE.y)) {
      const inputX = seat.inputs.get(DRIVE.x);
      const inputY = seat.inputs.get(DRIVE.y);
      if (inputX) page.setCrewInput(inputX.key, padVector.x);
      if (inputY) page.setCrewInput(inputY.key, padVector.y);
      return true;
    }

    return false;
  }

  if (touchpadDisk) {
    let padDragging = false;

    touchpadDisk.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      try { touchpadDisk.setPointerCapture(event.pointerId); } catch {}
      padDragging = true;
      touchpadDisk.classList.add('is-dragging', 'is-active');

      const rect = touchpadDisk.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= R_PAD_FIRE) {
        touchpad.padFiring = true;
        const seat = page.crew.stations[page.crew.active];
        if (seat?.guns.length) page.startFiring(seat.guns[0]);
        touchpadPuck.classList.add('is-firing');
      } else {
        touchpad.padFiring = false;
        touchpadPuck.classList.remove('is-firing');
      }

      const clampedDist = Math.min(dist, R_PAD_MAX);
      const angle = Math.atan2(dy, dx);
      const px = Math.cos(angle) * clampedDist;
      const py = Math.sin(angle) * clampedDist;
      padVector.x = px / R_PAD_MAX;
      padVector.y = -py / R_PAD_MAX;
      touchpadPuck.style.transform = `translate(calc(-50% + ${px.toFixed(1)}px), calc(-50% + ${py.toFixed(1)}px))`;
      page.startAnimating();
    });

    touchpadDisk.addEventListener('pointermove', event => {
      if (!padDragging && !touchpadDisk.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = touchpadDisk.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy);

      const clampedDist = Math.min(dist, R_PAD_MAX);
      const angle = Math.atan2(dy, dx);
      const px = Math.cos(angle) * clampedDist;
      const py = Math.sin(angle) * clampedDist;
      padVector.x = px / R_PAD_MAX;
      padVector.y = -py / R_PAD_MAX;
      touchpadPuck.style.transform = `translate(calc(-50% + ${px.toFixed(1)}px), calc(-50% + ${py.toFixed(1)}px))`;
      page.startAnimating();
    });

    const onPadRelease = event => {
      try {
        if (touchpadDisk.hasPointerCapture(event.pointerId)) {
          touchpadDisk.releasePointerCapture(event.pointerId);
        }
      } catch {}
      padDragging = false;
      event.preventDefault();
      event.stopPropagation();

      if (touchpad.padFiring) {
        const seat = page.crew.stations[page.crew.active];
        if (seat?.guns.length) page.stopFiring(seat.guns[0]);
        touchpad.padFiring = false;
      }
      padVector.x = 0;
      padVector.y = 0;
      touchpadDisk.classList.remove('is-dragging', 'is-active');
      touchpadPuck.classList.remove('is-firing');
      touchpadPuck.style.transform = 'translate(-50%, -50%)';

      const seat = page.crew.stations[page.crew.active];
      if (seat) {
        if (seat.inputs.has(STICK.x)) page.setCrewInput(seat.inputs.get(STICK.x).key, 0);
        if (seat.inputs.has(STICK.y)) page.setCrewInput(seat.inputs.get(STICK.y).key, 0);
        if (seat.inputs.has(DRIVE.x)) page.setCrewInput(seat.inputs.get(DRIVE.x).key, 0);
        if (seat.inputs.has(DRIVE.y)) page.setCrewInput(seat.inputs.get(DRIVE.y).key, 0);
      }
    };

    touchpadDisk.addEventListener('pointerup', onPadRelease);
    touchpadDisk.addEventListener('pointercancel', onPadRelease);

    touchpadDisk.addEventListener('dblclick', event => {
      const rect = touchpadDisk.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(event.clientX - cx, event.clientY - cy);
      if (dist > R_PAD_FIRE) {
        const seat = page.crew.stations[page.crew.active];
        if (seat) {
          for (const input of seat.inputs.values()) page.setCrewInput(input.key, 0);
        }
      }
    });
  }

  touchpadToggleBtn?.addEventListener('click', () => setTouchpadOpen(true));
  touchpadCloseBtn?.addEventListener('click', () => setTouchpadOpen(false));
  viewTouchpadBtn?.addEventListener('click', () => setTouchpadOpen(!touchpad.touchpadOpen));
  touchpadStationBtn?.addEventListener('click', cycleTouchpadStation);

  Object.assign(touchpad, {
    advanceTouchpad,
    updateTouchpadUI,
  });
  return touchpad;
}
