// The model inspector's tab strip: Hit regions, Display, Model
// (features/mesh-viewer-advanced-tab). A plain ARIA tablist: click or the
// arrow keys pick a tab, the choice is remembered in this browser, and
// `?tab=display` links straight to one.

import { WORKBENCH_TABS, tabOf } from './model-display-state.js';

const STORE_KEY = 'mesh.inspector.tab';

function stored() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function store(tab) {
  try { localStorage.setItem(STORE_KEY, tab); } catch { /* private window */ }
}

/** Wires the strip once; returns `select(tab)` and `current()`. */
export function installWorkbenchTabs() {
  const strip = document.getElementById('wb-tabs');
  const tabs = WORKBENCH_TABS.map(name => document.getElementById(`wb-tab-${name}`));
  let now = null;

  function select(name, { focus = false, remember = true } = {}) {
    now = tabOf(name);
    for (const tab of tabs) {
      const on = tab.dataset.tab === now;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) tab.focus();
    }
    strip.closest('.workbench').dataset.tab = now;
    if (remember) store(now);
  }

  strip.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab.dataset.tab);
  });
  strip.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = WORKBENCH_TABS.indexOf(now);
    const next = Number.isFinite(step)
      ? (at + step + WORKBENCH_TABS.length) % WORKBENCH_TABS.length
      : step < 0 ? 0 : WORKBENCH_TABS.length - 1;
    select(WORKBENCH_TABS[next], { focus: true });
  });

  const linked = new URLSearchParams(location.search).get('tab');
  select(linked || stored(), { remember: Boolean(linked) });
  return { select, current: () => now };
}
