// The kit inspector's read-outs for the kit on show: the weapon rack under the
// stage and the "Fields on" panel with its note. Lifted out of kits.html
// (features/vehicle-instance-refactor, Part 2d).

/**
 * One line per level variant of `kit` (`kits.json` `levelVariants`): the
 * levels that run their own copy of the kit, and what that copy changes. A
 * level's declaration of a template beats the mod's (ledger LOAD-1, LOAD-2),
 * so on those levels this is the kit a soldier gets.
 */
export function variantNotes(kit) {
  const base = (kit?.items || []).map(item => item.template);
  return (kit?.levelVariants || []).map(variant => {
    const changes = [];
    if (variant.items) {
      const own = variant.items.map(item => item.template);
      const lower = names => names.map(name => String(name).toLowerCase());
      const added = own.filter(name => !lower(base).includes(String(name).toLowerCase()));
      const dropped = base.filter(name => !lower(own).includes(String(name).toLowerCase()));
      if (added.length) changes.push(`+ ${added.join(', ')}`);
      if (dropped.length) changes.push(`without ${dropped.join(', ')}`);
      if (!added.length && !dropped.length) changes.push('its items in another order');
    }
    if (variant.primary) changes.push(`spawns holding ${variant.primary}`);
    if (variant.worn) {
      changes.push(`wears ${variant.worn.map(part => part.template).join(', ') || 'nothing'}`);
    }
    if (variant.pickup) changes.push(`lies on the ground as ${variant.pickup.geometry}`);
    if (variant.overrideAirMovementInhibitations === true) changes.push('no parachute (nochute)');
    if (variant.overrideAirMovementInhibitations === false) changes.push('a parachute');
    const levels = (variant.levels || []).map(level => level.replace(/_/g, ' ')).join(' · ');
    return `${levels}: the level's own ${kit.template}${changes.length ? `, ${changes.join('; ')}` : ''}.`;
  });
}

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `held`, `posed`, `showKit`, `soldier`.
 */
export function createKitPanels(page) {
  const kitPanels = {};

  const rackEl = document.getElementById('rack');

  function renderRack(kit) {
    const slots = (kit.items || []).map((item, index) => {
      const wearable = page.posed(page.soldier, item.template);
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'slot';
      slot.disabled = !wearable;
      slot.setAttribute('aria-pressed', String(item.template === page.held));
      slot.title = wearable ? `put ${item.template} in his hands`
        : item.entry ? `${item.template} has no pose clip for ${page.soldier}`
        : `${item.template} was not extracted`;

      const thumb = item.entry?.thumb;
      const art = document.createElement(thumb ? 'img' : 'div');
      art.className = thumb ? 'slot-art' : 'slot-art is-absent';
      if (thumb) { art.src = `${item.entry.base}/${thumb}`; art.alt = ''; art.loading = 'lazy'; }

      const name = document.createElement('div');
      name.className = 'slot-name';
      if (index < 9) {
        const kbd = document.createElement('kbd');
        kbd.textContent = String(index + 1);
        name.append(kbd);
      }
      const label = document.createElement('span');
      label.textContent = item.template;
      name.append(label);

      const meta = document.createElement('div');
      meta.className = 'slot-meta';
      meta.textContent = !item.entry ? 'not extracted'
        : !wearable ? 'no pose clip'
        : item.entry.dimensions ? `${item.entry.dimensions.maxExtent.toFixed(2)} m`
        : `${item.entry.triangles.toLocaleString()} tris`;

      slot.append(art, name, meta);
      slot.addEventListener('click', () => page.showKit(kit, { held: item.template }));
      return slot;
    });
    rackEl.replaceChildren(...slots);
  }

  function renderMaps(kit) {
    const levels = kit.levels || [];
    document.getElementById('map-count').textContent = String(levels.length);
    document.getElementById('maps').textContent =
      levels.map(level => level.replace(/_/g, ' ')).join(' · ');
    const variants = document.getElementById('variants');
    if (variants) {
      const notes = variantNotes(kit);
      variants.hidden = !notes.length;
      variants.textContent = notes.join(' ');
    }

    const missing = (kit.worn || []).filter(part => !part.glb);
    const note = document.getElementById('note');
    if (!(kit.worn || []).length) {
      note.hidden = false;
      note.textContent = 'This kit declares no worn parts at all — it is bare by design, '
        + 'not by a failed extraction.';
    } else if (missing.length) {
      note.hidden = false;
      note.textContent = `${missing.length} worn part(s) did not extract: `
        + `${missing.map(part => part.template).join(', ')}. The figure is missing them.`;
    } else {
      note.hidden = true;
    }
  }

  Object.assign(kitPanels, {
    renderMaps,
    renderRack,
  });
  return kitPanels;
}
