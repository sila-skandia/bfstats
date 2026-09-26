// The armoury stage: one WebGL canvas that draws extracted BF1942 soldiers and
// vehicles from the mesh tree (`/stats/assets/mesh/`), the same files
// mesh.bfstats.io serves.
//
// Everything `three` touches lives in this module so the ~150 KB of it is a
// chunk of its own, fetched only by a page that scrolls a stage into view.
//
// Two layouts:
//   turntable  one subject on a slow spin, draggable
//   faceoff    two soldiers facing each other across the middle (round report)
//
// A subject is revealed by a horizontal clipping plane rising from the floor,
// so a uniform or kit change reads as the new figure being issued rather than
// a pop. Rendering is on demand: the loop only runs while something moves and
// the host is on screen.

import {
  AdditiveBlending,
  AnimationClip,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SpotLight,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bonePattern, graftRotation } from './graft'

export type Side = 'axis' | 'allied' | null

export interface WornPart {
  path: string
  /** The kit manifest's bone and slot; a part missing either is left off, not guessed. */
  bone: string | null
  slot: string | null
  position?: number[]
  rotation?: number[]
}

export interface FigureSpec {
  pose: string
  worn: WornPart[]
}

export interface VehicleSpec {
  model: string
}

export interface StageOptions {
  /** URL prefix the mesh-relative paths hang off, e.g. `/stats/assets/mesh/`. */
  base: string
  layout: 'turntable' | 'faceoff'
  reducedMotion?: boolean
}

type RimKey = 'axis' | 'allied' | 'none'

// The rim that outlines each side's figure takes the side's brand colour, read
// from modern-minimal.css's tokens so a palette change reaches the lights too.
const RIM_TOKENS: Record<RimKey, [string, number]> = {
  axis: ['--mm-kill', 0xd65a5a],
  allied: ['--mm-success', 0x7da34c],
  none: ['--mm-accent-soft', 0x9aa666],
}

function rimColours(host: HTMLElement): Record<RimKey, number> {
  const style = getComputedStyle(host)
  const read = ([name, fallback]: [string, number]) => {
    const value = style.getPropertyValue(name).trim()
    return /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : fallback
  }
  return { axis: read(RIM_TOKENS.axis), allied: read(RIM_TOKENS.allied), none: read(RIM_TOKENS.none) }
}

// A pose glb's soldier faces +Z (the camera) at yaw 0 and +X at a quarter turn.
const HERO_YAW = 0.45
const FACEOFF_X = 1.0
const FACEOFF_YAW = Math.PI / 2 - 0.62

// Rim strength per subject. It grazes a soldier's shoulders and back; on a hull
// it would wash every upward face in the side's colour, so a vehicle gets little.
const RIM_FIGURE = 2.1
const RIM_VEHICLE = 0.7
const RIM_SPOT = 11

const SPIN_RADIANS_PER_SECOND = 0.32
const RESUME_SPIN_AFTER_MS = 2600
const REVEAL_MS = 900

/** What an exterior view never draws: collision hulls, effect emitters, projectiles, cockpit interiors. */
function hideUndrawn(root: Object3D): void {
  root.traverse(obj => {
    const data = obj.userData ?? {}
    const geometryData = (obj as Mesh).geometry?.userData ?? {}
    if (
      data.effect || data.projectileMesh || data.projectileTrail || data.tracerMesh
      || data.collision || geometryData.collision || data.lodAlternative
      || /collision/i.test(obj.name || '')
    ) {
      obj.visible = false
    }
    // A propeller ships blades and a blurred disc as siblings; a parked plane shows the blades.
    const blur = data.propellerBlur as { static?: string, blurred?: string } | undefined
    if (blur) {
      for (const child of obj.children) {
        if (child.name === blur.blurred) child.visible = false
        if (child.name === blur.static) child.visible = true
      }
    }
    // A posed limb leaves its bind-pose bounds behind, so culling by them blanks it mid-spin.
    if ((obj as Mesh).isMesh) obj.frustumCulled = false
  })
}

function isShown(obj: Object3D): boolean {
  for (let node: Object3D | null = obj; node; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}

function disposeTree(root: Object3D): void {
  root.traverse(obj => {
    const mesh = obj as Mesh
    mesh.geometry?.dispose()
    for (const material of [mesh.material].flat().filter(Boolean) as Material[]) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

/** A soft round shadow, drawn once into a canvas: cheaper than shadow maps and never aliased. */
function contactShadowTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0,0,0,0.62)')
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.30)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}

/** One subject's place on the stage: its turntable, rim light, floor shadow and reveal ring. */
interface Slot {
  pivot: Group
  subject: Object3D | null
  mixer: AnimationMixer | null
  rim: SpotLight | DirectionalLight
  shadow: Mesh
  ring: Mesh
  clip: Plane
  height: number
  radius: number
  revealStart: number
  sequence: number
  dimmed: boolean
}

export type Stage = ReturnType<typeof createStage>

export function createStage(host: HTMLElement, options: StageOptions) {
  const faceoff = options.layout === 'faceoff'
  const reducedMotion = Boolean(options.reducedMotion)
  const SIDE_RIM = rimColours(host)

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.localClippingEnabled = true
  const canvas = renderer.domElement
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'pan-y'
  host.appendChild(canvas)

  const scene = new Scene()
  const camera = new PerspectiveCamera(faceoff ? 24 : 26, 1, 0.05, 400)
  const loader = new GLTFLoader()

  // Key and fill are neutral; the rim is where each side's colour lives.
  scene.add(new HemisphereLight(0xd9dee6, 0x24251c, 1.15))
  const key = new DirectionalLight(0xfff3e2, 2.3)
  key.position.set(-2.6, 4.2, 3.6)
  scene.add(key)
  const fill = new DirectionalLight(0xb9c5d8, 0.55)
  fill.position.set(3.2, 1.2, 2.4)
  scene.add(fill)

  const shadowTexture = contactShadowTexture()

  function makeSlot(x: number, yaw: number): Slot {
    const pivot = new Group()
    pivot.position.x = x
    pivot.rotation.y = yaw
    scene.add(pivot)

    const shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(x, 0.002, 0)
    shadow.visible = false
    scene.add(shadow)

    const ring = new Mesh(
      new RingGeometry(0.96, 1, 72),
      new MeshBasicMaterial({
        color: SIDE_RIM.none, transparent: true, opacity: 0, side: DoubleSide,
        blending: AdditiveBlending, depthWrite: false,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.x = x
    ring.visible = false
    scene.add(ring)

    // A faceoff's rims are spots, one per figure, so each side's colour stays on its own man.
    let rim: SpotLight | DirectionalLight
    if (faceoff) {
      const spot = new SpotLight(SIDE_RIM.none, RIM_SPOT, 0, 0.42, 0.7, 0)
      spot.position.set(x * 3.2, 2.2, -3.4)
      spot.target.position.set(x, 1, 0)
      scene.add(spot, spot.target)
      rim = spot
    } else {
      const light = new DirectionalLight(SIDE_RIM.none, RIM_FIGURE)
      light.position.set(1.8, 1.6, -4.6)
      scene.add(light)
      rim = light
    }

    return {
      pivot, subject: null, mixer: null, rim, shadow, ring,
      clip: new Plane(new Vector3(0, -1, 0), 1e6),
      height: 1.8, radius: 0.5, revealStart: 0, sequence: 0, dimmed: false,
    }
  }

  // Faceoff figures stand turned three-quarters to the camera, toward each other.
  const slots: Slot[] = faceoff
    ? [makeSlot(-FACEOFF_X, FACEOFF_YAW), makeSlot(FACEOFF_X, -FACEOFF_YAW)]
    : [makeSlot(0, HERO_YAW)]

  // ---- loop -------------------------------------------------------------

  let active = true
  let disposed = false
  let raf = 0
  let last = 0
  let dragging = false
  let velocity = 0
  let resumeSpinAt = 0

  function revealing(now: number): boolean {
    let busy = false
    for (const slot of slots) {
      if (!slot.subject || slot.revealStart === 0) continue
      const t = reducedMotion ? 1 : Math.min(1, (now - slot.revealStart) / REVEAL_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      const top = slot.height * 1.04
      const y = eased * top
      slot.clip.constant = t >= 1 ? 1e6 : y
      const ringMaterial = slot.ring.material as MeshBasicMaterial
      slot.ring.visible = t < 1
      slot.ring.position.y = y
      slot.ring.scale.setScalar(slot.radius * 1.15)
      ringMaterial.opacity = 0.85 * (1 - t)
      if (t >= 1) slot.revealStart = 0
      else busy = true
    }
    return busy
  }

  function frame(now: number): void {
    raf = 0
    if (disposed) return
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    let busy = revealing(now)

    if (!faceoff) {
      const pivot = slots[0].pivot
      if (dragging) {
        busy = true
      } else if (Math.abs(velocity) > 0.02) {
        pivot.rotation.y += velocity * dt
        velocity *= Math.pow(0.05, dt)
        busy = true
      } else if (!reducedMotion && slots[0].subject) {
        if (now >= resumeSpinAt) pivot.rotation.y += SPIN_RADIANS_PER_SECOND * dt
        busy = true
      }
    }

    renderer.render(scene, camera)
    if (busy && active) raf = requestAnimationFrame(frame)
  }

  function kick(): void {
    if (raf || disposed || !active) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }

  // ---- framing ------------------------------------------------------------

  function aspect(): number {
    const { clientWidth: w, clientHeight: h } = host
    return w > 0 && h > 0 ? w / h : 1
  }

  /** Fit every subject: a turntable frames its one subject, a faceoff frames the pair. */
  function frameCamera(): void {
    camera.aspect = aspect()
    const vertical = (camera.fov * Math.PI) / 180
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect)
    const filled = slots.filter(slot => slot.subject)
    const height = Math.max(1, ...filled.map(slot => slot.height))

    if (faceoff) {
      const span = FACEOFF_X * 2 + Math.max(0.5, ...filled.map(slot => slot.radius)) * 2.2
      const distance = Math.max((height * 1.22) / 2 / Math.tan(vertical / 2), span / 2 / Math.tan(horizontal / 2))
      camera.position.set(0, height * 0.52, distance)
      camera.lookAt(0, height * 0.5, 0)
    } else {
      const slot = slots[0]
      const isVehicle = slot.subject?.userData.kind === 'vehicle'
      // Width the subject can sweep through while it spins.
      const sweep = slot.radius * 2
      // A figure leaves the bottom fifth of the frame to the kit bar that overlays it.
      const fitHeight = isVehicle ? Math.max(height, sweep * 0.55) * 1.5 : height * 1.36
      const distance = Math.max(fitHeight / 2 / Math.tan(vertical / 2), (sweep * 1.08) / 2 / Math.tan(horizontal / 2))
      const elevation = isVehicle ? 0.34 : 0.04
      camera.position.set(0, height * 0.5 + Math.sin(elevation) * distance, Math.cos(elevation) * distance)
      camera.lookAt(0, height * (isVehicle ? 0.34 : 0.4), 0)
    }
    camera.near = 0.05
    camera.far = 400
    camera.updateProjectionMatrix()
  }

  function resize(): void {
    const { clientWidth: w, clientHeight: h } = host
    if (!w || !h) return
    renderer.setSize(w, h, false)
    frameCamera()
    kick()
    if (!raf && !disposed) renderer.render(scene, camera)
  }

  // ---- subjects -----------------------------------------------------------

  function tint(slot: Slot, side: Side): void {
    const color = new Color(SIDE_RIM[side ?? 'none'])
    // A full-strength brand colour reads as neon on skin; a third of the way to white still says which side.
    slot.rim.color.copy(color).lerp(new Color(0xffffff), 0.3)
    ;(slot.ring.material as MeshBasicMaterial).color.copy(color)
  }

  function applyDim(slot: Slot): void {
    const base = faceoff ? RIM_SPOT : slot.subject?.userData.kind === 'vehicle' ? RIM_VEHICLE : RIM_FIGURE
    slot.rim.intensity = slot.dimmed ? base * 0.18 : base
    slot.subject?.traverse(obj => {
      for (const material of [(obj as Mesh).material].flat().filter(Boolean) as Material[]) {
        const standard = material as Material & { color?: Color }
        if (!standard.color) continue
        if (!material.userData.baseColor) material.userData.baseColor = standard.color.getHex()
        standard.color.setHex(material.userData.baseColor)
        if (slot.dimmed) standard.color.multiplyScalar(0.38)
      }
    })
  }

  /**
   * Swap `root` onto `slot`, sitting it on the floor at the pivot and starting its reveal.
   * `axis` is what it spins about (a soldier's spine, not the midpoint of him and his
   * rifle); `extent` is everything drawn, which sets how much room the spin needs.
   */
  function mount(slot: Slot, root: Object3D, axis: Box3, extent: Box3, mixer: AnimationMixer | null): void {
    const centre = axis.getCenter(new Vector3())
    const holder = new Group()
    holder.userData.kind = root.userData.kind
    root.position.sub(new Vector3(centre.x, axis.min.y, centre.z))
    holder.add(root)

    root.traverse(obj => {
      for (const material of [(obj as Mesh).material].flat().filter(Boolean) as Material[]) {
        material.clippingPlanes = [slot.clip]
      }
    })

    if (slot.subject) {
      slot.pivot.remove(slot.subject)
      disposeTree(slot.subject)
    }
    slot.subject = holder
    slot.mixer = mixer
    slot.pivot.add(holder)
    // A new issue faces the camera three-quarters, whatever angle the last one had spun to.
    if (!faceoff) {
      slot.pivot.rotation.y = HERO_YAW
      velocity = 0
    }
    slot.height = extent.max.y - axis.min.y
    // The farthest drawn corner from the spin axis, in plan.
    slot.radius = Math.max(
      ...[extent.min.x, extent.max.x].flatMap(x => [extent.min.z, extent.max.z].map(z => Math.hypot(x - centre.x, z - centre.z))),
    ) + 0.04
    slot.shadow.visible = true
    slot.shadow.scale.setScalar(Math.max(0.9, slot.radius * 2.3))
    slot.clip.constant = reducedMotion ? 1e6 : 0
    slot.revealStart = reducedMotion ? 0 : performance.now()
    applyDim(slot)
    frameCamera()
    kick()
  }

  async function loadWorn(part: WornPart): Promise<Object3D | null> {
    try {
      const gltf = await loader.loadAsync(options.base + part.path)
      return gltf.scene
    } catch {
      // A missing helmet leaves the man bare-headed; it does not fail the figure.
      return null
    }
  }

  /** Put a soldier on the stage. `slotIndex` 0/1 are the left/right figures of a faceoff. */
  async function showFigure(spec: FigureSpec, side: Side, slotIndex: 0 | 1 = 0): Promise<void> {
    const slot = slots[slotIndex] ?? slots[0]
    const sequence = ++slot.sequence
    const [gltf, ...worn] = await Promise.all([
      loader.loadAsync(options.base + spec.pose),
      ...spec.worn.map(loadWorn),
    ])
    if (disposed || sequence !== slot.sequence) {
      disposeTree(gltf.scene)
      for (const part of worn) if (part) disposeTree(part)
      return
    }

    const root = gltf.scene
    root.userData.kind = 'figure'
    hideUndrawn(root)

    // The pose glb carries three constant clips; `stand` is the one a portrait wants.
    let mixer: AnimationMixer | null = null
    const clip = AnimationClip.findByName(gltf.animations, 'stand') ?? gltf.animations[0]
    if (clip) {
      mixer = new AnimationMixer(root)
      mixer.clipAction(clip).play()
      mixer.update(0)
    }

    spec.worn.forEach((part, index) => {
      const mesh = worn[index]
      if (!mesh || !part.bone) return
      const pattern = bonePattern(part.bone)
      let bone: Object3D | null = null
      root.traverse(obj => { if (!bone && pattern.test(obj.name)) bone = obj })
      if (!bone) return
      const [px = 0, py = 0, pz = 0] = part.position ?? []
      const [qx, qy, qz, qw] = graftRotation(part.slot ?? '', part.rotation ?? [])
      mesh.position.set(px, py, pz)
      mesh.quaternion.set(qx, qy, qz, qw)
      hideUndrawn(mesh)
      ;(bone as Object3D).add(mesh)
    })

    // Bound the body by its posed joints: a skinned mesh's own bounds are the
    // bind-space figure lying along +Z, nowhere near the render. The rifle and the
    // kit are rigid meshes hung off bones, so their bounds are true and are added.
    root.updateMatrixWorld(true)
    const joints = new Box3()
    root.traverse(obj => {
      if ((obj as Object3D & { isBone?: boolean }).isBone || obj.userData?.joint) {
        joints.expandByPoint(obj.getWorldPosition(new Vector3()))
      }
    })
    if (joints.isEmpty()) joints.setFromObject(root)
    // Joints sit inside the flesh: the head bone is a hand below the helmet's crown, the toes above the sole.
    joints.min.y -= 0.06
    joints.max.y += 0.2
    const extent = joints.clone()
    root.traverse(obj => {
      const mesh = obj as Mesh & { isSkinnedMesh?: boolean }
      if (mesh.isMesh && !mesh.isSkinnedMesh && mesh.geometry && isShown(mesh)) extent.expandByObject(mesh)
    })

    tint(slot, side)
    mount(slot, root, joints, extent, mixer)
  }

  /** Put a vehicle on the turntable in place of the soldier. */
  async function showVehicle(spec: VehicleSpec, side: Side): Promise<void> {
    const slot = slots[0]
    const sequence = ++slot.sequence
    const gltf = await loader.loadAsync(options.base + spec.model)
    if (disposed || sequence !== slot.sequence) {
      disposeTree(gltf.scene)
      return
    }
    const root = gltf.scene
    root.userData.kind = 'vehicle'
    hideUndrawn(root)
    root.updateMatrixWorld(true)
    const bounds = new Box3()
    root.traverse(obj => {
      const mesh = obj as Mesh
      if (mesh.isMesh && mesh.geometry && isShown(mesh)) bounds.expandByObject(mesh)
    })
    if (bounds.isEmpty()) bounds.setFromObject(root)
    tint(slot, side)
    mount(slot, root, bounds, bounds, null)
  }

  /** Take everything off the stage. */
  function clear(): void {
    for (const slot of slots) {
      slot.sequence++
      if (slot.subject) {
        slot.pivot.remove(slot.subject)
        disposeTree(slot.subject)
      }
      slot.subject = null
      slot.mixer = null
      slot.shadow.visible = false
      slot.ring.visible = false
    }
    if (!disposed) renderer.render(scene, camera)
  }

  /** Dim the losing side of a faceoff; `null` lights both. */
  function setWinner(slotIndex: 0 | 1 | null): void {
    slots.forEach((slot, index) => {
      slot.dimmed = slotIndex !== null && index !== slotIndex
      applyDim(slot)
    })
    kick()
    if (!raf && !disposed) renderer.render(scene, camera)
  }

  // ---- input --------------------------------------------------------------

  let pointerId: number | null = null
  let lastX = 0
  let lastT = 0

  function onPointerDown(event: PointerEvent): void {
    if (faceoff || event.button !== 0) return
    pointerId = event.pointerId
    dragging = true
    velocity = 0
    lastX = event.clientX
    lastT = event.timeStamp
    canvas.setPointerCapture(event.pointerId)
    kick()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || event.pointerId !== pointerId) return
    const dx = event.clientX - lastX
    const dt = Math.max(1, event.timeStamp - lastT) / 1000
    const turn = dx * 0.011
    slots[0].pivot.rotation.y += turn
    velocity = turn / dt
    lastX = event.clientX
    lastT = event.timeStamp
    kick()
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    dragging = false
    pointerId = null
    if (event.timeStamp - lastT > 80) velocity = 0
    resumeSpinAt = performance.now() + RESUME_SPIN_AFTER_MS
    kick()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  /** Pause the loop while the host is off screen or the tab is hidden. */
  function setActive(next: boolean): void {
    active = next
    if (active) kick()
    else if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  function dispose(): void {
    disposed = true
    if (raf) cancelAnimationFrame(raf)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    for (const slot of slots) {
      if (slot.subject) disposeTree(slot.subject)
      slot.shadow.geometry.dispose()
      ;(slot.shadow.material as Material).dispose()
      slot.ring.geometry.dispose()
      ;(slot.ring.material as Material).dispose()
    }
    shadowTexture.dispose()
    renderer.dispose()
    // Browsers cap live WebGL contexts per page; hand this one back now, not at GC.
    renderer.forceContextLoss()
    canvas.remove()
  }

  resize()

  return { showFigure, showVehicle, clear, setWinner, setActive, resize, dispose }
}
