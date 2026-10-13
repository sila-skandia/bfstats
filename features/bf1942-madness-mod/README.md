# BF1942 Madness: a mod built on a kit bug

Status: idea, not built. Recorded 2026-10-13.

## What we saw

On Desert Rose in FHSW, the kits were missing. Players spawned with vanilla
weapons, and the weapons behaved wrongly. The Bar 1918 fired artillery
rounds, rapid fire.

It was funny, and players enjoyed it. That makes it a candidate for a
deliberate mod, not just a bug to fix.

## Why it might happen (unverified)

Nothing in the repo records this symptom yet, so these are hypotheses to test.

1. **The weapon lookup falls through to the wrong template.** When the kit
   table is missing, a kit weapon name such as `Bar1918` may resolve to a
   different weapon template, one whose shot is an artillery round.
2. **Stats and projectile come from different templates.** The fire rate and
   magazine may come from the Bar 1918 entry, while the projectile and damage
   come from the template it fell through to. The repo records the Bar 1918
   magazine as 20 rounds (`features/bf1942-3d-models/kit-loadouts.md`), so a
   20-round magazine at rapid fire would match the report.
3. **An override file replaces the projectile.** A mod file that redefines a
   projectile could be picked up by a weapon that never asked for it.

## What would settle it

- Load Desert Rose and log which weapon template each spawned soldier gets,
  against the kit name it was given.
- Compare the Bar 1918's fire-rate and projectile fields with the artillery
  template's, to see which values came from where.
- Check the FHSW kit table on the server against the one the client loads.

The engine rules for kits are ledger rows KIT-1 to KIT-5 in
`features/bf1942-engine-reference`. Read them before testing the first
hypothesis, not after.

## The mod idea

Keep the quirk on purpose. Each kit weapon is still real, but the mod
deliberately rebinds weapons to other templates. Candidate rules:

- A kit's weapon is picked from the whole armoury at spawn, so a rifleman
  might get a mortar.
- The fire rate comes from one weapon and the shot from another, as in
  hypothesis 2.
- Rare rebinds are shown on the kit screen as a warning, so players know to
  expect them.

Open questions: whether the mod should restore a clean kit for the first
spawn, and how the rebinding interacts with bots.
