// Pictures of a tank's own model for the tank school (features/battle-schools):
// side-on, from the front and from behind, drawn once with an orthographic
// camera into an offscreen canvas, at a fixed number of pixels a metre so two
// tanks drawn side by side are to scale. The GUNS panel lays its gun-pitch fan
// on the side view and puts the front view in the gunsight; the STEADINESS
// panel rocks the side view (pitch) or the rear view (roll) by the measured
// trace.
//
// Each picture comes with where things are on it, in its own pixels: the gun's
// pivot (the bundle that elevates it), the barrel's tip, the hull's middle,
// and the ground.

import * as THREE from 'three';

let renderer = null;
const scene = new THREE.Scene();
{
  const hemi = new THREE.HemisphereLight(0xf2f0e6, 0x3a3a32, 2.6);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(4, 10, 6);
  scene.add(hemi, sun);
}

const shownIn = (o, top) => { for (let a = o; a && a !== top; a = a.parent) if (!a.visible) return false; return true; };

/** The main gun's node in `root`: by name, else the first FireArms firing a shell. */
function gunNode(root, name) {
  let gun = null;
  root.traverse(o => {
    const d = o.userData ?? {};
    if (d.templateKind !== 'FireArms' || d.fireArms?.projectile?.kind !== 'shell') return;
    if (!gun || o.name === name) gun = o;
  });
  return gun;
}

/**
 * Pictures of `source` (a loaded model scene, left untouched): `{ side, front,
 * rear }`, each `{ url, width, height, pxPerM, pivot, tip, middle, groundY }`
 * in the picture's CSS pixels. `gunName` picks the main gun.
 */
export function snapshots(source, { gunName = null, pxPerM = 34, pad = 0.5, dpr = 2 } = {}) {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const model = source.clone(true);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  // The collision faces are not the tank a player sees.
  model.traverse(o => { if (o.isMesh && o.geometry?.userData?.collision) o.visible = false; });
  scene.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse(o => { if (o.isMesh && shownIn(o, scene)) box.expandByObject(o); });
  const gun = gunNode(model, gunName);
  let pivotNode = null;
  for (let a = gun?.parent; a && a !== model; a = a.parent) if (a.userData?.rig?.axes?.pitch) { pivotNode = a; break; }
  const pivot = (pivotNode ?? gun ?? model).getWorldPosition(new THREE.Vector3());
  // The barrel's tip: the gun's own meshes' furthest point forward (-z).
  const gunBox = new THREE.Box3();
  gun?.traverse(o => { if (o.isMesh && shownIn(o, scene)) gunBox.expandByObject(o); });
  const tip = gunBox.isEmpty() ? pivot.clone() : new THREE.Vector3(pivot.x, pivot.y, gunBox.min.z);
  const middle = box.getCenter(new THREE.Vector3());

  const views = {
    // Camera on the tank's right, looking left: the nose points right.
    side: { eye: new THREE.Vector3(1, 0, 0), w: box.max.z - box.min.z, h: box.max.y - box.min.y },
    // Camera ahead of it, looking back at it.
    front: { eye: new THREE.Vector3(0, 0, -1), w: box.max.x - box.min.x, h: box.max.y - box.min.y },
    // Camera behind it: its right side on the right.
    rear: { eye: new THREE.Vector3(0, 0, 1), w: box.max.x - box.min.x, h: box.max.y - box.min.y },
  };
  const out = {};
  for (const [name, v] of Object.entries(views)) {
    const wm = v.w + pad * 2, hm = v.h + pad * 2;
    const width = Math.round(wm * pxPerM), height = Math.round(hm * pxPerM);
    const cam = new THREE.OrthographicCamera(-wm / 2, wm / 2, hm / 2, -hm / 2, 0.1, 100);
    cam.position.copy(middle).addScaledVector(v.eye, 40);
    cam.up.set(0, 1, 0);
    cam.lookAt(middle);
    cam.updateMatrixWorld(true);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    renderer.clear();
    renderer.render(scene, cam);
    const px = p => {
      const n = p.clone().project(cam);
      return { x: (n.x + 1) / 2 * width, y: (1 - n.y) / 2 * height };
    };
    out[name] = {
      url: renderer.domElement.toDataURL('image/png'),
      width, height, pxPerM,
      pivot: px(pivot), tip: px(tip), middle: px(middle),
      groundY: px(new THREE.Vector3(middle.x, box.min.y, middle.z)).y,
      heightM: v.h, widthM: v.w,
    };
  }
  scene.remove(model);
  return out;
}
