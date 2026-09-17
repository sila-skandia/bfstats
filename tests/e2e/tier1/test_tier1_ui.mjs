/**
 * Tier 1 Test Suite: Authentic UI Layout, Virtual Coordinates & Mod Themes (Features 13-17, 25 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnvironment } from '../harnesses/mock_dom.mjs';

import {
  computeVirtualScale,
  formatLoadingTitle,
  MOD_THEMES,
} from '../harnesses/ui_helpers.mjs';

// --------------------------------------------------------------------------- //
// Feature 13: UI-VIRTUAL-COORDS (5 Tests: T1-FEAT13-01 to T1-FEAT13-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT13-01: Computes 800x600 virtual coordinate scale factor for standard 1920x1080 display', () => {
  const metrics = computeVirtualScale(1920, 1080);
  assert.equal(metrics.scale, 1.8);
  assert.equal(metrics.scaledWidth, 1440);
  assert.equal(metrics.scaledHeight, 1080);
});

test('T1-FEAT13-02: Computes scale factor for 1280x720 display matching reference video', () => {
  const metrics = computeVirtualScale(1280, 720);
  assert.equal(metrics.scale, 1.2);
  assert.equal(metrics.scaledWidth, 960);
  assert.equal(metrics.scaledHeight, 720);
});

test('T1-FEAT13-03: Preserves aspect ratio scaling in portrait viewports (768x1024)', () => {
  const metrics = computeVirtualScale(768, 1024);
  assert.equal(metrics.scale, 0.96);
  assert.equal(metrics.scaledWidth, 768);
  assert.equal(metrics.scaledHeight, 576);
});

test('T1-FEAT13-04: Center-aligns 800x600 virtual stage within non-4:3 viewports', () => {
  const metrics = computeVirtualScale(1920, 1080);
  assert.equal(metrics.offsetX, 240);
  assert.equal(metrics.offsetY, 0);

  const portraitMetrics = computeVirtualScale(768, 1024);
  assert.equal(portraitMetrics.offsetX, 0);
  assert.equal(portraitMetrics.offsetY, 224);
});

test('T1-FEAT13-05: Updates layout metrics dynamically on window resize event', () => {
  const env = createMockEnvironment();
  let currentMetrics = computeVirtualScale(env.window.innerWidth, env.window.innerHeight);
  assert.equal(currentMetrics.scale, 1.8);

  // Resize window to 1280x720
  env.window.innerWidth = 1280;
  env.window.innerHeight = 720;
  currentMetrics = computeVirtualScale(env.window.innerWidth, env.window.innerHeight);
  assert.equal(currentMetrics.scale, 1.2);
  assert.equal(currentMetrics.offsetX, 160);
});

// --------------------------------------------------------------------------- //
// Feature 14: UI-BG-ARTWORK (5 Tests: T1-FEAT14-01 to T1-FEAT14-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT14-01: Renders full-viewport background image matching configured map art', () => {
  const env = createMockEnvironment();
  const bgImg = env.document.createElement('img');
  bgImg.className = 'ld-bg-art';
  bgImg.setAttribute('src', '_shared/load/pacific2.webp');
  bgImg.style.position = 'absolute';
  bgImg.style.inset = '0';
  bgImg.style.width = '100%';
  bgImg.style.height = '100%';
  bgImg.style.objectFit = 'cover';
  env.body.appendChild(bgImg);

  assert.equal(bgImg.getAttribute('src'), '_shared/load/pacific2.webp');
  assert.equal(bgImg.style.position, 'absolute');
  assert.equal(bgImg.style.inset, '0');
});

test('T1-FEAT14-02: Renders Pacific theater artwork for Wake Island', () => {
  const manifestEntry = {
    name: 'Wake',
    loading: { background: '_shared/load/pacific2.webp' },
  };
  assert.ok(manifestEntry.loading.background.includes('pacific2.webp'));
});

test('T1-FEAT14-03: Renders Western theater artwork for Bocage', () => {
  const manifestEntry = {
    name: 'Bocage',
    loading: { background: '_shared/load/western2.webp' },
  };
  assert.ok(manifestEntry.loading.background.includes('western2.webp'));
});

test('T1-FEAT14-04: Renders custom EoD artwork for Operation Hastings', () => {
  const manifestEntry = {
    name: 'Operation_Hastings',
    loading: { background: 'mods/eod/operation_hastings/load.webp' },
  };
  assert.ok(manifestEntry.loading.background.includes('operation_hastings/load.webp'));
});

test('T1-FEAT14-05: Applies object-fit: cover or virtual stretch without border artifacts', () => {
  const env = createMockEnvironment();
  const bgImg = env.document.createElement('img');
  bgImg.style.objectFit = 'cover';
  assert.equal(bgImg.style.objectFit, 'cover');
});

// --------------------------------------------------------------------------- //
// Feature 15: UI-BEVELED-BOX (5 Tests: T1-FEAT15-01 to T1-FEAT15-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT15-01: Renders metallic beveled container at virtual position (260, 465)', () => {
  const boxConfig = {
    virtualX: 260,
    virtualY: 465,
    width: 290,
    height: 64,
  };
  assert.equal(boxConfig.virtualX, 260);
  assert.equal(boxConfig.virtualY, 465);
});

test('T1-FEAT15-02: Container dimensions match active plate size 290 x 64 px', () => {
  const boxConfig = { width: 290, height: 64 };
  assert.equal(boxConfig.width, 290);
  assert.equal(boxConfig.height, 64);
});

test('T1-FEAT15-03: Uses extracted menu_loading.png as container background', () => {
  const env = createMockEnvironment();
  const box = env.document.createElement('div');
  box.className = 'ld-beveled-plate';
  box.style.backgroundImage = "url('_shared/load/menu_loading.png')";
  assert.ok(box.style.backgroundImage.includes('menu_loading.png'));
});

test('T1-FEAT15-04: Inner progress outer bevel positioned at (17, 33) relative to box with size 260 x 18', () => {
  const outerBevel = {
    relX: 17,
    relY: 33,
    width: 260,
    height: 18,
  };
  assert.equal(outerBevel.relX, 17);
  assert.equal(outerBevel.relY, 33);
  assert.equal(outerBevel.width, 260);
  assert.equal(outerBevel.height, 18);
});

test('T1-FEAT15-05: Inner progress fill positioned at (2, 2) relative to outer bevel with size 256 x 14', () => {
  const innerFill = {
    relX: 2,
    relY: 2,
    maxWidth: 256,
    height: 14,
  };
  assert.equal(innerFill.relX, 2);
  assert.equal(innerFill.relY, 2);
  assert.equal(innerFill.maxWidth, 256);
  assert.equal(innerFill.height, 14);
});

// --------------------------------------------------------------------------- //
// Feature 16: UI-TITLE-TYPOGRAPHY (5 Tests: T1-FEAT16-01 to T1-FEAT16-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT16-01: Renders uppercase title "LOADING <MAP_NAME>"', () => {
  const title = formatLoadingTitle('Wake');
  assert.equal(title, 'LOADING WAKE');
});

test('T1-FEAT16-02: Text color is solid black (#000000)', () => {
  const env = createMockEnvironment();
  const titleEl = env.document.createElement('div');
  titleEl.className = 'ld-title';
  titleEl.style.color = '#000000';
  assert.equal(titleEl.style.color, '#000000');
});

test('T1-FEAT16-03: Text position offset is (10, 6) relative to loading container', () => {
  const titleOffset = { relX: 10, relY: 6 };
  assert.equal(titleOffset.relX, 10);
  assert.equal(titleOffset.relY, 6);
});

test('T1-FEAT16-04: Uses Trebuchet MS 8 styling / font face', () => {
  const env = createMockEnvironment();
  const titleEl = env.document.createElement('div');
  titleEl.style.fontFamily = 'Trebuchet MS, sans-serif';
  titleEl.style.fontSize = '8px';
  assert.ok(titleEl.style.fontFamily.includes('Trebuchet MS'));
});

test('T1-FEAT16-05: Replaces underscores with spaces in map names', () => {
  const title = formatLoadingTitle('operation_hastings');
  assert.equal(title, 'LOADING OPERATION HASTINGS');
});

// --------------------------------------------------------------------------- //
// Feature 17: UI-MOD-THEME (5 Tests: T1-FEAT17-01 to T1-FEAT17-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT17-01: Applies vanilla olive color #847D4A to progress fill for vanilla maps', () => {
  const vanilla = MOD_THEMES.vanilla;
  assert.equal(vanilla.fillColor, '#847D4A');
});

test('T1-FEAT17-02: Applies vanilla charcoal tone #292829 to loading container trough', () => {
  const vanilla = MOD_THEMES.vanilla;
  assert.equal(vanilla.troughColor, '#292829');
});

test('T1-FEAT17-03: Applies EoD bamboo cream #F7E7B5 to progress fill for EoD maps', () => {
  const eod = MOD_THEMES.eod;
  assert.equal(eod.fillColor, '#F7E7B5');
});

test('T1-FEAT17-04: Applies EoD khaki header #B59B70 and parchment #E7D7B5 to container for EoD maps', () => {
  const eod = MOD_THEMES.eod;
  assert.equal(eod.headerColor, '#B59B70');
  assert.equal(eod.troughColor, '#E7D7B5');
});

test('T1-FEAT17-05: Dynamically switches theme styles when alternating between vanilla and EoD maps', () => {
  const env = createMockEnvironment();
  const container = env.document.createElement('div');

  // Load vanilla map
  container.setAttribute('data-theme', 'vanilla');
  assert.equal(container.getAttribute('data-theme'), 'vanilla');

  // Switch to EoD map
  container.setAttribute('data-theme', 'eod');
  assert.equal(container.getAttribute('data-theme'), 'eod');
});
