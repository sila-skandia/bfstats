<template>
  <div class="min-h-screen bg-stone-950 text-stone-100 py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto font-sans">
    <!-- Header -->
    <div class="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-stone-800/80 pb-6">
      <div>
        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider uppercase mb-3">
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Refractor Engine 3D Archive
        </div>
        <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight text-white flex items-center gap-3">
          Armoury
          <span class="text-xs font-mono font-normal px-2 py-0.5 rounded bg-stone-800 text-stone-400 border border-stone-700">WebGL 2.0</span>
        </h1>
        <p class="mt-2 text-sm text-stone-400 max-w-2xl">
          Real-time interactive 3D vehicle models extracted directly from Battlefield 1942 StandardMesh archives and reconstructed with original wartime textures.
        </p>
      </div>

      <!-- Filter Categories -->
      <div class="flex items-center gap-1.5 bg-stone-900/80 p-1 rounded-lg border border-stone-800 self-start md:self-auto">
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          class="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
          :class="selectedCategory === cat.id ? 'bg-amber-500 text-stone-950 font-semibold shadow-sm' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'"
          @click="selectedCategory = cat.id"
        >
          {{ cat.name }}
        </button>
      </div>
    </div>

    <!-- Main Layout: 3D Stage + Vehicle Details -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Left Column: 3D Model Stage (7 cols) -->
      <div class="lg:col-span-7 flex flex-col gap-4">
        <!-- 3D Viewer Container -->
        <div class="relative bg-stone-900/50 border border-stone-800/80 rounded-2xl p-2 shadow-2xl backdrop-blur-sm">
          <BfModelViewer
            :model-name="activeVehicle.modelId"
            height="500px"
            :auto-rotate="autoRotate"
          />

          <!-- Model Switcher Ribbon Below Canvas -->
          <div class="p-3 bg-stone-900/90 rounded-xl mt-2 border border-stone-800/60 flex items-center gap-2 overflow-x-auto">
            <button
              v-for="v in filteredVehicles"
              :key="v.id"
              type="button"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all border"
              :class="
                activeVehicle.id === v.id
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                  : 'bg-stone-950/60 text-stone-400 border-stone-800 hover:text-stone-200 hover:border-stone-700'
              "
              @click="selectVehicle(v)"
            >
              <span class="w-2 h-2 rounded-full" :class="v.faction === 'Allies' ? 'bg-blue-400' : 'bg-red-400'" />
              <span>{{ v.shortName }}</span>
              <span class="text-[10px] font-mono px-1 py-0.2 rounded bg-stone-800/90 text-stone-400 uppercase">
                {{ v.classTag }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Right Column: Vehicle Dossier & Technical Specs (5 cols) -->
      <div class="lg:col-span-5 flex flex-col gap-6">
        <!-- Header & Faction Card -->
        <div class="bg-stone-900/60 border border-stone-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div
            class="absolute top-0 right-0 w-32 h-32 opacity-10 rounded-bl-full pointer-events-none"
            :class="activeVehicle.faction === 'Allies' ? 'bg-blue-500' : 'bg-red-500'"
          />

          <div class="flex items-center justify-between mb-3">
            <span
              class="px-2.5 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase border"
              :class="
                activeVehicle.faction === 'Allies'
                  ? 'bg-blue-950/50 text-blue-300 border-blue-700/50'
                  : 'bg-red-950/50 text-red-300 border-red-700/50'
              "
            >
              {{ activeVehicle.faction }} · {{ activeVehicle.nation }}
            </span>
            <span class="text-xs font-mono text-stone-400">{{ activeVehicle.modelId }}.glb</span>
          </div>

          <h2 class="text-2xl font-bold tracking-tight text-white mb-2">
            {{ activeVehicle.name }}
          </h2>
          <p class="text-sm text-stone-300 leading-relaxed">
            {{ activeVehicle.description }}
          </p>
        </div>

        <!-- Technical Specification Matrix -->
        <div class="bg-stone-900/60 border border-stone-800/80 rounded-2xl p-6 shadow-xl">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-4 flex items-center gap-2">
            <svg class="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            Combat Specifications
          </h3>

          <div class="grid grid-cols-2 gap-4">
            <div class="bg-stone-950/60 p-3.5 rounded-xl border border-stone-800/70">
              <span class="text-[11px] text-stone-400 block mb-1">Max Speed</span>
              <span class="text-lg font-bold font-mono text-white">{{ activeVehicle.specs.speed }}</span>
            </div>
            <div class="bg-stone-950/60 p-3.5 rounded-xl border border-stone-800/70">
              <span class="text-[11px] text-stone-400 block mb-1">Crew Capacity</span>
              <span class="text-lg font-bold font-mono text-white">{{ activeVehicle.specs.crew }}</span>
            </div>
            <div class="bg-stone-950/60 p-3.5 rounded-xl border border-stone-800/70">
              <span class="text-[11px] text-stone-400 block mb-1">Primary Armament</span>
              <span class="text-sm font-semibold text-white block mt-0.5">{{ activeVehicle.specs.primaryWeapon }}</span>
            </div>
            <div class="bg-stone-950/60 p-3.5 rounded-xl border border-stone-800/70">
              <span class="text-[11px] text-stone-400 block mb-1">Secondary / Coaxial</span>
              <span class="text-sm font-semibold text-white block mt-0.5">{{ activeVehicle.specs.secondaryWeapon }}</span>
            </div>
          </div>

          <!-- Extra Lore Note -->
          <div class="mt-4 pt-4 border-t border-stone-800/60 flex items-start gap-2.5 text-xs text-stone-400">
            <svg class="w-4 h-4 text-amber-400/80 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{{ activeVehicle.tacticalTip }}</span>
          </div>
        </div>

        <!-- Engine Geometry Details -->
        <div class="bg-stone-900/40 border border-stone-800/60 rounded-2xl p-4 text-xs font-mono text-stone-400 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Format: binary glTF 2.0 (.glb)</span>
          </div>
          <span class="text-stone-400">LOD0 StandardMesh</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BfModelViewer from '@/components/3d/BfModelViewer.vue'

interface VehicleSpecs {
  speed: string
  crew: string
  primaryWeapon: string
  secondaryWeapon: string
}

interface Vehicle {
  id: string
  modelId: string
  shortName: string
  name: string
  classTag: string
  category: 'armor' | 'air' | 'recon'
  faction: 'Allies' | 'Axis'
  nation: string
  description: string
  tacticalTip: string
  specs: VehicleSpecs
}

const categories = [
  { id: 'all', name: 'All Vehicles' },
  { id: 'armor', name: 'Armor' },
  { id: 'air', name: 'Aviation' },
  { id: 'recon', name: 'Recon & Light' },
]

const selectedCategory = ref('all')
const autoRotate = ref(true)

const vehicles: Vehicle[] = [
  {
    id: 'tiger',
    modelId: 'tiger',
    shortName: 'Tiger I',
    name: 'Panzerkampfwagen VI Ausf. E (Tiger I)',
    classTag: 'Heavy Tank',
    category: 'armor',
    faction: 'Axis',
    nation: 'Germany',
    description:
      'The fearsome heavy tank of the German Wehrmacht. Armed with the high-velocity 8.8 cm KwK 36 cannon and thick frontal armor plates, it reigned supreme over open combat theatres like Kursk, El Alamein, and Bocage.',
    tacticalTip:
      'Keep your front angled toward enemy armor to deflect incoming anti-tank rounds. Watch out for flankers targeting rear engine ventilation.',
    specs: {
      speed: '38 km/h',
      crew: '2 Soldiers (Driver/Gunner, MG)',
      primaryWeapon: '8.8 cm KwK 36 L/56 (AP/HE)',
      secondaryWeapon: '7.92mm MG34 Coaxial & Hull',
    },
  },
  {
    id: 'sherman',
    modelId: 'sherman',
    shortName: 'M4 Sherman',
    name: 'M4A1 Sherman Medium Tank',
    classTag: 'Medium Tank',
    category: 'armor',
    faction: 'Allies',
    nation: 'United States / UK',
    description:
      'The indispensable backbone of the Allied armored spearhead. Combining solid maneuverability, a fast-reloading 75mm main gun, and a roof-mounted .50 caliber heavy machine gun capable of shredding infantry and strafing aircraft.',
    tacticalTip:
      'Use mobility and terrain folds to out-maneuver heavy panzers. Coordinate with friendly infantry to cover anti-tank flank attacks.',
    specs: {
      speed: '40 km/h',
      crew: '2 Soldiers (Driver/Gunner, Top MG)',
      primaryWeapon: '75mm M3 Gun',
      secondaryWeapon: '.50 cal Browning M2HB & .30 cal',
    },
  },
  {
    id: 'spitfire',
    modelId: 'spitfire',
    shortName: 'Spitfire',
    name: 'Supermarine Spitfire Mk.Vb',
    classTag: 'Fighter',
    category: 'air',
    faction: 'Allies',
    nation: 'Great Britain',
    description:
      'The legendary British single-seat interceptor aircraft that won the Battle of Britain. Renowned for its elliptical wings, agile roll rate, twin 20mm Hispano cannons, and high-altitude dogfighting prowess.',
    tacticalTip:
      'Superior turn radius allows you to out-turn Axis Bf 109s in sustained horizontal dogfights. Conserve 20mm cannon bursts for close-range deflection shots.',
    specs: {
      speed: '605 km/h',
      crew: '1 Pilot',
      primaryWeapon: '2x 20mm Hispano Mk II Cannons',
      secondaryWeapon: '4x .303 Browning MGs + 250lb Bomb',
    },
  },
  {
    id: 'b17',
    modelId: 'b17',
    shortName: 'B-17 Bomber',
    name: 'Boeing B-17 Flying Fortress',
    classTag: 'Heavy Bomber',
    category: 'air',
    faction: 'Allies',
    nation: 'United States',
    description:
      'Four-engine heavy strategic bomber capable of delivering devastating ordnance on enemy naval vessels, bunkers, and forward operating bases while protecting itself with multiple defensive machine gun turrets.',
    tacticalTip:
      'Fly at high altitude across enemy air corridors and line up bomb spreads over clustered capture points or anchored aircraft carriers.',
    specs: {
      speed: '462 km/h',
      crew: '4+ (Pilot/Bombardier, 3x Gunners)',
      primaryWeapon: '8x 500lb Heavy High Explosive Bombs',
      secondaryWeapon: 'Top, Belly Ball & Tail .50 BMG Turrets',
    },
  },
  {
    id: 'willy',
    modelId: 'willy',
    shortName: 'Willys Jeep',
    name: 'Willys MB 1/4-Ton 4x4 Scout Vehicle',
    classTag: 'Recon 4x4',
    category: 'recon',
    faction: 'Allies',
    nation: 'United States / Allied',
    description:
      'The beloved four-wheel-drive light scout runabout. Blazing fast, rugged, and agile, the Willys Jeep is the ideal vehicle for rapid flag captures, tactical flanking, and ferrying comrades across vast battlegrounds.',
    tacticalTip:
      'Capitalize on high acceleration to rush contested neutral flags at round start. Highly vulnerable to explosive rounds and tanks.',
    specs: {
      speed: '105 km/h',
      crew: '2 Soldiers (Driver, Passenger)',
      primaryWeapon: 'Vehicle Ramming',
      secondaryWeapon: 'Passenger Handheld Firearms',
    },
  },
]

const activeVehicle = ref<Vehicle>(vehicles[0])

const filteredVehicles = computed(() => {
  if (selectedCategory.value === 'all') return vehicles
  return vehicles.filter((v) => v.category === selectedCategory.value)
})

function selectVehicle(v: Vehicle) {
  activeVehicle.value = v
}
</script>
