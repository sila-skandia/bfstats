// The inspector panel's collapse button and the stage's "Controls" button
// that brings it back. The kit and grip inspectors each had the same copy;
// lifted out of kits.html and poses.html (features/vehicle-instance-refactor,
// Part 2d).

/**
 * Wires both buttons, once. `page` hands in what it reads of the rest of the
 * page, as getters:
 * `resize`.
 */
export function installControlsCollapse(page) {
  const collapseBtn = document.getElementById('controls-collapse-btn');
  const fabBtn = document.getElementById('stage-controls-fab');

  function setControlsCollapsed(collapsed) {
    document.body.classList.toggle('controls-collapsed', collapsed);
    if (collapseBtn) {
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    }
    if (fabBtn) {
      fabBtn.hidden = !collapsed;
    }
    page.resize();
  }

  collapseBtn?.addEventListener('click', () => setControlsCollapsed(true));
  fabBtn?.addEventListener('click', () => setControlsCollapsed(false));
}
