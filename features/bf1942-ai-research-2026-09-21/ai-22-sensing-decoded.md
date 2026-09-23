# AI-22: BF1942 AI Sensing Model — Decoded

Binary: `bf1942_lnxded.static` (bf1942_lnxded-1.61-patched)
All addresses are 32-bit x86 ELF, symbolised.

---

## 1. The Complete Sensing Pipeline

### 1.1 Tick ordering (reconfirmed)

`GameServer::simulateFrame` → `GameServer::updateAI` (status==Playing) →
`IAIMain::tick(dt)` → `IAIMain::action()` → `AIMain::action()` →
`BotManager::action(budget)` → five phases:

```
actionExecutePlan    0.40 * budget
actionDecisionMaking 0.60 * budget * q_decision
actionPathfinding    0.60 * budget * q_path
actionHearing        0.60 * budget * (1 - q_decision - q_path) * 0.1
actionSensing        0.60 * budget * (1 - q_decision - q_path) * 0.9
```

With vanilla `40 40 20`: sensing gets 10.8%, hearing 1.2% of the 0.60 remainder.

### 1.2 `BotManager::actionSensing` (0x0849b3a0)

**What it does:** priority-queue dispatch of `BotMain::sense(double const&)` across all bots, bounded by the time budget.

**Pseudocode:**

```c
void BotManager::actionSensing(double const& budgetSlice) {
    double elapsed = getTimeIncrease();        // vtable +0x10 on AIMain
    double budget  = elapsed;                  // the slice passed in

    // Build a priority queue of BotInfo* sorted by sensing priority
    // (BotSensingPriorityPred — a min-heap comparator)
    std::vector<BotInfo*> queue = allBots;

    while (!queue.empty() && elapsed < budget) {
        BotInfo* bot = heap_pop_front(queue);  // lowest priority first

        // Type check: skip if not the expected RTTI
        if (!isBotType(bot, expectedType)) {
            skipped_wrong_type++;
            continue;
        }

        // Skip dead/disabled bots
        if (!bot->isAlive()) { skipped_dead++; continue; }

        switch (bot->vehicleType()) {
            case 1:  // infantry
            case 2:  // land vehicle
            case 3:  // air
                bot->sense(elapsed);           // BotMain::sense @ 0x08521cf0
                sensed++;
                break;
            default:
                skipped_other++;
        }
    }

    // Second pass: for bots that were NOT sensed this cycle,
    // accumulate a "time since last sense" counter
    double senseInterval = botCount * senseCostPerBot / budgetSlice;
    for (each unsensed bot) {
        bot->timeSinceLastSense += senseInterval;
        if (bot->timeSinceLastSense < threshold) continue;
        // still skip — the budget is gone
    }
}
```

**Key observations:**
- Bots are sensed in **priority order**, not round-robin. The heap comparator
  (`BotSensingPriorityPred` at 0x0849d360) pops the lowest-priority bot first.
- The function tracks four counters: `skipped_wrong_type`, `skipped_dead`,
  `sensed`, and `skipped_other` (at `BotManager+0x190`/`+0x194`/`+0x198`/`+0x19c`).
- `BotManager+0x90` is the per-bot sense cost multiplier (used at 0x0849b6be as
  `fmull [ecx+0xac]`).

### 1.3 `BotMain::sense(double const&)` (0x08521cf0)

**What it does:** the core vision detection loop. Builds a frustum, queries the
AIInformationGrid, raycasts each candidate, and updates the bot's vision memory.

**Pseudocode:**

```c
void BotMain::sense(double const& dt) {
    // 1. Get the bot's IPlayer and its name
    IPlayer* player = getPlayer();
    std::string playerName = player->getName();

    // 2. Get the camera transformation (eye position + orientation)
    dice::ref2::Mat4 cameraMat = getCameraTransformation();

    // 3. Set the "has sensed this tick" flag
    bool isMobile = testBit(player, 0x80);     // byte +0x06, bit 7
    this->hasSensed = isMobile;                // BotMain+0xf4

    // 4. Skip sensing for certain vehicle types (type field at +0x110)
    switch (this->vehicleType) {               // BotMain+0x110
        case 0: /* fall through — sense */
        case 1: infantry    → sense; break;
        case 2: land vehicle → sense; break;
        case 3: air         → sense; break;
        default: return;
    }

    // 5. Build the vision frustum
    float viewDist = getViewDistance();        // AIPlayer::getViewDistance @ 0x085dd0a0
    float fovAspect = 1.0f;
    float fovFov    = 1000.0f;                 // 0x447a0000 — effectively unbounded
    float fovNear   = -1000.0f;                // 0xc47a0000
    float fovFar    = viewDist;

    // The actual frustum setup call:
    // setupFrustum(fovY, aspect, near, far)
    //   fovY    = viewDist * (hasSensed ? 3 : 1)  scaled through a table
    //   aspect  = 1.0
    //   near    = 0.8                              (0x3f4ccccd)
    //   far     = viewDist
    dice::ref2::Frustum frustum = buildFrustum(cameraMat, viewDist, hasSensed);

    // 6. Query the AIInformationGrid for objects within the frustum
    std::vector<uint32_t> objectIds;
    grid->getInformationWithinFrustum(frustum, objectIds, predicate);

    // 7. For each object in the frustum:
    std::vector<IAIObject*> candidates;
    for (uint32_t id : objectIds) {
        IAIObject* obj = getObject(id);

        // Skip objects already in vision memory (rb-tree lookup at BotMain+0xb0)
        if (visionMemory.find(id) != end()) continue;

        // Check if object is within the frustum with margin
        Vec3 objPos = obj->getPosition();
        if (!frustum.inside(objPos, margin)) continue;

        // Check team: skip friendlies
        if (isFriendly(obj, this)) continue;

        // Raycast: check for line-of-sight blocking
        Vec3 eyePos = cameraMat.translation;
        float maxDist = viewDist * 0.8;          // 0.8 multiplier
        int steps = clamp(maxDist / 0.8, 1, 10); // min 1, max 10 steps

        bool blocked = false;
        for (int i = 0; i < steps; i++) {
            // Raycast from eye toward object
            // dice::bf::ai::World::rayCast (vtable +0x54)
            //   args: from, to, ignoreSelf, stepSize(0.8), result
            bool hit = world->rayCast(eyePos, objPos, ignoreSelf, 0.8f, &result);
            if (hit && result.hitObject != obj) {
                blocked = true;
                break;
            }
        }

        if (blocked) continue;

        // Object is visible — add to candidate list
        candidates.push_back(obj);

        // Update vision memory: add new entry or refresh existing
        if (visionMemory.find(id) == end()) {
            visionMemory[id] = new VisionMemoryObject(obj, currentTime);
        } else {
            visionMemory[id]->lastSeen = currentTime;
            visionMemory[id]->position = obj->getPosition();
        }
    }

    // 8. Sort candidates by distance (closest first)
    //    Store as vector<pair<float, uint32_t>> at BotMain+0x104
    std::vector<pair<float, uint32_t>> sortedByDist;
    for (IAIObject* obj : candidates) {
        float dist = distance(eyePos, obj->getPosition());
        sortedByDist.push_back({dist, obj->getId()});
    }
    sort(sortedByDist);

    // 9. Set the firing target to the closest visible enemy
    if (!sortedByDist.empty()) {
        this->firingTarget     = sortedByDist[0].second;  // BotMain+0x1b4
        this->firingTargetTime = currentTime;              // BotMain+0x1b8
    }

    // 10. Clear the "sensing in progress" flag
    this->sensingInProgress = 0;                  // BotMain+0x110
}
```

---

## 2. Vision Frustum Parameters

### 2.1 `BotMain::getVisionFrustum()` (0x08526bf0 / 0x08526c00)

Trivial accessor — returns the `dice::ref2::Frustum` stored at `BotMain+0xec`.

```c
const Frustum& BotMain::getVisionFrustum() const { return *(Frustum*)(this + 0xec); }
Frustum&       BotMain::getVisionFrustum()       { return *(Frustum*)(this + 0xec); }
```

### 2.2 Frustum construction in `BotMain::sense`

The frustum is built by calling `dice::ref2::Frustum::setupFrustum(float fovY, float aspect, float near, float far)` at **0x08440c70**.

**Arguments pushed (at 0x08521ddb–0x08521dfc):**

| arg | value | source |
|---|---|---|
| `fovY` | `viewDist * (hasSensed ? 3 : 1)` via table at 0x087d0860 | `lea eax,[eax+eax*2]; mov eax,[0x87d0860+eax*8]` |
| `aspect` | `1.0f` (`0x3f800000`) | literal |
| `near` | `0.8f` (`0x3f4ccccd`) | literal at 0x08521de0 |
| `far` | `viewDist` | from `AIPlayer::getViewDistance()` |

**The FOV table at 0x087d0860:**
- Index 0 (not mobile): `viewDist * 1`
- Index 1 (mobile): `viewDist * 3`

This means the frustum's "fovY" parameter is **not an angle in degrees** — it is
a distance value. The `setupFrustum` function at 0x08440c70 uses it as a
half-height at the far plane: `tan(fovY/2) = far * some_factor`. With
`0x86b05e8 = 0.5f` as the base tangent factor, the effective vertical FOV is:

```
fovY_param = viewDist * (hasSensed ? 3 : 1)
halfHeight = fovY_param * 0.5  (the constant at 0x86b05e8)
tan(fovVertical/2) = halfHeight / far
                   = (viewDist * multiplier * 0.5) / viewDist
                   = multiplier * 0.5

For infantry (multiplier=1): tan(fov/2) = 0.5  → fov ≈ 53.1°
For mobile (multiplier=3):   tan(fov/2) = 1.5  → fov ≈ 112.6°
```

**Summary of vision frustum:**

| parameter | infantry | vehicle (mobile) |
|---|---|---|
| **Vertical FOV** | ~53° | ~113° |
| **Aspect ratio** | 1.0 (square) | 1.0 |
| **Near plane** | 0.8m | 0.8m |
| **Far plane** | `getViewDistance()` (default 600, Gazala 300) | same |
| **Horizontal FOV** | ~53° (square frustum) | ~113° |

### 2.3 Blocking check (raycast)

The raycast is performed by `dice::bf::ai::World::rayCast` (vtable +0x54, called
at 0x08522381). The call signature:

```c
bool World::rayCast(Vec3 const& from, Vec3 const& to,
                    int flags, float stepSize, RayCastResult* out);
```

- **`from`**: bot's eye position (camera transform translation)
- **`to`**: candidate object's position
- **`flags`**: `1` (0x08522359 — `push $0x1`)
- **`stepSize`**: `0.8f` (0x3f4ccccd at 0x0852235f)
- **`out`**: result struct

The loop runs `clamp(distance / 0.8, 1, 10)` iterations (at 0x08522255–0x085222a0).
If the ray hits anything that is **not** the target object, the candidate is
marked as blocked and skipped.

---

## 3. Hearing Model

### 3.1 `BotManager::actionHearing` (0x0849aaf0)

**What it does:** iterates all `AIObjectMobile` objects, checks if they fired a
weapon recently, computes distance to each bot, and if within hearing range,
notifies the bot.

**Pseudocode:**

```c
void BotManager::actionHearing(double const& budgetSlice) {
    double elapsed = getTimeIncrease();
    int heardCount = 0;

    // Round-robin counter at BotManager+0xc8
    if (hearingIndex >= mobileObjectCount)
        hearingIndex = 0;

    for (int i = hearingIndex; i < mobileObjectCount; i++) {
        AIObjectMobile* mobile = mobileObjects[i];

        // Skip if the object has no armament
        if (!mobile->hasArmament()) continue;

        // Get the root parent object
        ICompositeObject* root = world->getRootParent(mobile);
        if (!root) continue;

        // Get the AIObjectArmament from the root
        AIObjectArmament* armament = root->getArmament();  // vtable +0x28
        if (!armament) continue;

        // Get parent and team info
        IAIObject* parent = armament->getParent();          // vtable +0x28
        int team4 = parent->getTeam(4);                     // vtable +0x98, arg=4
        int team2 = parent->getTeam(2);                     // vtable +0x98, arg=2
        if (team2 == 0) continue;                           // no team = skip

        // Get the last fired weapon
        Weapon* lastWeapon = armament->getLastFiredWeapon(); // @ 0x085d3010
        if (!lastWeapon) continue;

        // Check if the weapon was fired recently (within 0.5 seconds)
        float lastFireTime = lastWeapon->getLastFireTime();  // vtable +0x6c
        float now = IAITimer::instance->getTime();
        if (now - lastFireTime > 0.5f) continue;            // 0x86c08c8 = 0.5f

        // Get the sound sphere radius
        float soundRadius = mobile->getSoundSphereRadius();  // @ 0x085d5a60
        float soundSquared = soundRadius * soundRadius;
        if (soundSquared <= 0) continue;

        // Get the shooter's position
        Vec3 shooterPos = mobile->getPosition();

        // For each bot, check if within hearing range
        for (BotInfo* bot : bots) {
            Vec3 botPos = bot->getPosition();

            // Skip if same team (team comparison at +0x2c)
            if (bot->getTeam() == shooterTeam) continue;

            // Get the shooter's occupier (for vehicles)
            IPIUnit* occupier = shooter->getOccupier(3);    // vtable +0x98, arg=3
            if (occupier == bot) continue;                   // don't hear yourself

            // Compute squared distance
            float dx = shooterPos.x - botPos.x;
            float dy = shooterPos.y - botPos.y;
            float dz = shooterPos.z - botPos.z;
            float distSq = dx*dx + dy*dy + dz*dz;

            // Check if within sound sphere
            if (distSq > soundSquared) continue;

            // Notify the bot of the sound
            // BotMain::hearSound(shooterId, soundType) or equivalent
            bot->notifySound(shooter, soundType);            // vtable +0x58 / +0x154
        }

        hearingIndex++;
    }
}
```

### 3.2 Hearing parameters

| parameter | value | source |
|---|---|---|
| **Sound detection window** | 0.5 seconds | `0x86c08c8` = `0x3e800000` = 0.5f |
| **Sound sphere radius** | per-object, from `Objects.con` | `AIObjectMobile::getSoundSphereRadius()` |
| **Default soldier sound sphere** | 0.0 / 15.0 (inner/outer) | `Objects/Soldiers/Common/AI/Objects.con`: `setSoundSphereRadius 0.0 15.0` |
| **Hearing probability** | 0.01 / 0.1 (inner/outer) | same file: `setHearingProbability 0.01 0.1` |

The sound model is **binary**: if a weapon was fired within 0.5 seconds and the
bot is within the sound sphere radius, the bot hears it. There is no probability
roll in the hearing phase itself — the probability values from `Objects.con` are
used elsewhere (likely in the decision-making phase).

---

## 4. AIInformationGrid Structure and Query Interface

### 4.1 Data structure

`AIInformationGrid` is a **spatial hash grid** that maps world positions to
`IAIObject` handles.

**Constructor** (0x085cf5c0):
```c
AIInformationGrid::AIInformationGrid(int gridDim, int levels, int something,
                                      Vec2 minBound, Vec2 maxBound);
```

- `gridDim`: dimension from `AISettings::getInformationGridDimension()` (default 32)
- The grid is `gridDim × gridDim` cells
- Each cell is a `std::list<GridCellElem>` (doubly-linked list)
- A `std::map<uint32_t, InfoInfo*>` maps object IDs to their grid info

**`InfoInfo` structure** (from the `s_pool` at 0x087d1648):
```c
struct InfoInfo {
    uint32_t objectId;       // +0x00
    uint32_t typeMask;       // +0x04  (InformationType bits)
    Vec3     position;       // +0x08
    float    radius;         // +0x14
    uint8_t  visited;        // +0x18 (mark during queries)
    // ... padding
};
```

**`GridCellElem`**: a list node containing an `InfoInfo*` pointer.

### 4.2 Key operations

| function | address | purpose |
|---|---|---|
| `addInfo(uint32_t objectId)` | 0x085cf9a0 | Register a new object |
| `removeInfo(uint32_t objectId)` | 0x085cfc00 | Unregister an object |
| `updatePosition(uint32_t objectId)` | 0x085cfda0 | Re-hash after movement |
| `getInformationWithinFrustum(frustum, outVec, predicate)` | 0x085d05c0 | Query by frustum |
| `getInformationWithinCircle(center, radius, outVec, predicate)` | 0x085d0260 | Query by circle |
| `getInformationWithinRectangle(min, max, outVec, predicate)` | 0x085d0af0 | Query by AABB |

### 4.3 `getInformationWithinFrustum` (0x085d05c0)

**Algorithm:**
1. Extract the frustum's 6 planes (each plane = 4 floats: nx, ny, nz, d)
2. Call `getMinMax()` (0x085d0140) to compute the grid cell range that the
   frustum's bounding box covers
3. Iterate all cells in that range
4. For each cell's linked list of `InfoInfo*`:
   - Mark as visited (`info->visited = 1`)
   - Check if the object's position is inside the frustum
     (`Frustum::inside(Vec3, float)` at 0x08532710)
   - If inside, apply the predicate filter (if provided)
   - Add the object ID to the output vector

### 4.4 How objects get into the grid

`BotMain::sense` registers objects via the `addPotentialObstacle` path
(0x0852ceb0), which calls through to the grid. The grid is populated by the
`buildObjectMap()` phase of `BotManager::action()` (called before sensing).

---

## 5. Firing Target Selection

### 5.1 `BotMain::setFiringTarget(uint32_t)` (0x0852ce20)

```c
void BotMain::setFiringTarget(uint32_t targetId) {
    this->firingTarget     = targetId;    // BotMain+0x1b4
    this->firingTargetTime = getTime();   // BotMain+0x1b8
}
```

### 5.2 `BotMain::getFiringTarget()` (0x0852ce90)

```c
uint32_t BotMain::getFiringTarget() const {
    return this->firingTarget;   // BotMain+0x1b4
}
```

### 5.3 `BotMain::getFiringTargetTime()` (0x0852cea0)

```c
float BotMain::getFiringTargetTime() const {
    return this->firingTargetTime;   // BotMain+0x1b8
}
```

### 5.4 How the sensed list becomes a firing target

Inside `BotMain::sense`, after the frustum query and raycast loop:

1. Each visible, non-blocked enemy object is added to a `std::vector<pair<float, uint32_t>>`
   at `BotMain+0x104`. The pair is `{distanceSquared, objectId}`.

2. The vector is sorted by distance (ascending — closest first). The sort uses
   `std::sort` with a `less<pair<float,uint32_t>>` comparator.

3. The **first element** (closest) becomes the firing target:
   ```c
   if (!sortedByDist.empty()) {
       this->firingTarget     = sortedByDist[0].objectId;
       this->firingTargetTime = currentTime;
   }
   ```

4. The `firingTargetTime` is used by the deviation formula in
   `EntryTrigger::execute` (§6.2 of the research doc) to compute how long the
   bot has been tracking the target, which affects aim accuracy.

### 5.5 Vision memory

`BotMain` maintains an `std::map<uint32_t, VisionMemoryObject*>` at `BotMain+0xb0`.
Each entry stores:
- The object's last known position
- The time it was last seen
- Whether it is currently visible

Objects that were previously seen but are no longer visible remain in vision
memory for a period (the "memory" part), allowing the bot to continue moving
toward a target it lost line of sight to.

---

## 6. Summary: The Complete Sensing Pipeline

```
Tick begins
  │
  ├─ BotManager::action(budget)
  │   │
  │   ├─ actionExecutePlan   (40%)  → writes PlayerInput
  │   ├─ actionDecisionMaking (24%) → picks behaviour plan
  │   ├─ actionPathfinding   (24%) → computes paths
  │   ├─ actionHearing       (1.2%) → hears recent weapon fire
  │   │   └─ for each mobile that fired < 0.5s ago:
  │   │       └─ for each bot within soundSphereRadius:
  │   │           └─ notifySound(shooter)
  │   │
  │   └─ actionSensing       (10.8%) → vision detection
  │       └─ priority-queue over bots:
  │           └─ BotMain::sense(dt)
  │               ├─ getCameraTransformation()
  │               ├─ buildFrustum(fovY, 1.0, 0.8, viewDist)
  │               ├─ grid->getInformationWithinFrustum(frustum, ids, pred)
  │               ├─ for each id:
  │               │   ├─ frustum.inside(pos, margin)?
  │               │   ├─ isFriendly? → skip
  │               │   ├─ rayCast(eye, pos, 1, 0.8, &result)
  │               │   │   └─ hit && hitObj != target? → blocked, skip
  │               │   └─ add to visionMemory + candidate list
  │               ├─ sort candidates by distance
  │               └─ setFiringTarget(closest.id)
  │
  └─ simulatePlayersUpdate → consumes buffered actions
```

### Vision frustum parameters

| parameter | infantry | mobile (vehicle) |
|---|---|---|
| Vertical FOV | ~53° | ~113° |
| Horizontal FOV | ~53° | ~113° |
| Near plane | 0.8m | 0.8m |
| Far plane | viewDist (600 default, 300 on Gazala) | same |
| Aspect ratio | 1.0 (square) | 1.0 |

### Hearing model

| parameter | value |
|---|---|
| Detection window | weapon fired within 0.5s |
| Range | per-object `soundSphereRadius` (soldier: 15m outer) |
| Probability | per-object `hearingProbability` (soldier: 0.01 inner, 0.1 outer) |
| Self-filter | shooter's own bots don't hear their own shots |
| Team filter | only enemies hear the sound |

### AIInformationGrid

- **Structure**: 32×32 spatial hash grid (configurable via `setInformationGridDimension`)
- **Cell type**: `std::list<GridCellElem>` where each elem points to an `InfoInfo`
- **Index**: `std::map<uint32_t, InfoInfo*>` for O(log n) lookup by object ID
- **Query methods**: frustum, circle, rectangle — all use `getMinMax` to bound
  the cell range, then iterate and filter
- **Population**: `buildObjectMap()` phase before sensing; `addInfo`/`updatePosition`/`removeInfo` for lifecycle

### Target selection

1. Frustum query → candidate IDs
2. Frustum inside-test + team filter → visible candidates
3. Raycast (10 steps max, 0.8m step) → line-of-sight confirmed
4. Sort by distance (closest first)
5. Closest → `firingTarget` at `BotMain+0x1b4`
6. Timestamp → `firingTargetTime` at `BotMain+0x1b8` (used for deviation)

---

## 7. Key Addresses Reference

| symbol | address | file |
|---|---|---|
| `BotManager::actionSensing` | 0x0849b3a0 | lnxded |
| `BotManager::actionHearing` | 0x0849aaf0 | lnxded |
| `BotMain::sense` | 0x08521cf0 | lnxded |
| `BotMain::getVisionFrustum` (const) | 0x08526bf0 | lnxded |
| `BotMain::getVisionFrustum` (non-const) | 0x08526c00 | lnxded |
| `BotMain::getFiringTarget` | 0x0852ce90 | lnxded |
| `BotMain::getFiringTargetTime` | 0x0852cea0 | lnxded |
| `BotMain::setFiringTarget` | 0x0852ce20 | lnxded |
| `BotMain::getCameraTransformation` | 0x085dcdb0 | lnxded |
| `AIPlayer::getViewDistance` | 0x085dd0a0 | lnxded |
| `AIInformationGrid::getInformationWithinFrustum` | 0x085d05c0 | lnxded |
| `AIInformationGrid::getInformationWithinCircle` | 0x085d0260 | lnxded |
| `AIInformationGrid::getMinMax` | 0x085d0140 | lnxded |
| `AIInformationGrid::addInfo` | 0x085cf9a0 | lnxded |
| `AIInformationGrid::updatePosition` | 0x085cfda0 | lnxded |
| `Frustum::setupFrustum` | 0x08440c70 | lnxded |
| `Frustum::inside` | 0x08532710 | lnxded |
| `World::rayCast` | vtable +0x54 on `dice::bf::ai::World` | lnxded |
| `IAITimer::getTime` | vtable +0x08 on `IAITimer::instance` | lnxded |
| `AIObjectArmament::getLastFiredWeapon` | 0x085d3010 | lnxded |
| `AIObjectMobile::getSoundSphereRadius` | 0x085d5a60 | lnxded |
| `BotMain+0xec` | vision frustum storage | struct offset |
| `BotMain+0xb0` | vision memory (rb-tree) | struct offset |
| `BotMain+0x104` | sorted candidate list | struct offset |
| `BotMain+0x1b4` | firing target ID | struct offset |
| `BotMain+0x1b8` | firing target time | struct offset |
| `0x86b05e8` | frustum tangent factor = 0.5 | rodata |
| `0x86b01b4` | raycast step size = 0.8 | rodata |
| `0x86c08c8` | hearing time window = 0.5s | rodata |
| `0x86b1ca8` | frustum far default = 1000.0 | rodata |
| `0x86b1cac` | frustum near default = -1000.0 | rodata |
| `0x87d0860` | FOV multiplier table (index 0→1, index 1→3) | bss |
