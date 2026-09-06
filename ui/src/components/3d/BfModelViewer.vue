<template>
  <div
    ref="containerRef"
    class="relative w-full overflow-hidden rounded-xl select-none font-sans"
    :class="[
      transparentBg ? 'bg-transparent' : 'bg-gradient-to-b from-stone-900 via-neutral-900 to-black',
      fullscreen ? 'fixed inset-0 z-50 rounded-none h-screen w-screen' : ''
    ]"
    :style="{ height: fullscreen ? '100vh' : height }"
  >
    <!-- 3D Canvas Mount Point -->
    <canvas ref="canvasRef" class="w-full h-full block cursor-grab active:cursor-grabbing outline-none" />

    <!-- Loading State Overlay -->
    <Transition name="fade">
      <div
        v-if="loading"
        class="absolute inset-0 flex flex-col items-center justify-center bg-stone-950/80 backdrop-blur-sm z-20"
      >
        <div class="relative flex items-center justify-center w-16 h-16 mb-4">
          <!-- Animated radar ring -->
          <div class="absolute inset-0 border-2 border-amber-500/30 rounded-full animate-ping" />
          <div class="absolute inset-2 border-2 border-dashed border-amber-500/60 rounded-full animate-spin" />
          <svg class="w-6 h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <div class="text-sm font-semibold tracking-wider text-stone-200 uppercase">
          Loading 3D Model
        </div>
        <div class="text-xs text-stone-400 mt-1 font-mono">
          {{ modelName }}.glb · {{ loadProgress }}%
        </div>
      </div>
    </Transition>

    <!-- Error State Overlay -->
    <div
      v-if="errorMessage"
      class="absolute inset-0 flex flex-col items-center justify-center bg-stone-950/90 backdrop-blur-sm z-20 p-6 text-center"
    >
      <div class="w-12 h-12 rounded-full bg-red-950/50 border border-red-500/40 flex items-center justify-center text-red-400 mb-3">
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p class="text-sm font-medium text-stone-200 mb-1">Failed to load 3D model</p>
      <p class="text-xs text-stone-400 max-w-sm mb-4 font-mono">{{ errorMessage }}</p>
      <button
        type="button"
        class="px-4 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold tracking-wide transition-colors border border-stone-600"
        @click="reloadModel"
      >
        Retry Loading
      </button>
    </div>

    <!-- UI Controls HUD Overlay -->
    <div
      class="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-stone-950/75 backdrop-blur-md border border-stone-700/50 rounded-lg p-1 shadow-lg"
    >
      <!-- Auto Rotate Toggle -->
      <button
        type="button"
        class="p-2 rounded-md transition-all text-xs flex items-center justify-center"
        :class="isAutoRotating ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'"
        title="Toggle Auto-Rotation"
        @click="toggleAutoRotate"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      <!-- Wireframe Toggle -->
      <button
        type="button"
        class="p-2 rounded-md transition-all text-xs flex items-center justify-center"
        :class="isWireframe ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'"
        title="Toggle Wireframe Mesh"
        @click="toggleWireframe"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>

      <!-- Transparent Background Toggle -->
      <button
        type="button"
        class="p-2 rounded-md transition-all text-xs flex items-center justify-center"
        :class="transparentBg ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'"
        title="Toggle Transparent Background"
        @click="toggleTransparent"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke-dasharray="3 3" />
        </svg>
      </button>

      <!-- Reset View Button -->
      <button
        type="button"
        class="p-2 rounded-md transition-all text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-800/60 flex items-center justify-center"
        title="Reset Camera View"
        @click="resetCamera"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 12a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      <!-- Fullscreen Toggle -->
      <button
        type="button"
        class="p-2 rounded-md transition-all text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-800/60 flex items-center justify-center"
        :title="fullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
        @click="toggleFullscreen"
      >
        <svg v-if="!fullscreen" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
        <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 4v4H5m10-4v4h4M9 20v-4H5m10 4v-4h4" />
        </svg>
      </button>
    </div>

    <!-- Navigation / Interaction Helper (Bottom Left) -->
    <div
      class="absolute bottom-3 left-3 z-10 pointer-events-none hidden sm:flex items-center gap-3 text-[11px] text-stone-400/80 bg-stone-950/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-stone-800/40 font-mono"
    >
      <span class="flex items-center gap-1">
        <kbd class="px-1.5 py-0.5 rounded bg-stone-800 text-stone-300 text-[10px]">Left Drag</kbd> Rotate
      </span>
      <span class="flex items-center gap-1">
        <kbd class="px-1.5 py-0.5 rounded bg-stone-800 text-stone-300 text-[10px]">Scroll</kbd> Zoom
      </span>
      <span class="flex items-center gap-1">
        <kbd class="px-1.5 py-0.5 rounded bg-stone-800 text-stone-300 text-[10px]">Right Drag</kbd> Pan
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

interface Props {
  modelName: string
  modelUrl?: string
  height?: string
  transparent?: boolean
  autoRotate?: boolean
  wireframe?: boolean
  cameraFov?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelUrl: '',
  height: '520px',
  transparent: false,
  autoRotate: true,
  wireframe: false,
  cameraFov: 42,
})

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const loading = ref(true)
const loadProgress = ref(0)
const errorMessage = ref<string | null>(null)
const isAutoRotating = ref(props.autoRotate)
const isWireframe = ref(props.wireframe)
const transparentBg = ref(props.transparent)
const fullscreen = ref(false)

// Three.js internal objects
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let currentModel: THREE.Group | null = null
let groundPlane: THREE.Mesh | null = null
let gridHelper: THREE.GridHelper | null = null
let animationFrameId: number | null = null
let resizeObserver: ResizeObserver | null = null

// Initial camera framing cache for reset
let defaultTarget = new THREE.Vector3(0, 0, 0)
let defaultCameraPos = new THREE.Vector3(5, 4, 7)

function getResolvedModelUrl(): string {
  if (props.modelUrl) return props.modelUrl
  return `/stats/assets/models/${props.modelName}.glb`
}

function initThree() {
  if (!canvasRef.value || !containerRef.value) return

  const width = containerRef.value.clientWidth || 640
  const height = containerRef.value.clientHeight || 480

  // 1. Scene
  scene = new THREE.Scene()
  if (!transparentBg.value) {
    scene.background = null // Canvas background gradient shows through
  }

  // 2. Camera
  camera = new THREE.PerspectiveCamera(props.cameraFov, width / height, 0.1, 1000)
  camera.position.copy(defaultCameraPos)

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // 4. OrbitControls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.autoRotate = isAutoRotating.value
  controls.autoRotateSpeed = 1.4
  controls.maxPolarAngle = Math.PI / 2 + 0.04 // Slight ground look-up
  controls.minDistance = 0.5
  controls.maxDistance = 150

  // 5. Studio Lights
  // Soft ambient base
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85)
  scene.add(ambientLight)

  // Primary warm directional key light
  const keyLight = new THREE.DirectionalLight(0xfff8ee, 1.8)
  keyLight.position.set(12, 18, 14)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.width = 2048
  keyLight.shadow.mapSize.height = 2048
  keyLight.shadow.camera.near = 0.5
  keyLight.shadow.camera.far = 100
  keyLight.shadow.bias = -0.0001
  const d = 16
  keyLight.shadow.camera.left = -d
  keyLight.shadow.camera.right = d
  keyLight.shadow.camera.top = d
  keyLight.shadow.camera.bottom = -d
  scene.add(keyLight)

  // Cool fill light
  const fillLight = new THREE.DirectionalLight(0xd5e6f8, 0.9)
  fillLight.position.set(-14, 10, -10)
  scene.add(fillLight)

  // Back / rim light
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.6)
  rimLight.position.set(0, 8, -16)
  scene.add(rimLight)

  // 6. Ground Studio Shadow Plane & Tactical Grid
  const shadowGeo = new THREE.PlaneGeometry(60, 60)
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 })
  groundPlane = new THREE.Mesh(shadowGeo, shadowMat)
  groundPlane.rotation.x = -Math.PI / 2
  groundPlane.position.y = 0
  groundPlane.receiveShadow = true
  scene.add(groundPlane)

  gridHelper = new THREE.GridHelper(30, 30, 0x667788, 0x334455)
  gridHelper.position.y = 0.001
  ;(gridHelper.material as THREE.Material).transparent = true
  ;(gridHelper.material as THREE.Material).opacity = 0.25
  scene.add(gridHelper)

  // 7. Render Loop
  const animate = () => {
    animationFrameId = requestAnimationFrame(animate)
    if (controls) controls.update()
    if (renderer && scene && camera) {
      renderer.render(scene, camera)
    }
  }
  animate()

  // 8. Resize Observer
  resizeObserver = new ResizeObserver(() => {
    handleResize()
  })
  resizeObserver.observe(containerRef.value)
}

function handleResize() {
  if (!containerRef.value || !renderer || !camera) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

function applyWireframe(root: THREE.Object3D, enabled: boolean) {
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      const setWireframe = (m: THREE.Material) => {
        if ('wireframe' in m) {
          (m as THREE.MeshStandardMaterial).wireframe = enabled
        }
      }
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(setWireframe)
      } else if (mesh.material) {
        setWireframe(mesh.material)
      }
    }
  })
}

function fitCameraToObject(root: THREE.Object3D) {
  if (!camera || !controls) return

  const box = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)

  // Place object on ground plane (y = 0)
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= box.min.y

  // Re-calculate framed size
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = camera.fov * (Math.PI / 180)
  let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.55
  cameraDistance = Math.max(cameraDistance, 3.5)

  // Position camera at 3/4 isometric perspective
  const targetPos = new THREE.Vector3(0, size.y * 0.45, 0)
  controls.target.copy(targetPos)
  defaultTarget.copy(targetPos)

  const camOffset = new THREE.Vector3(cameraDistance * 0.75, cameraDistance * 0.5, cameraDistance * 0.9)
  camera.position.copy(targetPos).add(camOffset)
  defaultCameraPos.copy(camera.position)

  camera.near = cameraDistance / 100
  camera.far = cameraDistance * 100
  camera.updateProjectionMatrix()
  controls.update()
}

function loadModel() {
  if (!scene) return

  loading.value = true
  loadProgress.value = 0
  errorMessage.value = null

  // Remove existing model
  if (currentModel) {
    scene.remove(currentModel)
    currentModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose())
        } else if (mesh.material) {
          mesh.material.dispose()
        }
      }
    })
    currentModel = null
  }

  const url = getResolvedModelUrl()
  const loader = new GLTFLoader()

  loader.load(
    url,
    (gltf) => {
      const model = gltf.scene
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.castShadow = true
          mesh.receiveShadow = true
        }
      })

      applyWireframe(model, isWireframe.value)
      fitCameraToObject(model)

      scene?.add(model)
      currentModel = model
      loading.value = false
    },
    (xhr) => {
      if (xhr.total > 0) {
        loadProgress.value = Math.min(Math.round((xhr.loaded / xhr.total) * 100), 99)
      } else {
        loadProgress.value = 50
      }
    },
    (err) => {
      console.error('Error loading 3D model:', err)
      errorMessage.value = `Failed to load ${props.modelName}.glb (${url})`
      loading.value = false
    }
  )
}

function reloadModel() {
  loadModel()
}

function toggleAutoRotate() {
  isAutoRotating.value = !isAutoRotating.value
  if (controls) {
    controls.autoRotate = isAutoRotating.value
  }
}

function toggleWireframe() {
  isWireframe.value = !isWireframe.value
  if (currentModel) {
    applyWireframe(currentModel, isWireframe.value)
  }
}

function toggleTransparent() {
  transparentBg.value = !transparentBg.value
  if (gridHelper) {
    gridHelper.visible = !transparentBg.value
  }
}

function resetCamera() {
  if (!camera || !controls) return
  camera.position.copy(defaultCameraPos)
  controls.target.copy(defaultTarget)
  controls.update()
}

function toggleFullscreen() {
  fullscreen.value = !fullscreen.value
  setTimeout(() => handleResize(), 50)
}

watch(
  () => [props.modelName, props.modelUrl],
  () => {
    loadModel()
  }
)

watch(
  () => props.autoRotate,
  (val) => {
    isAutoRotating.value = val
    if (controls) controls.autoRotate = val
  }
)

watch(
  () => props.wireframe,
  (val) => {
    isWireframe.value = val
    if (currentModel) applyWireframe(currentModel, val)
  }
)

onMounted(() => {
  initThree()
  loadModel()
})

onUnmounted(() => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  if (controls) {
    controls.dispose()
  }
  if (currentModel && scene) {
    scene.remove(currentModel)
  }
  if (renderer) {
    renderer.dispose()
    renderer.forceContextLoss()
  }
  scene = null
  camera = null
  renderer = null
  controls = null
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
