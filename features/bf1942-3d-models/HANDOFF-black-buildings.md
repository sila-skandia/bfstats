# Handoff: some Tobruk buildings render black (in flight)

Working notes for an investigation interrupted mid-stream. Delete this file
once the fix lands. Everything *finished* this session is in the git log
(`git log --oneline 4e13cde..`) and the four docs this README indexes; this
file records only the open problem.

## The report

Dylan: after the lightmap pass was enabled, buildings look good on the
sun-facing side but "almost black" on the shadow side. Observed from
`map.html?map=Tobruk&cam=2430,78,-820,5.498,-0.05` (camera NE of the town
looking SW, i.e. against the sun).

## Facts established, in order

1. An ambient floor was added to the lightmap multiply in `bindLightmaps`
   (`viewer/map.html`): factor = `min(2, ambient+globalAmbient + 2*bake)`.
   Tobruk declares ambient 0.12/0.10/0.08, globalAmbient 0.2/0.2/0.2,
   shadowColor 0.55 (see `viewer/maps/tobruk/scene.json` `lighting`).
   **This change is uncommitted** and did not visibly fix the report.
2. **Toggling the lightmap checkbox OFF leaves the walls pure black.**
   Factor becomes 1.0 exactly, so the blackness is NOT the lightmap factor.
   Screenshot: scratchpad `shots/amb-lmoff.png`.
3. Raycast into one black facade hit mesh `smdh2_m2_3` (11 child meshes under
   `smdh2_m1 > lodsmdh2 > smdh2Exterior`), material `SmDh2_m2_Material5`,
   map `texture/SD1veg_r.dds`, converted MeshBasicMaterial, color white.
   Only ONE Lod alternative exists under `lodsmdh2` — no stacked wreck.
4. `SD1veg_r.dds` measures **bright** (256x256, mean R 193). A bright map on
   a white MeshBasicMaterial at factor 1 cannot render black, so the raycast
   probably hit a small veg-decoration part (10 tris), NOT the big facade.
   The facade is likely primitive [9] `Material0` (524 tris, `SD1pr2_r`).
5. `SmDh2_m2.rs` material->texture table and the `.sm` material order are in
   the last shell output before this handoff; note `.sm` order is NOT 0..n
   (`Material3,2,1,5,6,7,8,10,11,0,4`) and `material11 -> texture/black_o`
   (46 tris, legitimately black window/door interiors).

## Leading hypothesis (untested)

The black facades belong to buildings with **no lightmap bake** (Tobruk ships
71 lightmaps for 750 placed objects). Those keep MeshStandardMaterial and
analytic lighting, and `applyLighting()` wires the level's declared ambient
(0.12/0.10/0.08) into the hemisphere - so their shadow sides collapse to near
black. The lightmapped buildings (dome house etc.) look right from both sides
because their bake carries bounce. The user attributes it to "the lightmaps"
because it appeared at the same time, but it may be the analytic path that was
always this dark, newly conspicuous next to correctly-lit lightmapped
neighbours.

## Next steps

1. Raycast the CENTRE of a big black facade (not the first hit) and report
   material type + lightMap presence. If MeshStandardMaterial with no
   lightMap, hypothesis confirmed.
2. If confirmed: raise the analytic ambient for statics to the same
   `ambient + globalAmbient` floor the lightmap path uses (in
   `applyLighting()` in `viewer/map.html`), so lightmapped and unlightmapped
   statics agree. Check `shadowColor 0.55` - it may be the engine's own
   shadow-side floor and the better value.
3. If refuted: dump the compiled fragment shader of the black facade's
   material (`renderer.properties.get(mat)`) and check whether the injected
   floor GLSL is actually present; then check vertex colours.
4. Re-verify BOTH sides at
   `cam=2360,80,-750,2.2,-0.12` (sun side) and `cam=2430,78,-820,5.498,-0.05`
   (shadow side), and against Dylan's two in-game screenshots (same spot,
   second-line bunker looking back).

## Session state that matters

- Bulk extraction of all 22 levels is running detached
  (`extract_levels.sh`, log in scratchpad `levels.log`). Tobruk/Wake/Aberdeen
  are current; the rest overwrite alphabetically. If an exporter fix lands
  after it finishes, re-run it.
- The lightmap ambient-floor change in `viewer/map.html` is UNCOMMITTED -
  fold it into whatever fix comes out of this, or drop it if the analytic
  path is the real culprit.
- Screenshot workflow: `map.html?shots&map=X&cam=x,y,z,yaw,pitch`, wait for
  `window.__renderOnce`, POST canvas to the receiver in scratchpad
  (`shotrecv.py`, port 5398, output `shots/`). Yaw convention:
  `dir = (sin yaw * cos p, sin p, cos yaw * cos p)`.
