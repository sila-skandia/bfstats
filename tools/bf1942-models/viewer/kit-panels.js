// The kit inspector's read-outs for the kit on show: the weapon rack under the
// stage and the "Fields on" panel with its note. Lifted out of kits.html
// (features/vehicle-instance-refactor, Part 2d).

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
