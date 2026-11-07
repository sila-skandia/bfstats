// Which way into the dogfight school an address is (features/dogfight-school,
// "The briefing"). The boot loader plays the dogfight scene for these, and
// map.html puts the school's briefing over the range while it loads
// (dogfight-briefing.js). Pure: the boot loader bundles it.

/**
 * The school entry `params` asks for, or null for any other address:
 * `{ kind, map, lesson, move, course }`. `kind` is 'move' (a Dip, Flip or
 * Ninja to practise), 'lesson' (FLY IT against a lesson's ace), 'course' (a
 * ring course) or 'school' (the theatre, from the menu or the school page's
 * arena). Only the Range (`proving`) is a way in.
 */
export function schoolEntry(params) {
  if (!params.has('proving') || params.has('shots')) return null;
  const map = params.get('map');
  const lesson = params.get('dogfight');
  const move = params.get('move');
  const course = params.get('course');
  if (lesson && move) return { kind: 'move', map, lesson, move, course: null };
  if (lesson) return { kind: 'lesson', map, lesson, move: null, course: null };
  if (course) return { kind: 'course', map, lesson: null, move: null, course };
  if (params.has('school') || params.get('arena') === 'dogfight') return { kind: 'school', map, lesson: null, move: null, course: null };
  return null;
}
