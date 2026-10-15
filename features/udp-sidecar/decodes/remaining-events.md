# Remaining events: the type-`0x0` phantom and the control-object state

The last two unknowns in `run.review.ndjson` — the "unknown event type `0x0`" and
the ghost block that would not frame because it carried a control-object state —
closed on 2026-10-15. Read from `bf1942_lnxded.static` (1.61 Linux dedicated
server). One was not what it looked like.

## Verdict in one line

**There is no event type `0x0`.** The sidecar's `GameStatus` reader was too
greedy: `GameStatusEvent` writes its five raw bytes and its length-prefixed text
**only when the status byte is 5**, and the reader read them unconditionally, so
it ran 56 bits into the next event and that event's type read as `0x0`. With
`GameStatus` sized correctly the three occurrences vanish and the event they were
hiding (`GameRules`, id `0x16`) appears. **The control-object state is
self-describing** — it opens with a 12-bit length of the fields that follow it —
so a block carrying one frames like any other and needs no field decode to step
over.

## 1. Event type `0x0`

`GameEvent::initEvents` (`0x0811bee0`) registers ids `0x02`…`0x3e` and nothing
else; `GameEvent::getEventMaker` (`0x0811bea0`) returns null for an id that was
never registered, and `GameEventManager::readGameEvent` (`0x0812e2f0`) returns
false when it does. The engine cannot put an event at slot 0 — and the table in
`events.mjs` already carries every id initEvents registers. (The name table
`operator<<(ostream&, GameEventType)` `0x0811b570` has a `GENone` at its lowest
slot, but that enum is offset one below the wire ids — its `GEAckEvent` is 3 while
`initEvents` registers Ack at 2 — so it names nothing on the wire.)

The three review-log lines were a **reading artifact**, not a wire event:

```
{"tag":"unknown-event","dt":2.03,"id":0,"block":8,"bitOffset":891,...}
{"tag":"unknown-event","dt":77.299,"id":0,"block":20,"bitOffset":83,...}
{"tag":"unknown-event","dt":87.297,"id":0,"block":23,"bitOffset":91,...}
```

`GameStatusEvent::serialize` (`0x0811db80`) and its mirror `deSerialize`
(`0x0811daf0`) are unambiguous — the tail is inside an `if (status == 5)`:

```
uVar2 = writeUnsigned(status, 8);
if (status == 5) {                    // deSerialize:  if (cVar1 == '\x05')
  writeBits(+0xd, 0x28);              //   readBits(+0xd, 0x28)      five bytes
  writeUnsigned(len8, 8);             //   u8 length
  writeBits(+0x13, len8 << 3);        //   that many bytes of text
}
```

So a `GameStatus` whose status is not 5 is **8 bits**, not 64. The old reader
(`read status; read 5 bytes; read lstr`) consumed 64 and desynced by exactly
56 bits.

**Confirmation from the join dump.** `sendDatabase` ends its dump with
`… DataBaseComplete, GameStatus(status 1), <13th event>`. Framing a captured
join payload (`probe-unknown.mjs`, full datagram) with the old table decoded the
13th as `0x0`; framing from the byte after an 8-bit `GameStatus` (bit 1576)
decodes it cleanly as **`GameRules`**: `soldierFF 1, externalViews true,
noseCam true, ticketRatio 1, timeLimit 0, worldTime 3151, crosshairCentre true` —
worldTime 3151 against the join's own `Simulation` worldTime 3153.2, and exactly
131 body bits ending 6 bits (byte padding) before the payload end.

**The three occurrences are the three `GameStatus` events that were not the last
event in their block.** In the 3052 s baseline the recording has four
`gameStatus` records — status 1 at the join (t 2.03), 1 at t 55.15, 2 at t 77.30
(round end) and 3 at t 87.30 — and the phantom appears at exactly the three
(t 2.03, 77.30, 87.30) that have a following event in the same block; the t 55.15
one was last in its block, so its 56-bit over-read touched nothing and produced
no phantom.

**Fix** — `events.mjs`, `EVENTS.GameStatus`:

```js
read(r) {
  const status = r.readUnsigned(8);
  if (status !== 5) return { status };
  const extra = r.readBytes(5);
  return { status, extra: Buffer.from(extra), text: r.readLenString() };
}
```

Status 5 carries the payload; the capture never shows it (statuses 1/2/3 only),
so that branch is read from the binary alone. `note: wire.md §3` still documents
the old, unconditional layout — that is the copy to correct.

## 2. The control-object state

Framing, `GhostManager::processReceivedPacket` (`0x081435a0`):

```
u32 tick;  u8 count;  u1 hasControl;
if (hasControl) readControlObjectState(stream);        // 0x081428a0
count × GhostManager::readData(stream);                // 0x08141ed0
```

The control state is **self-describing**, so it is sized without decoding it.
`readControlObjectState` reads a **12-bit length first**; `writeControlObjectState`
(`0x081422b0`) reserves those 12 bits, writes the state, then stores
`endBitPosition − positionAfterTheReservedField` back into them:

```
skipBits(0xc);
iVar3 = getBitPosition();        // right after the reserved 12
… write fields …
uVar9 = getBitPosition() - iVar3;   // the bit count of the fields
setWritePosition(…); writeUnsigned(uVar9, 0xc); resetWritePosition();
```

The state is therefore exactly **`12 + n` bits**, where `n` is that 12-bit field.
Its fields, in order (the writer, which has no branches on this path):

| bits | field | source |
|---|---|---|
| 12 | self length `n` | reserved, filled last |
| 32 | signed control id | `+0xe0` |
| 1 | bool | `+0x128` |
| var | compressed vector, 2-bit mode (0 → three `float32`) | the object's position |
| 16 | u16 netId | `+0xd8` |
| 1 | delta flag | `+0xf8`/`+0xec` state |
| 3 | delta index (when the flag is 0) | `+0xf4` |
| var | the object's own update body | `networkManager +0x30`/`+0x4c` |

**Fix** — `session.mjs`, `_readGhosts`, where a `hasControl` block used to be
logged raw:

```js
if (hasControl) {
  const n = r.readUnsigned(12);
  r.skip(n);                     // 12 + n sizes the state whole
  controlBits = 12 + n;
}
```

**Verification.** A full captured control block (637-byte payload) frames
exactly: `tick 120326, count 20, controlBits 311` (`n = 299`), all 20 records
action 1 with netIds 515–621, and the ghost stream that began at bit 269 ends at
bit **5096 = the payload's last bit** — slack 0. `probe-ctlcap.mjs`.

## 3. The other review tags

| tag | baseline (3052 s, old code) | after (620 s, fixed) |
|---|---|---|
| `unknown-event` | 3 (all id `0x0`) | 0 |
| `ghost-block-raw` | 1 (`control-object-state`) | 0 |
| `unknown-datagram` | 0 | 0 |
| `decode-error` | 1 | 0 |

`coverage.mjs` over the two:

```
BEFORE  events  decoded 488  unknown 3  coverage 99.4%   framed blocks that would not frame 1   decode errors 1
AFTER   events  decoded 136  unknown 0  coverage 100.0%  framed blocks that would not frame 0   decode errors 0
```

(the "after" run is shorter and quieter — 620 s, one join, no round change — so
its event total is not comparable; the review tags are.)

**The decode error** was a single line in 3052 s and did not recur:

```
{"tag":"decode-error","dt":107.332,"where":"event#0","seq":16,"message":"BitReader underflow",
 "hex":"400a0800000010d07f001100000012188800360440e11ff57ada1f00400c000000"}
```

It is a malformed/misaligned event block, not an unsized type or body. The
window's first event can only start at bit 7 of its leading byte (the block
header ends there); read from any other bit it is an unregistered id or a short
clean read, and read from bit 7 it is `0x14` (`Challenge`) — an id the server
never sends mid-round — whose body overruns. Its "challenge" bytes are
`14 10 …`, not lowercase letters, so it is not a real `Challenge`. Nothing in the
fixable framing produces it; it is recorded here so it can be chased if it shows
up again.

## Reproduce

```
cd tools/bf1942-models
# a fresh join produces the join-dump phantom (before the fix) and the
# control-object block; to scratch so the live capture is untouched:
node sidecar/sidecar.mjs 192.168.1.226:14568 --name probe --team 2 --stay 620 \
     --out /tmp/probe.ndjson --review /tmp/probe.review.ndjson
node sidecar/coverage.mjs /tmp/probe.ndjson /tmp/probe.review.ndjson
```

`probe-unknown.mjs` / `probe-ctlcap.mjs` (scratch) reuse `Session` and dump the
full datagram for the first unknown event and the first control block.
