// An even frame cadence for a page that cannot draw on every refresh
// (features/remaster-browser, "The performance pass").
//
// A browser calls the frame loop once a display refresh. A frame that takes
// longer than one refresh is shown a refresh late, so a page whose frames
// cost between one and two refreshes shows some frames for one refresh and
// some for two: at 120 Hz with 10 ms frames, 8 ms and 17 ms in no order.
// That unevenness is what reads as stutter, far more than the rate itself.
// The pacer watches how many refreshes each drawn frame took and, when too
// many overrun, draws on every second refresh (or third, or fourth) instead:
// the same number of pictures a second as before, each shown for the same
// time.
//
// It reads only the loop's own timestamps. The refresh interval is the
// shortest gap between two calls lately (a skipped call comes back exactly
// one refresh later, so a paced page measures it cleanly); a drawn frame's
// cost in refreshes is the gap to the call after it. That counts the GPU's
// time as well as the script's wherever the GPU holds the next call back.
//
// Pure: no DOM, no clock of its own.

/** A share of overrunning frames above this raises the divisor... */
export const RAISE = 0.12;
/** ...and above this when raising would take the page under SMOOTH_FPS: a
 *  page mostly at 60 with one frame in six late is better left there than
 *  held at 30. */
export const RAISE_SLOW = 0.35;
export const SMOOTH_FPS = 50;
/** A divisor is lowered when fewer than this share would overrun the lower one. */
export const LOWER = 0.03;
/** Drawn frames a judgement reads. */
export const SAMPLE = 90;
/** Drawn frames a divisor is kept before it may be lowered; doubled each
 *  time lowering it had to be undone soon after, up to DWELL_MAX. */
export const DWELL = 180;
export const DWELL_MAX = 2880;
/** The page is never paced under this rate. */
export const MIN_FPS = 28;
export const MAX_DIVISOR = 4;
/** A gap this long is the page stopping (a hidden tab, a load), not a frame. */
const STALL_MS = 250;

/**
 * `gate(now)` once per call of the frame loop, `now` its timestamp (ms):
 * true when a frame should be drawn on this call. `onChange(state)` hears a
 * change of divisor.
 */
export function createFramePacer({ onChange = null } = {}) {
  let last = null;        // the previous call
  let drawnAt = null;     // the call the last frame was drawn on
  let measuring = false;  // the next call measures that frame
  let display = null;     // the refresh interval, ms
  let divisor = 1;
  let dwell = DWELL;
  let kept = 0;           // drawn frames since the divisor changed
  let sinceLowered = Infinity;
  const gaps = [];        // recent gaps between calls
  const busy = [];        // refreshes each recent drawn frame took

  const state = () => ({ divisor, display, fps: display ? 1000 / (display * divisor) : null });
  const overrun = k => {
    if (!busy.length) return 0;
    let n = 0;
    for (const b of busy) if (b > k) n++;
    return n / busy.length;
  };
  const cap = () => (display
    ? Math.max(1, Math.min(MAX_DIVISOR, Math.floor(1000 / (MIN_FPS * display))))
    : 1);

  function refresh(gap) {
    gaps.push(gap);
    if (gaps.length > 120) gaps.shift();
    if (gaps.length < 20 || gaps.length % 10) return;
    // The shortest gaps lately, less the odd early call: the tenth percentile.
    const sorted = [...gaps].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)];
    if (low > 3 && low < 60) display = display === null ? low : display + (low - display) * 0.3;
  }

  function judge() {
    if (busy.length < SAMPLE / 2) return;
    const top = cap();
    if (divisor > top) return set(top);
    const limit = k => (1000 / (display * k) >= SMOOTH_FPS ? RAISE : RAISE_SLOW);
    if (divisor < top && overrun(divisor) > limit(divisor + 1)) {
      let k = divisor + 1;
      while (k < top && overrun(k) > limit(k + 1)) k++;
      // Lowered a moment ago and back already: stay up longer next time.
      if (sinceLowered < DWELL * 3) dwell = Math.min(DWELL_MAX, dwell * 2);
      return set(k);
    }
    if (divisor > 1 && kept >= dwell && busy.length >= SAMPLE && overrun(divisor - 1) <= LOWER) {
      sinceLowered = 0;
      return set(divisor - 1);
    }
  }

  function set(k) {
    if (k === divisor) return;
    divisor = k;
    kept = 0;
    busy.length = 0;
    onChange?.(state());
  }

  function gate(now) {
    if (last !== null) {
      const gap = now - last;
      if (gap > 0 && gap < STALL_MS) {
        refresh(gap);
        if (measuring && display) {
          busy.push(Math.max(1, Math.round(gap / display)));
          if (busy.length > SAMPLE) busy.shift();
          kept++;
          sinceLowered++;
          judge();
        }
      }
      measuring = false;
    }
    last = now;
    if (divisor > 1 && drawnAt !== null && display && now - drawnAt < (divisor - 0.5) * display) return false;
    drawnAt = now;
    measuring = true;
    return true;
  }

  return { gate, get state() { return state(); } };
}
