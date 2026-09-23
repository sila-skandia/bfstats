// The model browser's variants: a model's builds (complex, wreck) and skins
// (the level whose archives dressed it), the two pickers that choose one, and
// the key a variant goes by in the page's hash. Lifted out of index.html
// (features/vehicle-instance-refactor, Part 2c).

export const configurationLabel = value => ({
  complex: 'Complex',
  wreck: 'Wreck',
})[value] || value;
export const skinValue = variant => variant.level || '';
export const skinLabel = value => value || 'Base archives';

export function variantKey(variant) {
  return `${variant.configuration || 'complex'}|${variant.level || ''}`;
}

export function normalizeVariants(entry) {
  const source = entry.variants?.length ? entry.variants : [entry];
  return source.map((variant, index) => ({
    ...variant,
    configuration: variant.configuration || 'complex',
    lod: variant.lod ?? 0,
    level: variant.level || null,
    index,
  }));
}

export function unique(values) {
  return [...new Set(values)];
}

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `attr`, `currentEntry`, `show`.
 */
export function createVariantPicker(page) {
  const variantPicker = {};

  const configurationSelect = document.getElementById('configuration');
  const skinSelect = document.getElementById('skin');

  function setOptions(select, values, selected, label) {
    select.replaceChildren(...values.map(value => new Option(label(value), String(value))));
    select.value = String(selected);
    select.disabled = values.length < 2;
  }

  function syncVariantControls(entry, selected) {
    const variants = entry.variants;
    const configurationVariants = variants.filter(
      variant => variant.configuration === selected.configuration);
    setOptions(
      configurationSelect,
      unique(variants.map(variant => variant.configuration)),
      selected.configuration,
      configurationLabel,
    );
    setOptions(
      skinSelect,
      unique(configurationVariants.map(skinValue)),
      skinValue(selected),
      skinLabel,
    );
    document.getElementById('variant-panel').hidden =
      entry.variants.length === 1;
    document.getElementById('variant-summary').innerHTML =
      `<b>${configurationLabel(selected.configuration)}</b> <span class="sep">/</span> ` +
      page.attr(skinLabel(skinValue(selected)));
  }

  function selectedFromControls() {
    if (!page.currentEntry) return null;
    const wanted = `${configurationSelect.value}|${skinSelect.value}`;
    return page.currentEntry.variants.find(variant => variantKey(variant) === wanted)
      || page.currentEntry.variants.find(
        variant => variant.configuration === configurationSelect.value)
      || page.currentEntry.variants[0];
  }

  for (const select of [configurationSelect, skinSelect]) {
    select.addEventListener('change', () => {
      const selected = selectedFromControls();
      if (selected) void page.show(page.currentEntry, selected);
    });
  }

  Object.assign(variantPicker, {
    syncVariantControls,
  });
  return variantPicker;
}
