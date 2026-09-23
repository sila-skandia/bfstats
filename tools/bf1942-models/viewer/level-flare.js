// The sun's lens flare, painted on its own canvas over the frame. Out of
// level-load.js; `createLevel` builds one, `show()` sets it up per level and
// the frame paints it.

import * as THREE from 'three';
import { flareSprites, flareTextureFiles, hasDrawableFlare } from './lens-flare.js';

/**
 * Built once by `createLevel` (level-load.js). `page` hands in what it reads,
 * as getters (a value the level reassigns is read live):
 * `bust`, `camera`, `extras`, `MAPS_BASE`, `renderer`.
 */
export function createLevelFlare(page) {
  const flare = {};
  /* The sun's lens flare. `lens-flare.js` carries the engine reading and the
   * placement arithmetic; this is the painter and the texture cache.
   *
   * Nothing draws on a vanilla level, and that is correct rather than broken:
   * the five textures all 21 vanilla declarations name ship in no vanilla
   * archive (the module's header lists every place they were looked for and the
   * two mod archives that do have them). The extractor records them in
   * `missingTextures` and leaves each sprite's `file` null, so `hasDrawableFlare`
   * is false and the whole pass is skipped.
   */
  const flareCanvas = document.getElementById('flare-canvas');
  const flareImages = new Map();          // file -> HTMLImageElement, once loaded
  flare.flareData = null;

  function setupLensFlare(dir) {
    flare.flareData = null;
    flareImages.clear();
    const ctx = flareCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, flareCanvas.width, flareCanvas.height);
    const data = page.extras.lensFlare;
    if (!hasDrawableFlare(data)) return;
    flare.flareData = data;
    for (const file of flareTextureFiles(data)) {
      const img = new Image();
      img.onload = () => flareImages.set(file, img);
      img.onerror = () => {};
      img.src = `${page.MAPS_BASE}/${dir}/${file}${page.bust()}`;
    }
  }

  /** The sun's own screen position, and whether anything is in front of it.
   *  The direction is the level's `sunLightDirectionVec`, the same vector the
   *  DirectionalLight and the sky are aimed by; the sun itself is painted into
   *  the sky box faces, so this is where that painted disc lands. */
  function sunScreenPosition() {
    const sd = page.extras.sunDirection;
    if (!sd) return null;
    const norm = Math.hypot(sd[0], sd[1], sd[2]) || 1;
    // `show()` places the light at -sunDirection * 400, i.e. the sun is in the
    // direction the light points FROM.
    const dir = new THREE.Vector3(-sd[0] / norm, sd[1] / norm, -sd[2] / norm);
    // Is it in front of the camera? Asked in VIEW space, where -z is forward.
    // Not by projecting a far-off point and testing its ndc z: the sun is
    // effectively at infinity and every level's far plane is short (Berlin's is
    // 105 m), so such a point is always past the far plane and its ndc z always
    // reads > 1 — which is how this first drew nothing at all.
    const view = dir.clone().applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(page.camera.matrixWorldInverse));
    if (view.z >= 0) return null;
    // Now project a point that is inside the frustum but along the same ray, so
    // the perspective divide gives the direction's own screen position.
    const projected = dir.clone()
      .multiplyScalar(page.camera.near + (page.camera.far - page.camera.near) * 0.5)
      .add(page.camera.position)
      .project(page.camera);
    const w = flareCanvas.width;
    const h = flareCanvas.height;
    const x = (projected.x * 0.5 + 0.5) * w;
    const y = (-projected.y * 0.5 + 0.5) * h;
    // How far off centre, normalised so the screen corner is 1 — what
    // `setFlareDistFadeScale` fades against.
    const dist = Math.hypot(x - w / 2, y - h / 2) / (Math.hypot(w, h) / 2);
    return { sunX: x, sunY: y, sunDistance: dist, visible: true };
  }

  function paintLensFlare() {
    if (!flare.flareData) return;
    const width = page.renderer.domElement.width;
    const height = page.renderer.domElement.height;
    if (flareCanvas.width !== width || flareCanvas.height !== height) {
      flareCanvas.width = width;
      flareCanvas.height = height;
    }
    const ctx = flareCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const view = sunScreenPosition();
    if (!view) return;
    const sprites = flareSprites(flare.flareData, {
      ...view, width, height,
      // Not a real occlusion test: nothing here traces the sun against the
      // scene. Left at 1 rather than faked — a guessed occlusion would flicker
      // the whole flare on geometry it never actually checked.
      occlusion: 1,
      textureSize: file => {
        const img = flareImages.get(file);
        return img ? Math.max(img.naturalWidth, img.naturalHeight) : 0;
      },
    });
    for (const sprite of sprites) {
      const img = flareImages.get(sprite.file);
      if (!img) continue;
      ctx.globalCompositeOperation = sprite.additive ? 'lighter' : 'source-over';
      ctx.globalAlpha = sprite.color[3];
      ctx.save();
      ctx.translate(sprite.x, sprite.y);
      if (sprite.rot) ctx.rotate(sprite.rot);
      ctx.drawImage(img, -sprite.size / 2, -sprite.size / 2, sprite.size, sprite.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  Object.assign(flare, {
    paintLensFlare,
    setupLensFlare,
  });
  return flare;
}
