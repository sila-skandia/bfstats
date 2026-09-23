// The grip inspector's pair picker: the soldier and weapon selects and their
// steppers, the "All pairs" list with its filter and worst-weld sort, the weld
// read-out for the pair on show, and the keyboard. Lifted out of poses.html
// (features/vehicle-instance-refactor, Part 2d).

/**
 * Built once by the page, once the pose manifest has loaded. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `loadPair`, `manifest`, `setMotion`, `setStance`, `stance`, `statusLine`.
 */
export function createPosePairs(page) {
  const posePairs = {};

  const pairs = page.manifest.pairs.filter(pair => !pair.error);

  // Group available weapons per soldier so only existing pairs can be selected
  const weaponsBySoldier = new Map();
  for (const pair of pairs) {
    let list = weaponsBySoldier.get(pair.soldier);
    if (!list) {
      list = [];
      weaponsBySoldier.set(pair.soldier, list);
    }
    list.push(pair.weapon);
  }
  for (const list of weaponsBySoldier.values()) list.sort((a, b) => a.localeCompare(b));

  const soldiersWithPairs = [...weaponsBySoldier.keys()].sort((a, b) => a.localeCompare(b));
  const soldiers = soldiersWithPairs.length > 0 ? soldiersWithPairs : (page.manifest.soldiers || []);
  const byKey = new Map(pairs.map(pair => [`${pair.soldier}|${pair.weapon}`, pair]));

  const soldierSelect = document.getElementById('soldier');
  const weaponSelect = document.getElementById('weapon');
  for (const soldier of soldiers)
    soldierSelect.add(new Option(soldier, soldier));

  function updateWeaponOptions(preferredWeapon = null) {
    const available = weaponsBySoldier.get(soldierSelect.value) || [];
    weaponSelect.replaceChildren(...available.map(w => new Option(w, w)));
    if (preferredWeapon && available.includes(preferredWeapon)) {
      weaponSelect.value = preferredWeapon;
    } else if (available.length > 0) {
      weaponSelect.selectedIndex = 0;
    }
    const disabled = available.length <= 1;
    document.getElementById('prev-weapon').disabled = disabled;
    document.getElementById('next-weapon').disabled = disabled;
  }

  const palmClass = metres =>
    metres == null ? 'muted' : metres <= 0.06 ? '' : metres <= 0.12 ? 'warn' : 'bad';
  const centimetres = metres =>
    metres == null ? '—' : `${(metres * 100).toFixed(1)} cm`;

  function currentPair() {
    return byKey.get(`${soldierSelect.value}|${weaponSelect.value}`) ?? null;
  }

  function showMetrics(pair) {
    const palmR = document.getElementById('palm-r');
    const palmL = document.getElementById('palm-l');
    const naive = document.getElementById('palm-naive');
    // Per-stance metrics when the matrix carries them (stance-aware
    // extracts); the old single-stance shape falls through untouched.
    const stanceInfo = pair?.stances?.[page.stance];
    const metrics = stanceInfo?.metrics ?? pair?.metrics ?? {};
    palmR.textContent = centimetres(metrics.palmR);
    palmR.className = palmClass(metrics.palmR);
    palmL.textContent = centimetres(metrics.palmL);
    palmL.className = 'muted';
    naive.textContent = centimetres(metrics.palmRNaive);
    naive.className = 'muted';
    document.getElementById('clip').textContent = [
      stanceInfo?.upperClip ?? pair?.upperClip,
      stanceInfo?.lowerClip,
    ].filter(Boolean).join('\n');
    const note = document.getElementById('note');
    const warnings = [];
    if (stanceInfo?.error) warnings.push(stanceInfo.error);
    if (pair?.weaponSkeleton) warnings.push(`weapon skeleton ${pair.weaponSkeleton}`);
    if (pair?.texturesMissing?.length)
      warnings.push(`missing textures: ${pair.texturesMissing.join(', ')}`);
    note.hidden = !warnings.length;
    note.textContent = warnings.join(' · ');
  }

  const pairList = document.getElementById('pairs');
  const pairCount = document.getElementById('pair-count');
  const filterInput = document.getElementById('filter');
  const sortWorst = document.getElementById('sort-worst');

  function renderPairList() {
    const query = filterInput.value.trim().toLowerCase();
    let entries = pairs.filter(pair =>
      `${pair.soldier} ${pair.weapon}`.toLowerCase().includes(query));
    if (sortWorst.checked)
      entries = entries.toSorted((a, b) =>
        (b.metrics?.palmR ?? 0) - (a.metrics?.palmR ?? 0));
    pairList.replaceChildren(...entries.map(pair => {
      const button = document.createElement('button');
      button.type = 'button';
      if (pair.soldier === soldierSelect.value && pair.weapon === weaponSelect.value)
        button.classList.add('current');
      const label = document.createElement('span');
      label.textContent = `${pair.soldier} + ${pair.weapon}`;
      const palm = document.createElement('span');
      palm.className = `palm ${palmClass(pair.metrics?.palmR)}`.trim();
      palm.textContent = centimetres(pair.metrics?.palmR);
      button.append(label, palm);
      button.addEventListener('click', () => {
        soldierSelect.value = pair.soldier;
        updateWeaponOptions(pair.weapon);
        selectionChanged();
      });
      return button;
    }));
    pairCount.textContent = entries.length === pairs.length
      ? `${pairs.length} pairs`
      : `${entries.length} of ${pairs.length}`;
  }

  function selectionChanged() {
    const pair = currentPair();
    showMetrics(pair);
    renderPairList();
    if (pair) page.loadPair(pair);
    else page.statusLine.textContent =
      `${soldierSelect.value} + ${weaponSelect.value}: no pose extracted`;
  }

  function step(select, delta) {
    const options = [...select.options];
    if (!options.length) return;
    const index = (select.selectedIndex + delta + options.length) % options.length;
    select.selectedIndex = index;
    if (select === soldierSelect) {
      updateWeaponOptions(weaponSelect.value);
    }
    selectionChanged();
  }

  soldierSelect.addEventListener('change', () => {
    updateWeaponOptions(weaponSelect.value);
    selectionChanged();
  });
  weaponSelect.addEventListener('change', selectionChanged);
  document.getElementById('prev-weapon').addEventListener('click', () => step(weaponSelect, -1));
  document.getElementById('next-weapon').addEventListener('click', () => step(weaponSelect, 1));
  filterInput.addEventListener('input', renderPairList);
  sortWorst.addEventListener('change', renderPairList);

  addEventListener('keydown', event => {
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'ArrowLeft') { step(weaponSelect, -1); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { step(weaponSelect, 1); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { step(soldierSelect, -1); event.preventDefault(); }
    else if (event.key === 'ArrowDown') { step(soldierSelect, 1); event.preventDefault(); }
    else if (event.key === '1') page.setStance('stand');
    else if (event.key === '2') page.setStance('crouch');
    else if (event.key === '3') page.setStance('lie');
    else if (event.key === 'q' || event.key === 'Q') page.setMotion('idle');
    else if (event.key === 'w' || event.key === 'W') page.setMotion('walk');
    else if (event.key === 'e' || event.key === 'E') page.setMotion('run');
  });

  /** The soldier and weapon a URL asks for, before the first selection. */
  function preselect(params) {
    if (soldiers.includes(params.get('soldier'))) soldierSelect.value = params.get('soldier');
    updateWeaponOptions(params.get('weapon'));
  }

  /** Show this pair, as a click in the list would. */
  function select(soldier, weapon) {
    soldierSelect.value = soldier;
    updateWeaponOptions(weapon);
    selectionChanged();
  }

  Object.assign(posePairs, {
    currentPair,
    preselect,
    select,
    selectionChanged,
    showMetrics,
  });
  return posePairs;
}
