// The input index the server will run this page's tick at, so the page's
// own rounds are drawn where the server draws them (ledger DEV-14).
//
// `FireArms::fireBarrel` (lnxded 0x0828aba0) seeds a round's two deviation
// draws from `(Game::getCurrentInputIndex() + barrel) & 0x3ff` (DEV-9), and
// for a human the index is the serial of the record that tick runs: the
// server queues the record under its own serial (`ActionBuffer::pushBack`
// from `processRcvdPlayerActions`) and `simulatePlayerUpdate` 0x0815bd00
// reads it back into Game+0x68. On the lab, 30 of 30 BAR rounds of a
// sidecar soldier drew at their fire word's serial (lab/dev_index_check.py).
//
// The page never sees a serial: the sidecar assigns one to each page word as
// it enqueues it (input.mjs `InputSender.enqueue`), one apiece and in order,
// and its ack row says the index the acked word ran at (`ai`, net-sidecar.js
// `ackIndex`). So a later page word runs at that index plus the page words
// between them, and a page word is a world tick (net-room.js
// `sendTickInputs`): the tick a round fires on names its word.
//
// Which word fires. The server fires a press on the first word that carries
// it (lab, 2026-10-24: 11 of 11 page taps drew at the first word after the
// press). The page's own round can leave later: its hand weapon takes the
// trigger in the frame's presentation, after the world has stepped, so a
// press whose frame ran ticks fires on the next frame's first tick, one or
// more ticks after its word (7 of those 11). So a held trigger's rounds are
// drawn at their tick less the hold's lag, the ticks from the first word
// carrying the press to the page's first round of it: a burst's later rounds
// keep the server's cadence on both sides, a tick count apart.
//
// Where the prediction is off, and by how much:
//   * a hitch's merge (input.mjs `_mergePending`) runs a group of words as
//     one record under the newest one's serial, so a round fired on an older
//     word of the group draws at that word's index + its distance to the
//     newest; the next ack after the hitch is right again;
//   * a quiet page (the deploy screen) hands the ticks to the sidecar's idle
//     records, each a serial of its own; the first ack after the page talks
//     again counts them;
//   * a tick the server runs with nothing queued runs at the last index + 1,
//     and the page fires on its own tick regardless.

/** A tick further than this past the newest word sent is a page that has
 *  stopped sending (not joined, no input): its index is not known. A frame
 *  runs at most the world clock's catch-up of ticks before it sends. */
export const MAX_GAP_TICKS = 8;
/** A first round further than this after its press is a weapon that was not
 *  ready (cycling, reloading), which the server waits out too: no lag. */
export const MAX_FIRE_LAG_TICKS = 4;

/**
 * `ackOf()` is the newest `{ seq, index }` the sidecar acked (or null), read
 * when a round asks so it is never older than the last message in.
 */
export function createInputIndex({ ackOf = () => null, maxGap = MAX_GAP_TICKS, maxLag = MAX_FIRE_LAG_TICKS } = {}) {
  let sent = null;   // { tick, seq } of the newest page word sent
  let fireHeld = false;
  let hold = null;   // { tick, lag }: the first word of the held trigger, and its rounds' lag once the first has fired
  return {
    /** Word `seq` carries world tick `tick`'s input. */
    noteSent(tick, seq) {
      if (Number.isInteger(seq) && seq > 0 && Number.isFinite(tick)) sent = { tick, seq };
    },
    /**
     * The frame's input, before the world steps: `fire` its trigger bit, and
     * `nextTick` the first tick it will run (`world.ticks + 1`), whose word
     * is the first to carry a press made now, this frame or, if it runs no
     * tick, the next. Noted ahead of the step because the page's round of a
     * press made in a frame with no tick fires in the next frame's step,
     * before that frame's words go out. The hold lasts to the next press: a
     * tap is often let go before the page's round of it fires.
     */
    notePress(nextTick, fire) {
      if (fire && !fireHeld && Number.isFinite(nextTick)) hold = { tick: nextTick, lag: null };
      fireHeld = !!fire;
    },
    reset() { sent = null; fireHeld = false; hold = null; },
    /** The page seq world tick `tick`'s word has, or will have. */
    seqAt(tick) {
      if (!sent || !Number.isFinite(tick)) return null;
      const ahead = Math.round(tick - sent.tick);
      return ahead <= maxGap ? sent.seq + ahead : null;
    },
    /** The ticks a round fired on tick `tick` trails the word the server
     *  fires it on: the held trigger's lag, fixed by its first round. */
    lagAt(tick) {
      if (!hold || !Number.isFinite(tick)) return 0;
      if (hold.lag == null) {
        const d = Math.round(tick - hold.tick);
        hold.lag = d >= 0 && d <= maxLag ? d : 0;
      }
      return hold.lag;
    },
    /** The input index the server runs world tick `tick` at, or null. */
    indexAt(tick) {
      const seq = this.seqAt(tick);
      const ack = ackOf();
      if (seq == null || !ack || !Number.isInteger(ack.seq) || !Number.isInteger(ack.index)) return null;
      return ack.index + (seq - ack.seq);
    },
    /** What the last round was read from: the newest word sent and the
     *  held trigger's first word and lag (`__net().inputDraws`). */
    debug() { return { sent: sent && { ...sent }, hold: hold && { ...hold } }; },
    /** The input index the server fires a round at that the page fires on
     *  world tick `tick`, or null. */
    roundIndexAt(tick) {
      return this.indexAt(Number.isFinite(tick) ? tick - this.lagAt(tick) : tick);
    },
  };
}
