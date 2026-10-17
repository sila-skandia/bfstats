# Manual steps for the owner

What the 2026-10-17 open-issues round could not settle without someone at the
retail game or at the viewer. Each step says what to do, how long it takes,
and what the result settles. Everything else in the round was measured by the
agents (lab server, node harnesses, headless page runs) and is in the tracker
(`README.md`) with its evidence.

## Retail captures

Retail FHSW 0.81, OBS at 60 fps with game audio.

### FHR-2: the shooter's casing tick (about 15 s)

Battle_Of_Foy, US side, second kit (`2Us_AssaultGarand`). Stand still, raise
the Garand (key 3) and fire eight clicks about 0.5 s apart, then wait 3 s.

Listen for a tick about 70 ms after each report and the clip ping about 0.6 s
after the eighth. The binary says the tick is there (`FireArms__Fire` message
0 to each child, `shells_High.ssc` `Time Ramp 0.07`); the page plays it.

### FHR-6: first-person casings and the ground (about 20 s)

Same level and kit. Lie prone on flat ground, look 30-45 degrees down and to
the right, and fire eight slow shots. Repeat standing, looking down.

Frame-step the recording: do the casings stay drawn after they cross the
ground line? The binary says no mesh particle in these mods declares
collision (EMT-13), so they should fall through.
