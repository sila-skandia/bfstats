// How many plays of one sample may sound at once, across every object.
//
// The client keeps one buffer per sample and hands each play an instance of
// it (ledger SND-14, SND-38). A buffer is keyed by the file and the sample's
// 3D, `loop` and `stream` words (`SoundPatch__build` 0x00803020 hands the
// description's +0x1c, +0x1e and +0x1d to `addSample` 0x00802db0, which keys
// the buffer with them, 0x007fe810; the buffer keeps them at +0x28, +0x29 and
// +0x2a, 0x00800880), and it holds at most `DAT_0095ac98` = 8 instances
// (0x00800600; `0x00800f10` resets a cap of 0 to it). A play takes a free
// instance (0x00800940), else a new one while under the cap (0x008009c0),
// else steals (0x00800aa0):
//
// - from a one-shot buffer (+0x29 clear), the instance that started longest
//   ago: the buffer's update (0x00800c40) pushes each newly started instance
//   onto the front of a list, and the steal takes its back;
// - from a looping buffer, the instance farthest from the listener, re-keyed
//   by distance every update (0x00800c40 -> 0x008003e0), and only when the
//   new play is nearer; otherwise the new play gets nothing.
//
// No cap is per object, per template or per script: two soldiers' rifles, or
// two scripts that load one wav, draw on one buffer. This module is that
// buffer's one-shot half, per AudioContext and per decoded AudioBuffer (the
// page decodes each wav once, so one AudioBuffer is one file). The page plays
// a loop from its start for good and mutes it by gain, where the game stops a
// loop whose volume is zero and asks again when it rises (0x00802a40 ->
// 0x00802210, 0x007fcc80), so a count of the page's loops would include ones
// the game holds no instance for; loops are not pooled here.

export const INSTANCES_PER_SAMPLE = 8;

// AudioContext -> AudioBuffer -> { positional: [], flat: [] }, oldest first.
const contexts = new WeakMap();

function listFor(ctx, buffer, positional) {
  let buffers = contexts.get(ctx);
  if (!buffers) {
    buffers = new WeakMap();
    contexts.set(ctx, buffers);
  }
  let lists = buffers.get(buffer);
  if (!lists) {
    lists = { positional: [], flat: [] };
    buffers.set(buffer, lists);
  }
  return positional ? lists.positional : lists.flat;
}

/**
 * A one-shot play of `buffer` starts. `instance.steal()` stops it; it is
 * called when an eighth play of the same buffer is already sounding and this
 * is the oldest. Returns how many were stolen to make room.
 */
export function claimOneShot(ctx, buffer, positional, instance) {
  if (!ctx || !buffer) return 0;
  const list = listFor(ctx, buffer, positional);
  let stolen = 0;
  while (list.length >= INSTANCES_PER_SAMPLE) {
    const oldest = list.shift();
    stolen += 1;
    try { oldest.steal(); } catch (_) {}
  }
  list.push(instance);
  return stolen;
}

/** A one-shot play has ended, been stopped or been stolen. */
export function releaseOneShot(ctx, buffer, positional, instance) {
  if (!ctx || !buffer) return;
  const buffers = contexts.get(ctx);
  const lists = buffers?.get(buffer);
  if (!lists) return;
  const list = positional ? lists.positional : lists.flat;
  const at = list.indexOf(instance);
  if (at >= 0) list.splice(at, 1);
}

/** How many one-shot plays of `buffer` sound now (headless checks). */
export function oneShotsOf(ctx, buffer, positional = true) {
  const lists = contexts.get(ctx)?.get(buffer);
  if (!lists) return 0;
  return (positional ? lists.positional : lists.flat).length;
}
