// The model browser's armoury: the faceted, searchable catalogue of every
// extracted model in its three layouts (cards, a true-scale lineup, a
// scatter plot), and the sidebar card and stage crumb naming the model on
// show. Lifted out of index.html (features/vehicle-instance-refactor,
// Part 2c).

import { configurationLabel, skinValue, unique, variantKey } from './model-variants.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `attr`, `camera`, `currentEntry`, `damageTables`, `manifest`,
 * `MODELS_BASE`, `PORTRAIT_EXTENTS`, `showVariant`.
 */
export function createArmouryBrowser(page) {
  const armoury = {};

  // --- Armoury browser -------------------------------------------------------
  //
  // One filtered set, three ways of reading it. The facet counts are computed
  // against every *other* active facet, so a count tells you what you would get by
  // ticking that box rather than what the unfiltered manifest holds — the usual
  // faceted-search contract, and the only version that stays honest once several
  // facets are on at once.

  const CATEGORY_LABELS = {
    land: 'Land vehicle',
    air: 'Aircraft',
    sea: 'Naval',
    soldier: 'Infantry',
    handweapon: 'Hand weapon',
    emplacement: 'Emplacement',
    object: 'Object',
  };

  const FACETS = [
    { id: 'mod', title: 'Mod', values: entry => [entry.mod].filter(Boolean) },
    { id: 'category', title: 'Class', values: entry => [entry.category].filter(Boolean),
      label: value => CATEGORY_LABELS[value] || value },
    { id: 'side', title: 'Side', values: entry => entry.sides || [] },
    { id: 'faction', title: 'Faction', values: entry => entry.factions || [] },
    { id: 'theatre', title: 'Theatre', values: entry => entry.theatres || [] },
    { id: 'kit', title: 'Kit', values: entry => entry.kitClasses || [] },
    { id: 'build', title: 'Build',
      values: entry => unique(entry.variants.map(variant => variant.configuration)),
      label: configurationLabel },
    { id: 'skin', title: 'Skin',
      values: entry => unique(entry.variants.map(skinValue)).map(
        value => value || 'Base archives'),
      limit: 8 },
    { id: 'map', title: 'Appears on', values: entry => entry.levels || [],
      label: value => value.replace(/_/g, ' '), limit: 8 },
    { id: 'health', title: 'Extraction',
      values: entry => [entry.texturesMissing.length ? 'Unresolved textures' : 'Fully textured']
        .concat(entry.rigged ? ['Rigged'] : []) },
  ];

  const METRICS = {
    triangles: { label: 'Triangles', of: entry => entry.triangles },
    parts: { label: 'Parts', of: entry => entry.parts },
    length: { label: 'Length (m)', of: entry => entry.dimensions?.length },
    height: { label: 'Height (m)', of: entry => entry.dimensions?.height },
    hitpoints: { label: 'Hit points', of: entry => entry.hitpoints },
    levels: { label: 'Map appearances', of: entry => entry.levels?.length },
    firepower: { label: 'Heaviest gun damage', of: entry => heaviestDamage(entry) },
    missing: { label: 'Unresolved textures', of: entry => entry.texturesMissing.length },
  };

  const browser = document.getElementById('browser');
  const facetHost = document.getElementById('facets');
  const browserBody = document.getElementById('browser-body');
  const searchInput = document.getElementById('browser-search');
  const countLabel = document.getElementById('browser-count');
  const sortSelect = document.getElementById('browser-sort');
  const currentCard = document.getElementById('current-card');
  const currentThumb = document.getElementById('current-thumb');

  const browseState = {
    layout: 'grid',
    sort: 'name',
    query: '',
    selected: new Map(FACETS.map(facet => [facet.id, new Set()])),
    expanded: new Set(),
    plotX: 'length',
    plotY: 'triangles',
  };

  /** Base damage of the biggest gun this thing carries, for the plot axis. */
  function heaviestDamage(entry) {
    if (!page.damageTables || !entry.weapons?.length) return null;
    const scores = entry.weapons
      .map(name => page.damageTables.weapons.find(
        weapon => weapon.name.toLowerCase() === name.toLowerCase()))
      .map(weapon => page.damageTables.materials?.[weapon?.material]?.damage)
      .filter(value => typeof value === 'number');
    return scores.length ? Math.max(...scores) : null;
  }

  function sideClass(entry) {
    const sides = entry.sides || [];
    if (sides.length > 1) return 'side-mixed';
    if (sides[0] === 'Allied') return 'side-allied';
    if (sides[0] === 'Axis') return 'side-axis';
    return 'side-none';
  }

  function thumbFor(entry) {
    return entry.thumb ? `${page.MODELS_BASE}/${entry.thumb}` : null;
  }

  /** Everything a free-text query should be able to hit. */
  function searchCorpus(entry) {
    return [
      entry.name, entry.mod, entry.category, CATEGORY_LABELS[entry.category],
      ...(entry.factions || []), ...(entry.sides || []),
      ...(entry.theatres || []), ...(entry.kitClasses || []),
      ...(entry.weapons || []),
      ...(entry.levels || []).map(level => level.replace(/_/g, ' ')),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  // Built once: the corpus depends only on the manifest, and search runs on every
  // keystroke against every entry.
  for (const entry of page.manifest) entry.haystack = searchCorpus(entry);

  function matchesFacet(entry, facet, chosen) {
    if (!chosen.size) return true;
    return facet.values(entry).some(value => chosen.has(value));
  }

  function matchesQuery(entry) {
    if (!browseState.query) return true;
    return browseState.query.split(/\s+/).filter(Boolean)
      .every(term => entry.haystack.includes(term));
  }

  /** Entries passing every facet except `skipId`, used for the "would yield" counts. */
  function passing(skipId) {
    return page.manifest.filter(entry => matchesQuery(entry) && FACETS.every(
      facet => facet.id === skipId
        || matchesFacet(entry, facet, browseState.selected.get(facet.id))));
  }

  function filtered() {
    return passing(null);
  }

  const SORTS = {
    name: (a, b) => a.name.localeCompare(b.name),
    triangles: (a, b) => b.triangles - a.triangles,
    parts: (a, b) => b.parts - a.parts,
    length: (a, b) => (b.dimensions?.length || 0) - (a.dimensions?.length || 0),
    hitpoints: (a, b) => (b.hitpoints || 0) - (a.hitpoints || 0),
    levels: (a, b) => (b.levels?.length || 0) - (a.levels?.length || 0),
    variants: (a, b) => b.variants.length - a.variants.length,
    missing: (a, b) => b.texturesMissing.length - a.texturesMissing.length,
  };

  function sorted(entries) {
    const compare = SORTS[browseState.sort] || SORTS.name;
    // Name is the stable tiebreak, so equal metrics never reorder between renders.
    return [...entries].sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
  }

  function renderFacets() {
    const anySelected = FACETS.some(facet => browseState.selected.get(facet.id).size);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = 'facet-reset';
    reset.textContent = anySelected ? 'Clear filters' : 'No filters';
    reset.disabled = !anySelected;
    reset.addEventListener('click', () => {
      for (const chosen of browseState.selected.values()) chosen.clear();
      renderBrowser();
    });

    const sections = FACETS.map(facet => {
      const chosen = browseState.selected.get(facet.id);
      const pool = passing(facet.id);
      const counts = new Map();
      for (const entry of page.manifest) {
        for (const value of facet.values(entry)) {
          if (!counts.has(value)) counts.set(value, 0);
        }
      }
      for (const entry of pool) {
        for (const value of facet.values(entry)) {
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
      if (counts.size < 2 && !chosen.size) return null;

      const section = document.createElement('div');
      section.className = 'facet';
      const heading = document.createElement('h3');
      heading.textContent = facet.title;
      section.appendChild(heading);

      // Most-populated first, so the useful cuts are above any "show all" fold.
      const values = [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
      const limit = facet.limit && !browseState.expanded.has(facet.id)
        ? facet.limit : values.length;

      for (const [value, count] of values.slice(0, limit)) {
        const label = document.createElement('label');
        label.classList.toggle('is-empty', count === 0 && !chosen.has(value));
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = chosen.has(value);
        box.addEventListener('change', () => {
          if (box.checked) chosen.add(value); else chosen.delete(value);
          renderBrowser();
        });
        const name = document.createElement('span');
        name.className = 'facet-name';
        name.textContent = facet.label ? facet.label(value) : value;
        name.title = name.textContent;
        const tally = document.createElement('span');
        tally.className = 'facet-count';
        tally.textContent = String(count);
        label.append(box, name, tally);
        section.appendChild(label);
      }

      if (values.length > limit) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'facet-more';
        more.textContent = `+${values.length - limit} more`;
        more.addEventListener('click', () => {
          browseState.expanded.add(facet.id);
          renderBrowser();
        });
        section.appendChild(more);
      }
      return section;
    }).filter(Boolean);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'facet-done-btn';
    doneBtn.textContent = 'Done with filters';
    doneBtn.addEventListener('click', () => {
      browser.classList.remove('facets-open');
      document.getElementById('browser-filter-toggle')?.setAttribute('aria-expanded', 'false');
    });

    facetHost.replaceChildren(reset, ...sections, doneBtn);
    updateFilterBadge();
  }

  function variantNote(entry) {
    const builds = unique(entry.variants.map(variant => variant.configuration)).length;
    const skins = unique(entry.variants.map(skinValue)).length;
    return [
      builds > 1 ? `${builds} builds` : null,
      skins > 1 ? `${skins} skins` : null,
    ].filter(Boolean).join(' · ');
  }

  function renderGrid(entries) {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const entry of entries) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `card ${sideClass(entry)}`;
      card.dataset.modelIndex = String(entry.index);
      if (page.currentEntry && page.currentEntry.index === entry.index) {
        card.setAttribute('aria-current', 'true');
      }

      const art = document.createElement('div');
      art.className = 'card-art';
      const source = thumbFor(entry);
      if (source) {
        const image = document.createElement('img');
        image.src = source;
        image.alt = '';
        image.loading = 'lazy';
        art.appendChild(image);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'no-art';
        placeholder.textContent = 'no thumbnail';
        art.appendChild(placeholder);
      }

      const flags = document.createElement('div');
      flags.className = 'card-flags';
      const note = variantNote(entry);
      if (note) {
        const badge = document.createElement('span');
        badge.className = 'card-flag';
        badge.textContent = note;
        flags.appendChild(badge);
      }
      if (entry.texturesMissing.length) {
        const badge = document.createElement('span');
        badge.className = 'card-flag is-warn';
        badge.textContent = `${entry.texturesMissing.length} unresolved`;
        badge.title = entry.texturesMissing.join('\n');
        flags.appendChild(badge);
      }
      art.appendChild(flags);

      const body = document.createElement('div');
      body.className = 'card-body';
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = entry.name;
      const sub = document.createElement('div');
      sub.className = 'card-sub';
      const side = document.createElement('span');
      side.className = 'is-side';
      const factions = entry.factions || [];
      // Engineer kit is carried by every army in the game; naming all seven reads
      // as noise, so the count stands in and the full list is in the tooltip.
      side.textContent = factions.length > 2 ? `${factions.length} nations`
        : factions.join(', ')
        || CATEGORY_LABELS[entry.category] || entry.category || '';
      side.title = factions.join(', ');
      const size = document.createElement('span');
      size.textContent = entry.dimensions
        ? `${entry.dimensions.length.toFixed(1)} m`
        : `${entry.triangles.toLocaleString()} tris`;
      sub.append(side, size);
      body.append(name, sub);

      card.append(art, body);
      card.addEventListener('click', () => pick(entry));
      grid.appendChild(card);
    }
    return grid;
  }

  function renderScale(entries) {
    const wrap = document.createElement('div');
    const measured = entries.filter(entry => entry.dimensions?.maxExtent > 0);
    const note = document.createElement('div');
    note.className = 'scale-note';
    wrap.appendChild(note);
    if (!measured.length) {
      note.textContent = 'Nothing in this selection has been measured.';
      return wrap;
    }

    // Every thumbnail is shot at the same camera distance in extents, so a
    // thumbnail drawn at a width proportional to that extent puts the whole lineup
    // on one true scale — no per-model fudging.
    const ordered = [...measured].sort(
      (a, b) => b.dimensions.maxExtent - a.dimensions.maxExtent);
    const biggest = ordered[0];
    // How many metres wide the shot frame is: the camera sits PORTRAIT_EXTENTS
    // extents back, with the scene camera's vertical field of view.
    const frameMetres = extent =>
      2 * extent * page.PORTRAIT_EXTENTS * Math.tan(page.camera.fov * Math.PI / 360);
    const across = frameMetres(biggest.dimensions.maxExtent);
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50].find(
      candidate => across / candidate <= 10) || 100;

    // Pixels rather than percentages: the widest row is square and a full-width
    // one would be a thousand pixels tall.
    const MAX = 300;
    // Fraction of each square frame the lineup shows. Tall subjects — a standing
    // soldier is the worst case — still have to fit inside it.
    const CROP = 0.68;
    const rule = document.createElement('div');
    rule.className = 'scale-rule';
    rule.style.marginLeft = '144px';
    rule.style.width = `${MAX}px`;
    for (let metres = 0; metres <= across; metres += step) {
      const tick = document.createElement('span');
      tick.style.left = `${((metres / across) * MAX).toFixed(1)}px`;
      tick.textContent = `${Math.round(metres * 100) / 100}m`;
      rule.appendChild(tick);
    }
    wrap.appendChild(rule);

    // Across every category the radii span roughly 150x, so the smallest would
    // render sub-pixel. Those get a floor and are flagged rather than quietly
    // drawn at a scale they are not on.
    const FLOOR = 6;
    let clamped = 0;

    for (const entry of ordered) {
      const row = document.createElement('div');
      row.className = `scale-row ${sideClass(entry)}`;

      const label = document.createElement('div');
      label.className = 'scale-label';
      const name = document.createElement('div');
      name.className = 'scale-name';
      name.textContent = entry.name;
      const dim = document.createElement('div');
      dim.className = 'scale-dim';
      dim.textContent = `${entry.dimensions.length.toFixed(2)} × `
        + `${entry.dimensions.width.toFixed(2)} × ${entry.dimensions.height.toFixed(2)} m`;
      label.append(name, dim);

      const share = entry.dimensions.maxExtent / biggest.dimensions.maxExtent;
      const isClamped = share * MAX < FLOOR;
      if (isClamped) clamped++;

      const lane = document.createElement('div');
      lane.className = 'scale-lane';
      const figure = document.createElement('button');
      figure.type = 'button';
      figure.className = `scale-figure${isClamped ? ' is-clamped' : ''}`;
      const side = Math.max(FLOOR, share * MAX);
      figure.style.width = `${side.toFixed(1)}px`;
      figure.style.height = `${(side * CROP).toFixed(1)}px`;
      figure.title = isClamped
        ? `${entry.name} — ${entry.dimensions.length.toFixed(2)} m long (drawn larger than scale)`
        : `${entry.name} — ${entry.dimensions.length.toFixed(2)} m long`;
      const source = thumbFor(entry);
      if (source) {
        const image = document.createElement('img');
        image.src = source;
        image.alt = '';
        image.loading = 'lazy';
        // Full square, pulled up by half the cropped-off height, so the window
        // sits over the middle of the frame where the model is.
        image.style.width = `${side.toFixed(1)}px`;
        image.style.height = `${side.toFixed(1)}px`;
        image.style.marginTop = `${(-side * (1 - CROP) / 2).toFixed(1)}px`;
        figure.appendChild(image);
      } else {
        const box = document.createElement('div');
        box.className = 'scale-box';
        figure.appendChild(box);
      }
      figure.addEventListener('click', () => pick(entry));
      lane.appendChild(figure);

      row.append(label, lane);
      wrap.appendChild(row);
    }

    note.textContent = `True scale against ${biggest.name}. `
      + (clamped
        ? `${clamped} too small to draw at scale are floored and outlined — filter to one class to compare them properly.`
        : 'Every model here is drawn at scale.');
    return wrap;
  }

  function renderPlot(entries) {
    const wrap = document.createElement('div');

    const controls = document.createElement('div');
    controls.className = 'plot-controls';
    for (const [axis, stateKey] of [['X', 'plotX'], ['Y', 'plotY']]) {
      const label = document.createElement('label');
      label.textContent = axis;
      const select = document.createElement('select');
      for (const [key, metric] of Object.entries(METRICS)) {
        select.appendChild(new Option(metric.label, key));
      }
      select.value = browseState[stateKey];
      select.addEventListener('change', () => {
        browseState[stateKey] = select.value;
        renderBrowser();
      });
      label.appendChild(select);
      controls.appendChild(label);
    }
    wrap.appendChild(controls);

    const xMetric = METRICS[browseState.plotX];
    const yMetric = METRICS[browseState.plotY];
    const points = [];
    const unplotted = [];
    for (const entry of entries) {
      const x = xMetric.of(entry);
      const y = yMetric.of(entry);
      if (typeof x === 'number' && typeof y === 'number') points.push({ entry, x, y });
      else unplotted.push(entry);
    }

    if (!points.length) {
      const empty = document.createElement('div');
      empty.className = 'browser-empty';
      empty.textContent = `Nothing in this selection has both ${xMetric.label} and ${yMetric.label}.`;
      wrap.appendChild(empty);
      return wrap;
    }

    const width = 900, height = 520;
    const pad = { left: 74, right: 28, top: 20, bottom: 52 };
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    // A zero floor keeps the axes readable as magnitudes rather than as a zoom
    // into whatever narrow band the current filter happens to span.
    const xMax = Math.max(...xs, 0) || 1;
    const yMax = Math.max(...ys, 0) || 1;
    const xAt = value => pad.left + (value / xMax) * (width - pad.left - pad.right);
    const yAt = value => height - pad.bottom - (value / yMax) * (height - pad.top - pad.bottom);

    const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${xMetric.label} against ${yMetric.label}">`];
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const y = yAt(yMax * i / ticks);
      parts.push(`<line class="tick-line" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"/>`);
      parts.push(`<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${formatMetric(yMax * i / ticks)}</text>`);
      const x = xAt(xMax * i / ticks);
      parts.push(`<text x="${x}" y="${height - pad.bottom + 16}" text-anchor="middle">${formatMetric(xMax * i / ticks)}</text>`);
    }
    parts.push(`<line class="axis-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"/>`);
    parts.push(`<line class="axis-line" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"/>`);
    parts.push(`<text class="axis-title" x="${width - pad.right}" y="${height - 14}" text-anchor="end">${xMetric.label}</text>`);
    parts.push(`<text class="axis-title" x="${pad.left}" y="${pad.top - 6}" text-anchor="start">${yMetric.label}</text>`);

    const triangleRange = Math.max(...entries.map(entry => entry.triangles), 1);
    const placed = [];
    // Biggest first, so when a cluster can only take one label it is the dot most
    // worth naming. The rest keep their hover title.
    const drawOrder = [...points].sort(
      (a, b) => b.entry.triangles - a.entry.triangles);
    for (const point of drawOrder) {
      const radius = 5 + 11 * Math.sqrt(point.entry.triangles / triangleRange);
      const cx = xAt(point.x), cy = yAt(point.y);
      // 9px monospace: a hair over 5px a character.
      const half = point.entry.name.length * 2.7;
      const top = cy - radius - 14;
      const label = { x1: cx - half, x2: cx + half, y1: top, y2: top + 12 };
      const clear = placed.every(other => label.x2 < other.x1 || label.x1 > other.x2
        || label.y2 < other.y1 || label.y1 > other.y2);
      if (clear) placed.push(label);
      parts.push(
        `<g class="plot-dot ${sideClass(point.entry)}" tabindex="0" role="button" `
        + `data-model-index="${point.entry.index}" `
        + `aria-label="${page.attr(point.entry.name)}">`
        + `<title>${page.attr(point.entry.name)} — ${xMetric.label} ${formatMetric(point.x)}, `
        + `${yMetric.label} ${formatMetric(point.y)}</title>`
        + `<circle cx="${cx}" cy="${cy}" r="${radius.toFixed(1)}"/>`
        + `<text class="${clear ? '' : 'is-crowded'}" x="${cx}" `
        + `y="${(cy - radius - 5).toFixed(1)}" text-anchor="middle">${page.attr(point.entry.name)}</text>`
        + '</g>');
    }
    parts.push('</svg>');

    const plot = document.createElement('div');
    plot.className = 'plot-wrap';
    plot.innerHTML = parts.join('');
    for (const dot of plot.querySelectorAll('.plot-dot')) {
      const entry = page.manifest[Number(dot.dataset.modelIndex)];
      dot.addEventListener('click', () => pick(entry));
      dot.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          pick(entry);
        }
      });
    }
    wrap.appendChild(plot);

    if (unplotted.length) {
      const note = document.createElement('div');
      note.className = 'plot-unplotted';
      note.textContent = `${unplotted.length} not plotted (no `
        + `${[!unplotted.every(e => typeof xMetric.of(e) === 'number') ? xMetric.label : null,
             !unplotted.every(e => typeof yMetric.of(e) === 'number') ? yMetric.label : null]
            .filter(Boolean).join(' or ')}): `
        + unplotted.map(entry => entry.name).join(', ');
      wrap.appendChild(note);
    }
    return wrap;
  }

  function formatMetric(value) {
    if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
    if (value >= 10) return String(Math.round(value));
    return String(Math.round(value * 10) / 10);
  }

  function renderBrowser() {
    renderFacets();
    const entries = sorted(filtered());
    countLabel.textContent = entries.length === page.manifest.length
      ? `${page.manifest.length} models`
      : `${entries.length} of ${page.manifest.length}`;

    for (const button of document.querySelectorAll('#layout-switch button')) {
      button.setAttribute('aria-pressed', String(button.dataset.layout === browseState.layout));
    }

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'browser-empty';
      empty.textContent = 'Nothing matches those filters.';
      browserBody.replaceChildren(empty);
      return;
    }
    const view = browseState.layout === 'scale' ? renderScale(entries)
      : browseState.layout === 'plot' ? renderPlot(entries)
      : renderGrid(entries);
    browserBody.replaceChildren(view);
  }

  function pick(entry) {
    closeBrowser();
    void page.showVariant(entry.index);
  }

  function openBrowser() {
    browser.hidden = false;
    renderBrowser();
    searchInput.focus();
    searchInput.select();
  }

  function updateFilterBadge() {
    let count = 0;
    for (const set of browseState.selected.values()) {
      count += set.size;
    }
    const badge = document.getElementById('filter-count-badge');
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
  }

  function closeBrowser() {
    browser.hidden = true;
    browser.classList.remove('facets-open');
    document.getElementById('browser-filter-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('browse-open').focus();
  }

  /** "Axis · Japanese" — the sides, then the armies that field it. */
  function sideLine(entry) {
    const factions = entry?.factions || [];
    return [
      (entry?.sides || []).join(' / '),
      factions.length > 2 ? `${factions.length} nations` : factions.join(', '),
    ].filter(Boolean).join(' · ');
  }

  /** `Sherman / complex | Kasserine Pass`, top-left of the stage. */
  function renderCrumb(entry, variant) {
    const crumb = document.getElementById('crumb');
    const parts = [
      `<b>${page.attr(entry.name)}</b>`,
      '<span class="sep">/</span>',
      `<span>${page.attr(configurationLabel(variant.configuration))}</span>`,
    ];
    if (variant.level) {
      parts.push('<span class="sep">|</span>', `<span>${page.attr(variant.level.replace(/_/g, ' '))}</span>`);
    }
    crumb.innerHTML = parts.join('');
    crumb.hidden = false;
  }

  /** Sidebar summary of whatever is loaded, so the browser can stay closed. */
  function markCurrent(entry, variant) {
    currentCard.className = sideClass(entry);
    document.getElementById('current-name').textContent = entry.name;
    const source = thumbFor(entry);
    currentThumb.hidden = !source;
    if (source) currentThumb.src = source;
    document.getElementById('current-meta').textContent = [
      CATEGORY_LABELS[entry.category] || entry.category,
      entry.dimensions ? `${entry.dimensions.length.toFixed(2)} m` : null,
      `${entry.triangles.toLocaleString()} tris`,
    ].filter(Boolean).join(' · ');
    document.getElementById('current-side').textContent = sideLine(entry);
    if (!browser.hidden) renderBrowser();
    location.replace(`#${encodeURIComponent(entry.name)}/${variantKey(variant)}`);
  }

  document.getElementById('browse-open').addEventListener('click', openBrowser);
  document.getElementById('shell-search').addEventListener('click', openBrowser);
  document.getElementById('browse-close').addEventListener('click', closeBrowser);

  const filterToggle = document.getElementById('browser-filter-toggle');
  filterToggle?.addEventListener('click', () => {
    const isOpen = browser.classList.toggle('facets-open');
    filterToggle.setAttribute('aria-expanded', String(isOpen));
  });
  searchInput.addEventListener('input', () => {
    browseState.query = searchInput.value.trim().toLowerCase();
    renderBrowser();
  });
  sortSelect.addEventListener('change', () => {
    browseState.sort = sortSelect.value;
    renderBrowser();
  });
  for (const button of document.querySelectorAll('#layout-switch button')) {
    button.addEventListener('click', () => {
      browseState.layout = button.dataset.layout;
      renderBrowser();
    });
  }
  addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === 'Escape' && !browser.hidden) {
      event.preventDefault();
      closeBrowser();
    } else if (!typing && (event.key === '/' || (event.key === 'k' && (event.metaKey || event.ctrlKey)))) {
      event.preventDefault();
      if (browser.hidden) openBrowser(); else searchInput.focus();
    } else if (event.key === 'Enter' && event.target === searchInput) {
      event.preventDefault();
      const first = sorted(filtered())[0];
      if (first) pick(first);
    }
  });

  Object.assign(armoury, {
    browser,
    markCurrent,
    openBrowser,
    renderCrumb,
  });
  return armoury;
}
