// The model browser's armour view: the collision hulls coloured by how
// vulnerable each region is (or by what the chosen weapon does to it, from
// the MaterialManager tables in damage.json), the weapon picker, and the shot
// placed on a face with its angle, range and hit-point readout. Lifted out of
// index.html (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `camera`, `controls`, `current`, `framing`, `invalidate`, `main`,
 * `MODELS_BASE`, `renderer`, `renderHints`, `scene`, `syncRange`.
 */
export async function createArmourInspector(page) {
  const armour = {
    // Whether the view is on, for the stage hints. `setCollision` changes it.
    get collision() { return state.collision; },
  };

  // Whether the armour view is on, and the one material it isolates.
  const state = {
    collision: false,
    collisionMaterial: null,
  };

  const collisionRoots = [];
  const collisionTargets = [];
  armour.lastHit = null;
  armour.hitState = null;
  armour.angleDragging = false;
  armour.angleDragStart = null;

  // Critical to protected, in Neutral Depth's numeric tints: kill, busy, khaki,
  // olive, poor grey. The .ramp swatches in the Armour panel mirror these.
  const vulnerabilityStops = [
    new THREE.Color(0xd65a5a),
    new THREE.Color(0xc5a23a),
    new THREE.Color(0x8a8a6a),
    new THREE.Color(0x7d8849),
    new THREE.Color(0x6a6a6a),
  ];
  const collisionStyles = new Map();
  const hitMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  const hitNormal = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(),
    1,
    0xffffff,
  );
  const shotArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(),
    1,
    0xc5a23a,
  );
  const shotShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0xc5a23a, depthTest: false }),
  );
  const angleHandle = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xc5a23a, depthTest: false }),
  );
  const angleArc = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xc5a23a, depthTest: false }),
  );
  hitMarker.renderOrder = 100;
  for (const arrow of [hitNormal, shotArrow]) {
    arrow.line.material.depthTest = false;
    arrow.cone.material.depthTest = false;
    arrow.line.renderOrder = 100;
    arrow.cone.renderOrder = 100;
  }
  angleHandle.renderOrder = 101;
  shotShaft.renderOrder = 100;
  angleArc.renderOrder = 100;
  hitMarker.visible = false;
  hitNormal.visible = false;
  shotArrow.visible = false;
  shotShaft.visible = false;
  angleHandle.visible = false;
  angleArc.visible = false;
  page.scene.add(hitMarker, hitNormal, shotArrow, shotShaft, angleHandle, angleArc);

  const collisionCheckbox = document.getElementById('collision');
  const collisionLegend = document.getElementById('collision-legend');
  const legendMaterials = document.getElementById('legend-materials');
  const weaponSelect = document.getElementById('weapon');
  const weaponSummary = document.getElementById('weapon-summary');
  const isCollisionMesh = obj => obj.isMesh && obj.geometry?.userData?.collision;

  // The MaterialManager tables out of Game.rfa, written by the extractor as
  // damage.json. Direct damage is materialDamage(att) * damageMod(att, def) *
  // cos(angle) * distanceMod; splash swaps in material2 and a radius term. A
  // pair with no damageMod entry is one the engine ignores entirely.
  const damageTables = await fetch(`${page.MODELS_BASE}/damage.json?t=${Date.now()}`)
    .then(response => (response.ok ? response.json() : null))
    .catch(() => null);
  const weaponsByName = new Map(
    (damageTables?.weapons || []).map(weapon => [weapon.name.toLowerCase(), weapon]),
  );

  armour.currentReport = null;
  const damageState = { weapon: null, distance: 0 };

  function attGroup(material) {
    return damageTables?.materials?.[material]?.attGroup ?? material;
  }

  function defGroup(material) {
    return damageTables?.materials?.[material]?.defGroup ?? material;
  }

  function baseDamage(material) {
    const defined = damageTables?.materials?.[material];
    return defined ? defined.damage : null;
  }

  function damageMod(attMaterial, defMaterial) {
    if (attMaterial == null || defMaterial == null) return null;
    const value = damageTables?.modifiers?.[attGroup(attMaterial)]?.[defGroup(defMaterial)];
    return value === undefined ? null : value;
  }

  function distanceMod(weapon, distance) {
    if (!weapon || weapon.minDamage == null || weapon.distToStartLoseDamage == null
        || weapon.distToMinDamage == null) return 1;
    if (distance <= weapon.distToStartLoseDamage) return 1;
    if (distance >= weapon.distToMinDamage
        || weapon.distToMinDamage <= weapon.distToStartLoseDamage) return weapon.minDamage;
    const span = weapon.distToMinDamage - weapon.distToStartLoseDamage;
    return weapon.minDamage + (1 - weapon.minDamage) * (weapon.distToMinDamage - distance) / span;
  }

  function hasDistanceFalloff(weapon) {
    return Boolean(weapon && weapon.minDamage != null && weapon.distToMinDamage != null);
  }

  function headOnFor(weapon, material) {
    if (!weapon || weapon.material == null || material == null) return null;
    const base = baseDamage(weapon.material);
    const mod = damageMod(weapon.material, material);
    if (base == null || mod == null) return null;
    return base * mod;
  }

  // Head-on direct damage of the selected weapon against a collision material,
  // or null when the table has no entry (the round does nothing to that face).
  function headOnDamage(material) {
    return headOnFor(damageState.weapon, material);
  }

  function splashAtCentre(report) {
    const weapon = damageState.weapon;
    const splashMaterial = report?.armor?.splashMaterial;
    if (!weapon || weapon.material2 == null || splashMaterial == null) return null;
    const base = baseDamage(weapon.material2);
    const mod = damageMod(weapon.material2, splashMaterial);
    if (base == null || mod == null) return null;
    return base * mod;
  }

  function shotsFor(hitpoints, perShot) {
    if (!(perShot > 0) || !(hitpoints > 0)) return null;
    return Math.ceil(hitpoints / perShot - 1e-9);
  }

  function formatHp(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function weaponLabel(weapon) {
    return weapon.owner && weapon.owner.toLowerCase() !== weapon.name.toLowerCase()
      ? `${weapon.owner} · ${weapon.name}`
      : weapon.name;
  }

  function buildWeaponSelect(entry) {
    const previous = damageState.weapon?.name;
    weaponSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = damageTables ? 'none (relative ranking)' : 'no damage tables extracted';
    weaponSelect.appendChild(none);
    weaponSelect.disabled = !damageTables;
    if (!damageTables) return;

    const own = new Set((entry?.weapons || []).map(name => name.toLowerCase()));
    const groups = new Map();
    if (own.size) groups.set('this vehicle', []);
    for (const weapon of damageTables.weapons) {
      if (weapon.material == null) continue;
      const key = own.has(weapon.name.toLowerCase()) ? 'this vehicle' : weapon.category;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(weapon);
    }
    for (const [label, weapons] of groups) {
      if (!weapons.length) continue;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const weapon of weapons) {
        const option = document.createElement('option');
        option.value = weapon.name;
        option.textContent = weaponLabel(weapon);
        group.appendChild(option);
      }
      weaponSelect.appendChild(group);
    }
    weaponSelect.value = previous && weaponsByName.has(previous.toLowerCase()) ? previous : '';
    if (!weaponSelect.value) damageState.weapon = null;
  }

  function renderWeaponSummary() {
    const weapon = damageState.weapon;
    if (!weapon) {
      weaponSummary.innerHTML = '';
      return;
    }
    const base = baseDamage(weapon.material);
    const label = damageTables.materials?.[weapon.material]?.label;
    const parts = [
      `<strong>${weapon.projectile}</strong> material ${weapon.material}` +
        (label ? ` (${label})` : '') +
        (base != null ? `, base damage ${formatHp(base)}` : ', base damage undefined'),
    ];
    if (weapon.material2 != null) {
      const splashBase = baseDamage(weapon.material2);
      parts.push(`splash material ${weapon.material2}` +
        (splashBase != null ? `, base ${formatHp(splashBase)}` : '') +
        (weapon.radius != null ? `, radius ${weapon.radius} m` : ''));
    }
    if (hasDistanceFalloff(weapon)) {
      parts.push(`falls to ${Math.round(weapon.minDamage * 100)}% between ` +
        `${weapon.distToStartLoseDamage} m and ${weapon.distToMinDamage} m`);
    }
    weaponSummary.innerHTML = parts.join('<br>');
  }

  function setWeapon(name) {
    const weapon = name ? weaponsByName.get(String(name).toLowerCase()) || null : null;
    damageState.weapon = weapon;
    damageState.distance = 0;
    weaponSelect.value = weapon ? weapon.name : '';
    renderWeaponSummary();
    if (armour.currentReport) {
      configureCollisionLegend(armour.currentReport);
      applyCollisionState();
    }
    if (armour.lastHit) renderHitPanel();
    page.invalidate();
  }

  weaponSelect.addEventListener('change', () => setWeapon(weaponSelect.value));


  function clearHit() {
    armour.lastHit = null;
    armour.hitState = null;
    armour.angleDragging = false;
    armour.angleDragStart = null;
    page.controls.enabled = true;
    page.main.dataset.angleDrag = 'false';
    hitMarker.visible = false;
    hitNormal.visible = false;
    shotArrow.visible = false;
    shotShaft.visible = false;
    angleHandle.visible = false;
    angleArc.visible = false;
    document.getElementById('hit-details').innerHTML =
      '<div class="empty">No collision face selected.</div>';
    page.invalidate();
  }

  function collisionMaterialClass(material) {
    if (material >= 40 && material <= 42) return 'soldier hit region';
    if (material >= 43 && material <= 47) return 'light armour or structure';
    if (material >= 50 && material <= 54) return 'tank armour';
    if (material >= 55 && material <= 59) return 'naval armour';
    if (material >= 60 && material <= 62) return 'aircraft region';
    if (material === 66) return 'wooden deck';
    return 'other collision surface';
  }

  function isRankedArmorMaterial(material) {
    return (material >= 40 && material <= 47)
      || (material >= 50 && material <= 62)
      || material === 66;
  }

  function vulnerabilityColor(position) {
    const scaled = THREE.MathUtils.clamp(position, 0, 1) * (vulnerabilityStops.length - 1);
    const lower = Math.floor(scaled);
    const upper = Math.min(lower + 1, vulnerabilityStops.length - 1);
    return vulnerabilityStops[lower].clone().lerp(
      vulnerabilityStops[upper],
      scaled - lower,
    );
  }

  function configureCollisionLegend(report) {
    state.collisionMaterial = null;
    collisionStyles.clear();
    const allMaterials = [...new Set(report.collisionMaterials || [])]
      .sort((a, b) => a - b);
    const weapon = damageState.weapon;
    const legendHint = document.getElementById('legend-hint');
    const note = document.getElementById('collision-note');

    if (weapon) {
      // Rank by what this round actually does to each face. Equal damage gets
      // equal colour, and a face with no table entry is immune to it.
      const damages = new Map(allMaterials.map(material => [material, headOnDamage(material)]));
      const distinct = [...new Set([...damages.values()].filter(value => value > 0))]
        .sort((a, b) => b - a);
      for (const material of allMaterials) {
        const damage = damages.get(material);
        if (damage == null || !(damage > 0)) {
          collisionStyles.set(material, {
            color: new THREE.Color(0x444444),
            label: damage == null
              ? `No ${weapon.name} entry (immune)`
              : `${weapon.name} is tabled at 0 HP here`,
            damage,
            immune: true,
          });
          continue;
        }
        const position = distinct.length === 1 ? 0 : distinct.indexOf(damage) / (distinct.length - 1);
        collisionStyles.set(material, {
          color: vulnerabilityColor(position),
          label: `${formatHp(damage)} HP head-on from ${weapon.name}`,
          damage,
          immune: false,
        });
      }
      if (legendHint) legendHint.textContent = 'Chips show head-on damage per hit. Select a material to isolate it.';
      if (note) note.textContent = `Colours rank each region by ${weapon.name} damage from the MaterialManager tables. Click a region for the shot.`;
    } else {
      const materials = allMaterials
        .filter(isRankedArmorMaterial)
        .sort((a, b) => a - b);
      materials.forEach((material, index) => {
        const position = materials.length === 1 ? 0 : index / (materials.length - 1);
        collisionStyles.set(material, {
          color: vulnerabilityColor(position),
          label: materials.length === 1
            ? 'Only classified armour region'
            : index === 0
              ? 'Most vulnerable region'
              : index === materials.length - 1
                ? 'Most protected region'
                : 'Intermediate armour region',
        });
      });
      for (const material of allMaterials.filter(id => !isRankedArmorMaterial(id))) {
        collisionStyles.set(material, {
          color: new THREE.Color(0x444444),
          label: 'Unclassified collision region',
        });
      }
      if (legendHint) legendHint.textContent = 'Select a material to isolate it; select it again to show all.';
      if (note) {
        note.textContent = 'Colours show inferred relative protection. Pick a weapon to colour by its '
          + 'actual damage table. Click a region, then drag the shot arrow or use the angle control.';
      }
    }

    for (const obj of collisionTargets) {
      const materialId = obj.geometry.userData.defenseMaterial;
      const color = collisionStyles.get(materialId)?.color || new THREE.Color(0x444444);
      for (const material of [obj.material].flat()) {
        material.color.copy(color);
        if (material.emissive) material.emissive.copy(color).multiplyScalar(.12);
        material.needsUpdate = true;
      }
    }

    legendMaterials.innerHTML = allMaterials.length
      ? allMaterials.map(material => {
        const style = collisionStyles.get(material);
        let suffix = '';
        if (weapon) {
          suffix = style.damage == null
            ? ' <small>immune</small>'
            : ` <small>${formatHp(style.damage)} HP</small>`;
        } else if (!isRankedArmorMaterial(material)) {
          suffix = ' unclassified';
        }
        const immune = weapon && style.immune ? ' data-immune="true"' : '';
        return `<button type="button" class="material-chip" data-material="${material}"${immune} ` +
          `aria-pressed="false" title="${style.label} · ${collisionMaterialClass(material)}" ` +
          `style="--chip:#${style.color.getHexString()}"><i></i>${material}${suffix}</button>`;
      }).join('')
      : '<span class="collision-note">No ranked armour materials.</span>';
  }

  function applyCollisionState() {
    for (const root of collisionRoots) {
      root.visible = state.collision;
    }
    for (const target of collisionTargets) {
      target.visible = state.collision
        && (state.collisionMaterial === null
          || target.geometry.userData.defenseMaterial === state.collisionMaterial);
    }
    for (const button of legendMaterials.querySelectorAll('[data-material]')) {
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.material) === state.collisionMaterial),
      );
    }
    legendMaterials.dataset.filtered = String(state.collisionMaterial !== null);
    page.main.dataset.collision = String(state.collision);
    collisionLegend.hidden = !state.collision || !collisionRoots.length;
    if (!state.collision) clearHit();
    page.renderHints();
  }

  function setCollisionMaterial(material) {
    state.collisionMaterial = material === null ? null : Number(material);
    clearHit();
    applyCollisionState();
    page.invalidate();
  }

  function collectCollisions(root, report) {
    clearHit();
    collisionRoots.length = 0;
    collisionTargets.length = 0;
    root.traverse(node => {
      if (!node.userData?.collision) return;
      collisionRoots.push(node);
      node.traverse(obj => {
        if (!isCollisionMesh(obj)) return;
        obj.userData.collisionRoot = node;
        obj.renderOrder = 20;
        for (const material of [obj.material].flat()) {
          material.transparent = true;
          material.opacity = .58;
          material.depthWrite = false;
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        }
        collisionTargets.push(obj);
      });
    });
    collisionCheckbox.disabled = !collisionRoots.length;
    if (!collisionRoots.length) state.collision = false;
    collisionCheckbox.checked = state.collision;
    configureCollisionLegend(report);
    applyCollisionState();
  }

  // Everything the tables say about the selected weapon hitting the selected face,
  // at the current angle and distance. `direct` is null when the pair has no entry.
  function computeHitDamage() {
    if (!armour.lastHit) return null;
    const weapon = damageState.weapon;
    const report = armour.currentReport;
    if (!weapon || !report) return null;
    const base = baseDamage(weapon.material);
    const mod = damageMod(weapon.material, armour.lastHit.material);
    const angleFactor = armour.lastHit.angleFactor;
    const distance = distanceMod(weapon, damageState.distance);
    const headOn = base != null && mod != null ? base * mod : null;
    const direct = headOn == null ? null : headOn * angleFactor * distance;
    const hitpoints = report.armor?.hitpoints ?? report.armor?.maxHitpoints ?? null;
    const critical = report.armor?.criticalDamage ?? null;
    const splash = splashAtCentre(report);
    return {
      weapon: weapon.name,
      projectile: weapon.projectile,
      attMaterial: weapon.material,
      defMaterial: armour.lastHit.material,
      base,
      mod,
      angleFactor,
      distanceMod: distance,
      headOn,
      direct,
      hitpoints,
      critical,
      shotsToDestroy: hitpoints != null ? shotsFor(hitpoints, direct) : null,
      shotsToCritical: hitpoints != null && critical != null
        ? shotsFor(hitpoints - critical, direct) : null,
      splashAtCentre: splash,
      splashMaterial: report.armor?.splashMaterial ?? null,
      splashRadius: weapon.radius ?? null,
    };
  }

  function updateHitPanel() {
    if (!armour.lastHit) return;
    const angle = Math.abs(armour.lastHit.angle);
    const multiplier = armour.lastHit.angleFactor;
    const output = document.getElementById('angle-output');
    const range = document.getElementById('angle-range');
    const reading = document.getElementById('impact-value');
    const label = document.getElementById('impact-label');
    const basis = document.getElementById('damage-basis');
    const formula = document.getElementById('impact-formula');
    const hpLoss = document.getElementById('hp-loss');
    const hpNote = document.getElementById('hp-note');
    if (output) output.value = `${angle.toFixed(1)}°`;
    if (range) {
      range.value = String(angle);
      page.syncRange(range);
    }

    const damage = computeHitDamage();
    armour.lastHit.damage = damage;
    if (!damage) {
      if (reading) reading.textContent = `${(multiplier * 100).toFixed(1)}%`;
      if (label) label.textContent = 'Damage';
      if (basis) basis.textContent = 'of this region\u2019s head-on damage';
      if (hpLoss) {
        hpLoss.className = 'hp-loss';
        hpLoss.innerHTML = '<span>HP loss</span><span>select a weapon</span>';
      }
      if (hpNote) {
        hpNote.textContent = damageTables
          ? 'Pick a weapon above to turn this into hit points.'
          : 'Run the extractor with Game.rfa in the mod chain to get the damage tables.';
      }
      if (formula) {
        formula.textContent =
          `cos(${angle.toFixed(1)}°) = ${multiplier.toFixed(3)}. ` +
          'Orange is the shot path; white is the surface normal.';
      }
      return;
    }

    if (damage.direct == null || !(damage.headOn > 0)) {
      const noEntry = damage.direct == null;
      if (reading) reading.textContent = '0';
      if (label) label.textContent = 'HP';
      if (basis) {
        basis.textContent = noEntry
          ? `${damage.weapon} has no entry against material ${damage.defMaterial}`
          : `${damage.weapon} is tabled at zero against material ${damage.defMaterial}`;
      }
      if (hpLoss) {
        hpLoss.className = 'hp-loss hp-loss-immune';
        hpLoss.innerHTML = '<span>HP loss</span><span>immune</span>';
      }
      if (hpNote) {
        hpNote.textContent = noEntry
          ? 'No damageMod for this attack/defence pair; the engine applies nothing.'
          : `damageMod ${damage.mod} for this pair, so no angle or range changes it.`;
      }
      if (formula) {
        formula.textContent = noEntry
          ? `attGroup ${attGroup(damage.attMaterial)} x defGroup ${defGroup(damage.defMaterial)}: no damageMod.`
          : `${formatHp(damage.base)} materialDamage x ${damage.mod} damageMod`
            + ` (att ${attGroup(damage.attMaterial)} vs def ${defGroup(damage.defMaterial)}) = 0 HP`;
      }
      return;
    }

    const hp = damage.hitpoints;
    if (reading) reading.textContent = formatHp(damage.direct);
    if (label) label.textContent = hp != null ? `HP of ${formatHp(hp)}` : 'HP';
    if (basis) {
      basis.textContent = `${formatHp(damage.headOn)} head-on x cos(${angle.toFixed(1)}°)`
        + (damage.distanceMod !== 1 ? ` x ${damage.distanceMod.toFixed(3)} range` : '');
    }
    if (hpLoss) {
      const lethal = hp != null && damage.direct >= hp - 1e-9;
      hpLoss.className = `hp-loss ${lethal ? 'hp-loss-lethal' : 'hp-loss-known'}`;
      const rows = [];
      if (hp != null) {
        rows.push(['shots to destroy', lethal ? '1' : String(damage.shotsToDestroy)]);
        if (damage.critical != null) {
          rows.push(['shots to critical', damage.shotsToCritical == null ? '0' : String(damage.shotsToCritical)]);
        }
      } else {
        rows.push(['hit points', 'not declared']);
      }
      hpLoss.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    }
    if (hpNote) {
      const bits = [];
      if (damage.critical != null) {
        bits.push(`Critical at ${formatHp(damage.critical)} HP, then ${formatHp(armour.currentReport.armor?.hpLostWhileCriticalDamage ?? 0)} HP/s burns.`);
      }
      if (damage.splashAtCentre != null) {
        bits.push(`Splash at centre ${formatHp(damage.splashAtCentre)} HP against splash material ${damage.splashMaterial}`
          + (damage.splashRadius != null ? `, falling to 0 at ${damage.splashRadius} m.` : '.'));
      } else if (damage.splashMaterial != null && damageState.weapon.material2 != null) {
        bits.push(`No splash entry against material ${damage.splashMaterial}.`);
      }
      hpNote.textContent = bits.join(' ');
    }
    if (formula) {
      formula.textContent =
        `${formatHp(damage.base)} materialDamage x ${damage.mod} damageMod`
        + ` (att ${attGroup(damage.attMaterial)} vs def ${defGroup(damage.defMaterial)})`
        + ` x cos(${angle.toFixed(1)}°) = ${multiplier.toFixed(3)}`
        + (damage.distanceMod !== 1 ? ` x ${damage.distanceMod.toFixed(3)}` : '')
        + ` = ${damage.direct.toFixed(2)} HP`;
    }
  }

  function setHitAngle(signedDegrees) {
    if (!armour.hitState || !armour.lastHit) return;
    const angle = THREE.MathUtils.clamp(signedDegrees, -85, 85);
    const radians = THREE.MathUtils.degToRad(angle);
    const sourceDirection = armour.hitState.normal.clone()
      .multiplyScalar(Math.cos(radians))
      .addScaledVector(armour.hitState.tangent, Math.sin(radians))
      .normalize();
    const incoming = sourceDirection.clone().negate();
    const tail = armour.hitState.point.clone()
      .addScaledVector(sourceDirection, armour.hitState.arrowLength);

    shotArrow.position.copy(tail);
    shotArrow.setDirection(incoming);
    shotArrow.setLength(
      armour.hitState.arrowLength,
      armour.hitState.markerSize * 3,
      armour.hitState.markerSize * 1.6,
    );
    shotArrow.visible = true;
    shotShaft.position.lerpVectors(tail, armour.hitState.point, .5);
    shotShaft.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      incoming,
    );
    shotShaft.scale.set(
      armour.hitState.markerSize * .2,
      armour.hitState.arrowLength,
      armour.hitState.markerSize * .2,
    );
    shotShaft.visible = true;
    angleHandle.position.copy(tail);
    angleHandle.scale.setScalar(armour.hitState.markerSize * 1.45);
    angleHandle.visible = true;

    hitNormal.position.copy(armour.hitState.point);
    hitNormal.setDirection(armour.hitState.normal);
    hitNormal.setLength(
      armour.hitState.arrowLength * .7,
      armour.hitState.markerSize * 2.4,
      armour.hitState.markerSize * 1.2,
    );
    hitNormal.visible = true;

    const arcPoints = [];
    const arcRadius = armour.hitState.arrowLength * .32;
    const steps = 18;
    for (let step = 0; step <= steps; step++) {
      const theta = radians * step / steps;
      arcPoints.push(armour.hitState.point.clone().add(
        armour.hitState.normal.clone()
          .multiplyScalar(Math.cos(theta) * arcRadius)
          .addScaledVector(armour.hitState.tangent, Math.sin(theta) * arcRadius),
      ));
    }
    angleArc.geometry.dispose();
    angleArc.geometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
    angleArc.visible = Math.abs(angle) >= .5;

    armour.lastHit.angle = angle;
    armour.lastHit.angleFactor = Math.cos(Math.abs(radians));
    updateHitPanel();
    page.invalidate();
  }

  function renderHitPanel() {
    const style = collisionStyles.get(armour.lastHit.material) || {
      label: 'Collision region',
    };
    const weapon = damageState.weapon;
    const distanceControl = hasDistanceFalloff(weapon)
      ? '<div class="distance-control">' +
        `<label for="distance-range"><span>Range</span><output id="distance-output">${damageState.distance.toFixed(0)} m</output></label>` +
        `<input id="distance-range" class="range" type="range" min="0" max="${Math.ceil(weapon.distToMinDamage * 1.25)}" step="1" value="${damageState.distance}">` +
        '</div>'
      : '';
    const technical = [
      ['material ID', armour.lastHit.material],
      ['def group', defGroup(armour.lastHit.material)],
      ['part', armour.lastHit.template],
      ['geometry', armour.lastHit.geometry],
      ['position', armour.lastHit.point.map(value => value.toFixed(2)).join(' / ')],
    ];
    if (weapon) {
      technical.push(['weapon', weapon.name], ['projectile', weapon.projectile],
        ['att material', `${weapon.material} (group ${attGroup(weapon.material)})`]);
      if (weapon.material2 != null) technical.push(['splash material', weapon.material2]);
      if (weapon.velocity != null) technical.push(['muzzle velocity', `${weapon.velocity} m/s`]);
    }
    document.getElementById('hit-details').innerHTML =
      `<div class="hit-region">${style.label}</div>` +
      `<div class="hit-class">${collisionMaterialClass(armour.lastHit.material)}</div>` +
      '<div class="impact-reading"><strong id="impact-value">100.0%</strong>' +
      '<span id="impact-label">Damage</span></div>' +
      '<div class="damage-basis" id="damage-basis">of this region&rsquo;s head-on damage</div>' +
      '<div class="hp-loss" id="hp-loss"><span>HP loss</span><span>select a weapon</span></div>' +
      '<div class="formula" id="hp-note"></div>' +
      '<div class="angle-control">' +
      '<label for="angle-range"><span>Impact angle</span><output id="angle-output">0.0°</output></label>' +
      '<input id="angle-range" class="range is-busy" type="range" min="0" max="85" step="0.5" value="0">' +
      '</div>' +
      distanceControl +
      '<div class="formula">Drag the orange arrow handle or use the slider.</div>' +
      '<div class="formula" id="impact-formula"></div>' +
      '<details class="disclosure hit-technical"><summary>Technical details</summary>' +
      technical.map(([label, value]) =>
        `<div class="stat"><span>${label}</span><span>${value}</span></div>`
      ).join('') +
      '</details>';

    const distanceRange = document.getElementById('distance-range');
    if (distanceRange) page.syncRange(distanceRange);
    document.getElementById('angle-range').addEventListener('input', event => {
      setHitAngle(Number(event.target.value));
    });
    document.getElementById('distance-range')?.addEventListener('input', event => {
      damageState.distance = Number(event.target.value);
      const output = document.getElementById('distance-output');
      if (output) output.value = `${damageState.distance.toFixed(0)} m`;
      updateHitPanel();
    });
    setHitAngle(armour.lastHit.angle || 0);
    document.getElementById('hit-details').scrollIntoView({ block: 'nearest' });
  }

  function selectCollisionHit(hit) {
    const root = hit.object.userData.collisionRoot;
    const normal = hit.face.normal.clone()
      .transformDirection(hit.object.matrixWorld)
      .normalize();
    if (normal.dot(raycaster.ray.direction) > 0) normal.negate();

    const cameraRight = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(page.camera.quaternion);
    const tangent = cameraRight.clone()
      .addScaledVector(normal, -normal.dot(cameraRight));
    if (tangent.lengthSq() < 1e-6) {
      const cameraUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(page.camera.quaternion);
      tangent.copy(cameraUp)
        .addScaledVector(normal, -normal.dot(cameraUp));
    }
    tangent.normalize();

    const markerSize = Math.max((page.framing?.radius || 1) * .012, .015);
    const arrowLength = Math.max((page.framing?.radius || 1) * .3, .45);
    armour.hitState = {
      point: hit.point.clone(),
      normal,
      tangent,
      markerSize,
      arrowLength,
    };

    hitMarker.position.copy(hit.point);
    hitMarker.scale.setScalar(markerSize);
    hitMarker.visible = true;
    armour.lastHit = {
      template: root.userData.sourceTemplate,
      geometry: root.userData.sourceGeometry,
      material: hit.object.geometry.userData.defenseMaterial,
      angle: 0,
      angleFactor: 1,
      point: hit.point.toArray(),
    };
    renderHitPanel();
  }

  collisionCheckbox.addEventListener('change', e => {
    state.collision = e.target.checked;
    applyCollisionState();
    page.invalidate();
  });
  legendMaterials.addEventListener('click', event => {
    const button = event.target.closest('[data-material]');
    if (!button) return;
    const material = Number(button.dataset.material);
    setCollisionMaterial(
      material === state.collisionMaterial ? null : material,
    );
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  armour.pointerStart = null;

  function setPointer(event) {
    const rect = page.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, page.camera);
  }

  page.renderer.domElement.addEventListener('pointerdown', event => {
    if (!state.collision || !armour.hitState || !angleHandle.visible) return;
    setPointer(event);
    if (!raycaster.intersectObject(angleHandle, false).length) return;
    armour.angleDragging = true;
    armour.angleDragStart = { x: event.clientX, angle: armour.lastHit.angle };
    armour.pointerStart = null;
    page.controls.enabled = false;
    page.main.dataset.angleDrag = 'true';
    page.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  page.renderer.domElement.addEventListener('pointermove', event => {
    if (!armour.angleDragging || !armour.angleDragStart) return;
    setHitAngle(
      armour.angleDragStart.angle + (event.clientX - armour.angleDragStart.x) * .35,
    );
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  page.renderer.domElement.addEventListener('pointerup', event => {
    if (!armour.angleDragging) return;
    armour.angleDragging = false;
    armour.angleDragStart = null;
    page.controls.enabled = true;
    page.main.dataset.angleDrag = 'false';
    page.renderer.domElement.releasePointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  page.renderer.domElement.addEventListener('pointerdown', event => {
    armour.pointerStart = { x: event.clientX, y: event.clientY };
  });
  page.renderer.domElement.addEventListener('pointerup', event => {
    if (!state.collision || !armour.pointerStart) return;
    const movement = Math.hypot(
      event.clientX - armour.pointerStart.x,
      event.clientY - armour.pointerStart.y,
    );
    armour.pointerStart = null;
    if (movement > 4) return;

    setPointer(event);
    const targets = collisionTargets.filter(
      obj => obj.visible && obj.userData.collisionRoot?.visible);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit?.face) {
      clearHit();
      return;
    }

    selectCollisionHit(hit);
  });

  /** A freshly loaded model: its report, its weapons and its collision hulls. */
  function adoptModel(root, report, entry) {
    armour.currentReport = report;
    buildWeaponSelect(entry);
    renderWeaponSummary();
    collectCollisions(root, report);
  }

  // The armour view's `?shots` hooks (window.__modelInspector).
  const setCollision = enabled => {
    state.collision = Boolean(enabled);
    collisionCheckbox.checked = state.collision;
    applyCollisionState();
    page.invalidate();
  };

  const pickCenterHit = () => {
    const visible = collisionTargets.filter(obj => obj.visible);
    if (!visible.length) return null;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), page.camera);
    let hits = raycaster.intersectObjects(visible, false);
    if (!hits.length && page.current) {
      const aim = new THREE.Box3().setFromObject(page.current).getCenter(new THREE.Vector3());
      raycaster.set(page.camera.position, aim.sub(page.camera.position).normalize());
      hits = raycaster.intersectObjects(visible, false);
    }
    const hit = hits.find(candidate => {
      const normal = candidate.face.normal.clone().transformDirection(candidate.object.matrixWorld);
      return Math.abs(normal.y) < .7;
    }) || hits[0];
    if (!hit?.face) return null;
    selectCollisionHit(hit);
    return armour.lastHit;
  };

  const getCollision = () => {
    let handle = null;
    if (angleHandle.visible) {
      const projected = angleHandle.position.clone().project(page.camera);
      const rect = page.renderer.domElement.getBoundingClientRect();
      handle = {
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    }
    return {
      enabled: state.collision,
      roots: collisionRoots.length,
      targets: collisionTargets.length,
      visibleTargets: collisionTargets.filter(target => target.visible).length,
      selectedMaterial: state.collisionMaterial,
      hit: armour.lastHit,
      handle,
    };
  };

  Object.assign(armour, {
    adoptModel,
    applyCollisionState,
    computeHitDamage,
    damageTables,
    getCollision,
    isCollisionMesh,
    pickCenterHit,
    setCollision,
    setCollisionMaterial,
    setHitAngle,
    setWeapon,
  });
  return armour;
}
