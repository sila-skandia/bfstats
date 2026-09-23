# Sensing

`bot-sense.js BotSenses`, one per bot, rebuilt on respawn. `BotController.
_sensePass` runs one vision pass and one memory update per tick. Research
disagreement: the 53 / 113 deg fields of view and the "10 steps of 0.8 m" of
`ai-22-sensing-decoded.md` are superseded by bot-behaviours §1 (AI-33);
this is the later reading.

## Vision (`sense`)

The eye is the soldier's position plus 1.6 / 1.1 / 0.4 m by stance, or the
hull's position plus 2 m when mounted (`bot.js _eye`; VEHICLE_EYE_HEIGHT
INVENTION). The look direction is the soldier's yaw, or the turret's heading
when mounted.

Three sub-states cycle one per tick, each a band of the view distance `V`
and a full field of view:

| sub-state | band | infantry | mounted |
|---|---|---|---|
| 0 | 0 .. 0.5 V | 100 deg | 75 deg |
| 1 | 0.5 .. 0.75 V | 60 deg | 45 deg |
| 2 | 0.75 .. 1.0 V | 30 deg | 15 deg |

`V` is the level's `aiSettings.setViewDistance` (El Alamein 300), else 600.
The engine advances the sub-state per completed pass and restarts it when the
camera turns past 25 / 15 / 7.5 deg; the viewer takes one sub-state a tick.

**The frustum is square and 3D about the camera** (`inFrustum`,
`Frustum::setupFrustum(fov, 1.0, ...)` transformed by the camera, AI-67):
with the camera's forward `f`, right `r` and up `u`, a point at offset `o`
is inside when `a = o.f > 0`, `|o.r| <= tan(fov / 2) a` and `|o.u| <=
tan(fov / 2) a`. The camera (`bot.js _cameraBasis`) is an aircraft's
airframe; otherwise the look yaw (the turret's heading when mounted) with the
soldier's pitch (the turret's elevation when mounted).

Candidates, over `world.players` (the environment grid is a scan,
INVENTION): not the bot's side, not a neutral non-unit, not destroyed,
within `V` and inside the sub-state's band and field. A candidate already in
memory is left to the memory update. Otherwise it gets

```
n = clamp(round(30 * radius / distance), 1, 10)      radius 1.0 (INVENTION)
```

rays from the eye to points on its body (heights 0.3, 0.8, 1.2, 1.55 m capped
by stance, the first at 1.0 m, jittered +-0.25 m sideways: INVENTION), each a
`lineClear` through the collider that skips the bot's own hull and the
target's (AI-62). One clear ray spots it: a memory record `{seen, lastSeen,
lost, lostAt, pos, shots[], hits[]}`.

*Example.* View 300 m: sub-state 0 covers 0..150 m inside +-50 deg across
and up / down, 1 covers 150..225 m inside +-30 deg, 2 covers 225..300 m
inside +-15 deg. A soldier 250 m ahead and 80 m below a bot looking level is
17.7 deg down: outside sub-state 2's +-15 deg, the only band at that range,
so he is not seen until the bot looks down or closes inside 225 m (the
earlier bearing-only test saw him). A soldier at 10 m gets `round(3) = 3`
rays, at 100 m `round(0.3) -> 1`, at 2 m `15 -> 10`.

## Memory (`updateMemory`)

Every tick, for every record:

- dropped when the player is gone, on the bot's side now, or destroyed;
- its position is the live one (the engine re-projects a body-fixed point
  through the live transform: a bot knows where a lost enemy is);
- if inside the view distance and the widest field's frustum (100 deg, 75
  mounted), the rays are cast again: seen refreshes it; the first miss marks
  it lost at `now`;
  a lost record is erased **60 s** after it was lost.

The spotted list every behaviour scores is every record, seen or lost
(`spottedEnemies`).

## Hearing (`hear`)

The page reports every shot to every bot (`map.html botFireTick`, and the
human's). A bot hears a shooter of the other side when

```
not deaf (3 s since its own last shot)
and ( fired within 3 s: distance <= the weapon's AI soundSphereRadius
      else:              distance <= 15 m, unless the shooter is crouched or prone )
```

The engine's probability roll is always true for a listener with a mobile
plug-in (AI-34), so hearing is deterministic. A heard object is kept **30 s**.
The page never passes the shooter's pose, so the crouch/prone exception
never applies.

*Example.* A K98 (sound radius 150 m) fired 120 m away is heard; the same
shot by a bot that fired itself 2 s ago is not.

## Incoming fire (`onIncomingFire`)

The page calls it for every round that **lands** on the bot (strength 1,
`hit` true; near misses are not reported). Each is a record `{time,
strength, attacker, hit, rate 1.0 (INVENTION), pos, aimed = hit}`; the
attacker map keeps the latest per attacker.

```
list lifetime     = min(60 / n, 5) s            n = records in the list
attacker lifetime = max(300 / n, 10) s          n = attackers
strength(now)     = sum strength / ((now - time) * rate + 1) x (10 if hit)
attackedBy(id)    = the attacker's last record time, else -1000
```

*Example.* One hit 0.5 s ago: `1 / 1.5 x 10 = 6.7`. With 4 records the list
lives 5 s; with 20, 3 s.

`isUnderFire` (a round within 1.5 s, INVENTION) only picks Scout's prone
pose.

## Sensing quadrants

Eight quadrants: four 90 deg azimuth bins by `round(yaw / 90 deg)`, and an
upper set above 25 deg elevation (`bot-behaviours.js quadrantOf`; the bins
INFERRED from `computeQuadrants`' cosines). Each carries an inertia, the
seconds since the camera last looked into it: every tick all grow by `dt`
and the one the camera looks into is zeroed (`bot.js _sensePass`). Scout and
TakeCover bin their threats by it ([behaviours.md](behaviours.md)).
