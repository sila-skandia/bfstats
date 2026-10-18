// The double tracer: the server sends the controlling client its own
// control-object state to RECONCILE its predicted gun (readControlObjectState),
// and that state carries the seat's FireArms counter. `GhostWriter` runs
// `_fires` over every SimpleObjectNetworkable in the block, the control record
// (the local player's own hull, `control: true`) included, so a counter step
// down on the OWN hull emits a `k:"f"` round -- which the live page would draw
// on top of the round it already fired from its own prediction (gunfire.js).
//
// This harness documents that the `f` is emitted for BOTH the control record
// and a remote hull, so the page must tell them apart by the firer / the hull
// it controls (net-room.js `isOwnVehicleShot`) rather than by suppressing the
// `f` at the sidecar (which the recording still needs for replay).
import { GhostWriter } from '../sidecar/ghost-writer.mjs';

function firesFor(control) {
  const rows = [];
  const objInfo = new Map([[100, { tid: 1, tmpl: 'Sherman', team: 1 }]]);
  const gw = new GhostWriter({ write: (r) => rows.push(r), objInfo });
  gw.seated.set(100, [{ t: 0, pid: 5 }]);
  const rec = (magA) => ({
    netId: 100, action: 1, cls: 'SimpleObjectNetworkable',
    body: { children: [{ type: 'F', magA }] },
    ...(control ? { control: true } : {}),
  });
  gw.block(0.0, [rec(30)], 0);   // establish the magazine counter
  gw.block(0.1, [rec(29)], 1);   // a shell leaves: the counter steps down
  return rows.filter((r) => r.k === 'f');
}

const control = firesFor(true);
const remote = firesFor(false);
console.log(JSON.stringify({
  // The own hull (control record) emits the round -- the second tracer source.
  control: { n: control.length, gun: control[0]?.w ?? null, id: control[0]?.id ?? null },
  // A remote hull emits it too, so the distinction is the firer, not the row.
  remote: { n: remote.length, gun: remote[0]?.w ?? null },
}, null, 1));
