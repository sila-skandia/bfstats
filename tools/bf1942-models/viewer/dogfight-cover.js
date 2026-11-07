// The cover over the picture while the school seats you (features/dogfight-
// school, "Straight into the air"). Seating goes through the ground: stood
// on the firing line, climbed into a fighter parked on the airfield, then
// put in the air at the lesson's start. None of that is anything to watch,
// so the picture is dark from the moment a lesson or course asks for a seat
// until the plane is in the air, and fades up on the flight.

const FADE_MS = 320;

/** A cover inside `host` (the live fight's or the course's overlay). */
export function seatCover(host) {
  const el = document.createElement('div');
  el.className = 'dfl-cover';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  host.prepend(el);
  let fade = 0;
  return {
    el,
    /** Dark now, with no fade in: the ground must never show first. */
    show() {
      clearTimeout(fade);
      el.classList.remove('is-going');
      el.hidden = false;
    },
    /** In the air: fade up on the flight. */
    clear() {
      if (el.hidden || el.classList.contains('is-going')) return;
      el.classList.add('is-going');
      clearTimeout(fade);
      fade = setTimeout(() => { el.hidden = true; el.classList.remove('is-going'); }, FADE_MS);
    },
    /** Gone at once (the lesson ended). */
    hide() {
      clearTimeout(fade);
      el.classList.remove('is-going');
      el.hidden = true;
    },
    get shown() { return !el.hidden && !el.classList.contains('is-going'); },
  };
}
