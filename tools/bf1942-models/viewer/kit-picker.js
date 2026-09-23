// The kit inspector's ways of choosing a kit: the nation/class/soldier
// selects, the filtered "All kits" list, the URL hash that names the choice,
// and the keyboard. Lifted out of kits.html
// (features/vehicle-instance-refactor, Part 2d).

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `held`, `kit`, `kits`, `posed`, `setStance`, `showKit`, `soldier`,
 * `stance`.
 */
export function createKitPicker(page) {
  const kitPicker = {};

  const kits = page.kits;
  const kitsEl = document.getElementById('kits');

  // --- Selects and list -------------------------------------------------------

  const nationSelect = document.getElementById('nation');
  const classSelect = document.getElementById('class');
  const soldierSelect = document.getElementById('soldier');

  function fillSelect(select, values, chosen) {
    select.replaceChildren(...values.map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === chosen;
      return option;
    }));
    select.disabled = values.length < 2;
  }

  function nationKey(kit) {
    // A nation that fields two theatres is two wardrobes, and collapsing them
    // would hide the entire Afrika Korps behind the European kits.
    return kit.theatre ? `${kit.nation} (${kit.theatre})` : (kit.nation || '—');
  }

  function syncSelects(kit) {
    const nations = [...new Set(kits.map(nationKey))].sort();
    fillSelect(nationSelect, nations, nationKey(kit));
    const siblings = kits.filter(candidate => nationKey(candidate) === nationKey(kit));
    fillSelect(classSelect, [...new Set(siblings.map(candidate => candidate.class))], kit.class);
    fillSelect(soldierSelect, kit.soldiers || [], page.soldier);
  }

  nationSelect.addEventListener('change', () => {
    const next = kits.find(kit => nationKey(kit) === nationSelect.value
      && kit.class === classSelect.value)
      || kits.find(kit => nationKey(kit) === nationSelect.value);
    page.showKit(next);
  });
  classSelect.addEventListener('change', () => {
    const next = kits.find(kit => nationKey(kit) === nationSelect.value
      && kit.class === classSelect.value);
    // Keep his hands on the same slot index across a class change: switching
    // Medic to Engineer should swap the weapon, not drop back to the pistol.
    const index = (page.kit?.items || []).findIndex(item => item.template === page.held);
    if (next) page.showKit(next, { held: next.items[Math.max(index, 0)]?.template });
  });
  soldierSelect.addEventListener('change', () =>
    page.showKit(page.kit, { soldier: soldierSelect.value, held: page.held }));

  const filterInput = document.getElementById('filter');
  let visible = kits;

  function renderList() {
    const query = filterInput.value.trim().toLowerCase();
    visible = query ? kits.filter(kit => kit.haystack.includes(query)) : kits;
    const nodes = [];
    let group = null;
    for (const kit of visible) {
      if (nationKey(kit) !== group) {
        group = nationKey(kit);
        const heading = document.createElement('div');
        heading.className = 'kit-group';
        heading.textContent = group;
        nodes.push(heading);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kit';
      button.dataset.template = kit.template;
      button.setAttribute('aria-pressed', String(kit === page.kit));
      const label = document.createElement('span');
      label.textContent = kit.class;
      const maps = document.createElement('span');
      maps.className = 'maps';
      maps.textContent = `${(kit.levels || []).length}`;
      button.append(label, maps);
      button.addEventListener('click', () => page.showKit(kit));
      nodes.push(button);
    }
    kitsEl.replaceChildren(...nodes);
    document.getElementById('kit-count').textContent =
      visible.length === kits.length
        ? `${kits.length} kits · number is maps fielded`
        : `${visible.length} of ${kits.length} kits`;
  }

  function markKit(kit) {
    for (const button of kitsEl.querySelectorAll('button.kit'))
      button.setAttribute('aria-pressed', String(button.dataset.template === kit.template));
  }

  filterInput.addEventListener('input', renderList);

  // --- Hash -------------------------------------------------------------------
  // `#German/Medic/GermanSoldier|Mp40/crouch`. Nations with a space survive
  // because the whole string is decoded before it is split, and none contains a
  // slash.
  function writeHash() {
    if (!page.kit) return;
    const parts = [encodeURIComponent(page.kit.nation || '-'),
                   encodeURIComponent(page.kit.class),
                   `${page.soldier || ''}|${page.held || ''}`];
    if (page.stance !== 'stand') parts.push(page.stance);
    location.replace(`#${parts.join('/')}`);
  }

  function fromHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!raw) return null;
    const [nation, className, worn = '', stance] = raw.split('/');
    const kit = kits.find(candidate => (candidate.nation || '-') === nation
      && candidate.class === className);
    if (!kit) return null;
    const [soldier, held] = worn.split('|');
    return { kit, soldier: soldier || null, held: held || null, stance };
  }

  // --- Keys -------------------------------------------------------------------

  addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (/^[1-9]$/.test(key)) {
      const item = page.kit?.items[Number(key) - 1];
      if (item && page.posed(page.soldier, item.template)) {
        page.showKit(page.kit, { held: item.template });
        event.preventDefault();
      }
      return;
    }
    // q/w/e rather than 1/2/3: the digits already mean "weapon" here, and a
    // second meaning for them is how a console becomes unlearnable.
    const stanceKey = { q: 'stand', w: 'crouch', e: 'lie' }[key];
    if (stanceKey) { page.setStance(stanceKey); event.preventDefault(); return; }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const index = visible.indexOf(page.kit);
      const next = visible[index + (key === 'ArrowDown' ? 1 : -1)];
      if (next) { page.showKit(next); event.preventDefault(); }
    }
  });

  Object.assign(kitPicker, {
    fromHash,
    markKit,
    renderList,
    syncSelects,
    writeHash,
  });
  return kitPicker;
}
