// An Engine's heat: the rocket motors' burn (ledger PHY-45), and the bar the
// vehicle HUD draws for it (VHUD-20).
//
// The engine's law, read on lnxded (`Engine::handleUpdate` 0x0823e120, once a
// 30 Hz tick, after the gearbox has moved the revs and clamped them to
// -1 .. 1.2):
//
//   if (template.heatIncrement > 0) {                  // +0x528, 0x0823e320
//     heat += |revs| * heatIncrement;                  // Engine+0x144
//     heat -= coolingFactor;                           // +0x52c, 0x0823e34b
//     if (heat >= 1) { running = false; heat = 1; revs = 0; }   // +0x142
//     else if (heat < 0) heat = 0;
//   }
//
// `heatIncrement` is the EngineTemplate ctor's -1 (0x0823f082: no heat) and
// `coolingFactor` its 0, so both are per tick, as written in the script.
// `Engine::hasHeat` 0x0823ec30 is `heatIncrement > 0`. The heat is zeroed by
// the Engine's constructor and by nothing else: `running` (TemplateMessage 4
// on a driver's entry, PHY-30) can be set again, but the next tick finds the
// heat at 1 and stops the engine in the same tick. A motor that has burnt
// out stays out for the object's life.
//
// The shipped writers have no cooling: Secret Weapons' `NatterEngine`
// (`HeatIncrement 0.0003`: 3334 ticks, 111 s at full revs) and
// `WasserfallRocketEngine` (`0.00084`: 1191 ticks, 39.7 s). The mods' guided
// missiles after them (Desert Combat's Aim-54 and SA-3, EoD's Hawk, FH's
// Baka), and GCMOD's pod racers, which do cool (`CoolingFactor 0.15`).
//
// The HUD (the client, `menu::Vehicle::update`, Mac 0x0046b0b4): for the
// vehicle's first Engine with heat (`getEngineFromChildsAndSiblings`, then
// `hasHeat`) it calls `OverHeatRecover::setRecoverData(getHeatBarType(),
// isHeatInversed() ? 1 - heat : heat)`, which are the layout's
// `Recover/ShowRecover` and `Recover/Recover`. `heatBarType` (+0x530) is R 4
// (the ctor's), G 5 or B 6 (`operator>>(istream&, heatBarType&)`
// 0x08242b10): the `vehicleHealth` group's `reloadtimebar_full`,
// `heatbar_full` and `rocketpackbar_full` fills beside the vehicle's health
// bar. `inverseHeatBar` (+0x534) turns the fill round, so both rocket motors
// show the burn that is left, in blue, emptying.
//
// No imports: `vectored-engines.js` steps it on the page, in the room server
// and in the headless runner.

/** `EngineTemplate::EngineTemplate` 0x0823f082..0x0823f0a0. */
export const ENGINE_HEAT_DEFAULTS = Object.freeze({
  heatIncrement: -1, coolingFactor: 0, heatBarType: 'R', inverseHeatBar: false,
});

/** `heatBarType` as the menu's `Recover/ShowRecover` (0x08242b8f, 0x08242c13). */
export const HEAT_BAR_TYPES = Object.freeze({ R: 4, G: 5, B: 6 });

/** The heat block of an Engine's `physics` (`bf42/con.py`), or null for an
 *  engine without heat (`Engine::hasHeat`). */
export function engineHeatSpec(physics) {
  const inc = Number(physics?.heatIncrement);
  if (!(inc > 0)) return null;
  const type = String(physics.heatBarType ?? ENGINE_HEAT_DEFAULTS.heatBarType).toUpperCase();
  return {
    heatIncrement: inc,
    coolingFactor: Number(physics.coolingFactor) || 0,
    heatBarType: HEAT_BAR_TYPES[type] ? type : ENGINE_HEAT_DEFAULTS.heatBarType,
    inverseHeatBar: physics.inverseHeatBar === true,
  };
}

/** One Engine's heat (`Engine+0x144`) and whether it has stopped it. */
export class EngineHeat {
  constructor(spec) {
    this.spec = spec;
    this.heat = 0;
    this.burnt = false;
  }

  /**
   * The heat branch of `Engine::handleUpdate` for `ticks` 30 Hz ticks at
   * `revs` (the gearbox's answer for the tick, 0 for an engine that is not
   * running). Returns the revs the engine is left with: `revs`, or 0 from
   * the tick the heat reaches 1.
   */
  step(revs, ticks = 1) {
    if (this.burnt) return 0;
    const { heatIncrement, coolingFactor } = this.spec;
    const heat = this.heat + (Math.abs(revs) * heatIncrement - coolingFactor) * ticks;
    if (heat >= 1) {
      this.heat = 1;
      this.burnt = true;
      return 0;
    }
    this.heat = heat < 0 ? 0 : heat;
    return revs;
  }

  /** `Recover/ShowRecover` and `Recover/Recover` for this engine. */
  get bar() {
    return {
      show: HEAT_BAR_TYPES[this.spec.heatBarType],
      value: this.spec.inverseHeatBar ? 1 - this.heat : this.heat,
    };
  }
}

/** The first engine with heat among `engines` (each `{ heat: EngineHeat }`),
 *  the one `menu::Vehicle::update` shows, or null. */
export function heatedEngine(engines) {
  for (const engine of engines ?? []) if (engine?.heat instanceof EngineHeat) return engine;
  return null;
}

/**
 * The vehicle HUD's two `Recover` variables for a drive's engines: the bar of
 * the first engine with heat, or `{ show: 0 }` when none has any. The
 * soldier's rocket pack owns `Recover/ShowRecover` 3 on foot
 * (`soldier-hud.js`); this is the seated half.
 */
export function recoverBar(engines) {
  const engine = heatedEngine(engines);
  return engine ? engine.heat.bar : { show: 0, value: null };
}
