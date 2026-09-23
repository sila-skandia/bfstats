// The model browser's guns: the `gunfire.js` runtime over the loaded model,
// and the hold-to-fire trigger each FireArms template gets on its crew
// station, with its round counter. Lifted out of index.html
// (features/vehicle-instance-refactor, Part 2c).

import { GunFire } from './gunfire.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `attr`, `camera`, `rememberMap`, `scene`, `startAnimating`.
 */
export function createGunTriggers(page) {
  const gunTriggers = {};

  // --- gun fire ----------------------------------------------------------------
  //
  // The runtime lives in `gunfire.js` so the map flythrough's flown Corsair can
  // fire the same guns off the same data; what stays here is the wiring the model
  // browser adds on top — the per-gun FIRE button and its round counter.
  const guns = new GunFire({
    scene: page.scene,
    camera: page.camera,
    // Material.clone() through userData would mangle the parked Texture; the
    // browser's texture-toggle bookkeeping stays in this WeakMap instead.
    onMaterial: material => page.rememberMap(material),
    onShot: group => {
      if (group.ui) group.ui.count.textContent = `${group.shots} rds`;
    },
  });
  const fireGroups = guns.groups;

  /** "Gun Barrel", "Coaxial browning": a FireArms node name without its vehicle. */
  function partLabel(name, entry) {
    const raw = String(name || '');
    const root = (entry?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let label = raw;
    if (root && raw.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(root)) {
      // Strip the vehicle prefix however it was punctuated: Chi-ha_, B17_, Sherman.
      let kept = 0;
      let index = 0;
      while (index < raw.length && kept < root.length) {
        if (/[a-z0-9]/i.test(raw[index])) kept += 1;
        index += 1;
      }
      label = raw.slice(index);
    }
    label = label.replace(/_+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || raw;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function fireMeta(group) {
    const stats = group.stats;
    const parts = [];
    if (stats.roundOfFire) parts.push(`${stats.roundOfFire} rds/s`);
    if (stats.velocity) parts.push(`${stats.velocity} m/s`);
    return parts.join(' · ');
  }

  function fireTitle(group) {
    const stats = group.stats;
    const projectile = stats.projectile && typeof stats.projectile === 'object'
      ? stats.projectile.template : stats.projectile;
    return [
      group.node.name,
      fireMeta(group),
      stats.tracer ? `tracer every ${stats.tracer.interval}` : null,
      stats.muzzles > 1 ? `${stats.muzzles} muzzles` : null,
      stats.magSize > 0 ? `mag ${stats.magSize}` : null,
      stats.recoil ? 'recoil' : null,
      projectile,
    ].filter(Boolean).join(' · ');
  }

  function startFiring(group) {
    if (!guns.setFiring(group, true)) return;
    group.ui?.button.setAttribute('aria-pressed', 'true');
    page.startAnimating();
  }

  function stopFiring(group) {
    if (!guns.setFiring(group, false)) return;
    group.ui?.button.setAttribute('aria-pressed', 'false');
    page.startAnimating();     // let flashes decay and tracers fly out
  }

  /** Hold-to-fire button for one FireArms template. `keyHint` is its shortcut. */
  function buildTrigger(group, entry, keyHint) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trigger';
    button.setAttribute('aria-pressed', 'false');
    button.title = `Hold to fire · ${fireTitle(group)}`;
    const projectile = group.stats.projectile;
    const kind = projectile && typeof projectile === 'object' ? projectile.kind : null;
    button.innerHTML = '<span class="trigger-word">FIRE</span>'
      + `<span class="trigger-name"><span>${page.attr(partLabel(group.node.name, entry))}</span>`
      + (keyHint ? `<kbd>${keyHint}</kbd>` : '')
      + '</span><span class="trigger-meta">'
      + (kind ? `<span class="trigger-kind">${page.attr(kind)}</span>` : '')
      + `<span class="trigger-stats">${page.attr(fireMeta(group))}</span><span data-count></span></span>`;
    group.ui = { button, count: button.querySelector('[data-count]') };
    button.addEventListener('pointerdown', event => {
      button.setPointerCapture(event.pointerId);
      startFiring(group);
    });
    button.addEventListener('pointerup', () => stopFiring(group));
    button.addEventListener('pointercancel', () => stopFiring(group));
    // Hold-to-fire from the keyboard too; ignore auto-repeat. Kept off the
    // window so the console's own Space binding does not fire it twice.
    button.addEventListener('keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) startFiring(group);
    });
    button.addEventListener('keyup', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      stopFiring(group);
    });
    button.addEventListener('blur', () => stopFiring(group));
    return button;
  }

  Object.assign(gunTriggers, {
    buildTrigger,
    fireGroups,
    guns,
    startFiring,
    stopFiring,
  });
  return gunTriggers;
}
