// The soldier's view and the rounds it fires, page and server on one law
// (ledger VIEW-14): BFSoldier::handleUpdate 0x08271f68 poses the camera
// rotateXDeg(-2.5 x aimA) x rotateYDeg(-3 x twist) off the body, and
// FireArms::Fire launches a hand weapon's round down that camera (XHIT-12).
// See test_soldier_view_law.py for the assertions.
//
// The numbers are the uphill run's (Wake co-op, 2026-10-17, probe recording
// ps2.ndjson): the page's soldier 632 standing at origin (1161.402, 109.181,
// 748.223) with an identity body, the node client's soldier 640 at origin
// (1162.66, 110.999, 755.90), 1.8 m higher at 7.8 m, and the third burst's
// aim register 9.93 and twist -3.13 (the bursts on target in yaw).
import { GhostWriter } from '../sidecar/ghost-writer.mjs';
import { carrySelfAim } from '../sidecar/soldier-ghost.mjs';
import { createSidecarState, VIEW_PITCH_PER_AIM, VIEW_TWIST_DEG } from '../viewer/net-sidecar.js';
import {
  soldierLookDegrees, SOLDIER_PITCH_GAIN, SOLDIER_YAW_GAIN, SOLDIER_VIEW_PITCH_PER_AIM,
} from '../viewer/mouse-input.js';
import { PITCH_LIMIT_DEG, AIM_PITCH_LIMIT_DEG } from '../viewer/soldier.js';

const res = {};
const SHOOTER = [1161.402, 109.181, 748.223];
const TARGET = [1162.66, 110.999, 755.90]; // his origin; his feet a metre under it
const AIM = 9.93, TWIST = -3.13;

// Where a ray from `eye` along `d` passes the target's upright axis: its
// height over his feet and its miss to the side (engine frame).
function pass(eye, d) {
  const rel = [TARGET[0] - eye[0], TARGET[1] - eye[1], TARGET[2] - eye[2]];
  const k = (rel[0] * d[0] + rel[2] * d[2]) / (d[0] * d[0] + d[2] * d[2]);
  const p = [eye[0] + k * d[0], eye[1] + k * d[1], eye[2] + k * d[2]];
  return { overFeet: +(p[1] - (TARGET[1] - 1)).toFixed(3), side: +Math.hypot(p[0] - TARGET[0], p[2] - TARGET[2]).toFixed(3) };
}

// --- the look law: the view's gains ----------------------------------------
res.look = {
  perCount: soldierLookDegrees(1, 1),
  yawGain: SOLDIER_YAW_GAIN, pitchGain: SOLDIER_PITCH_GAIN, viewPerAim: SOLDIER_VIEW_PITCH_PER_AIM,
  limit: PITCH_LIMIT_DEG, aimLimit: AIM_PITCH_LIMIT_DEG,
  sidecarViewPerAim: VIEW_PITCH_PER_AIM, sidecarTwist: VIEW_TWIST_DEG,
};

// --- the server's round, as the sidecar writes it ---------------------------
{
  const rows = [];
  const w = new GhostWriter({ write: (r) => rows.push(r), objInfo: new Map([[632, { tid: 1754, tmpl: 'USMarineSoldier', team: 2 }]]) });
  w.note({ e: 'control', pid: 1, netId: 632 }, 270);
  const rec = (body) => ({ netId: 632, action: 1, cls: 'BFSoldierNetworkable', pos: SHOOTER, rot: [0, 0, 0, 1], body });
  w.block(278.6, [rec({ lower: 2, upper: 68, aimA: AIM, aimB: TWIST, stateBits: 64, held: 3 })]);
  w.block(278.77, [rec({ upper: 389, stateBits: 1856 })]);
  const f = rows.find((r) => r.k === 'f');
  res.fire = { p: f?.p ?? null, d: f?.d ?? null, pass: f ? pass(f.p, f.d) : null };
  // What the register read as the view put there (the page's old law).
  const pr = AIM * Math.PI / 180, yr = -TWIST * 3 * Math.PI / 180;
  res.registerAsView = pass(f.p, [Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr)]);
}

// --- the page's own view at the acked tick ---------------------------------
{
  const v = createSidecarState();
  v.ingest({ k: 'e', t: 0, e: 'createPlayer', pid: 3, name: 'hprobe', team: 2, ai: 0, netId: 9, vehNetId: 632, camNetId: 10, kitNetId: 0 });
  v.ingest({ k: 'e', t: 0, e: 'control', pid: 3, netId: 632 });
  v.ingest({ k: 'o', t: 0, id: 632, tid: 1754, tmpl: 'USMarineSoldier', team: 2 });
  // The previous datagram's rows: the twist before the turn.
  v.ingest({ k: 's', t: 1, o: [[632, ...SHOOTER, 0, 0, 0, 1]] });
  v.ingest({ k: 'st', t: 1, o: [[632, 2, 68, AIM, -0.81, 3, 64]] });
  // This datagram: the ack first, then its ghost rows (sidecar.mjs, session.mjs).
  v.ingest({ k: 'ack', t: 2, seq: 40, id: 632, aim: AIM, twist: TWIST, q: [0, 0, 0, 1] });
  v.ingest({ k: 's', t: 2, o: [[632, ...SHOOTER, 0, 0, 0, 1]] });
  const row = v.playerRow(4); // what the snapshot the `s` row fires reads
  // The view the reconciler closes the page to, as a direction in the
  // engine's frame (the page's is z negated; forward (sin yaw, 0, cos yaw)).
  const vy = row.viewYaw * Math.PI / 180, vp = row.viewPitch * Math.PI / 180;
  const page = [Math.sin(vy) * Math.cos(vp), Math.sin(vp), -Math.cos(vy) * Math.cos(vp)];
  res.page = {
    viewYaw: row.viewYaw, viewPitch: row.viewPitch, yaw: row.yaw,
    dir: page.map((x) => +x.toFixed(3)),
    pass: pass([SHOOTER[0], SHOOTER[1] + 0.65, SHOOTER[2]], page),
  };
  // An ack from an older sidecar, no twist: the ghost row's twist stands.
  v.ingest({ k: 'ack', t: 3, seq: 41, id: 632, aim: AIM });
  res.pageOldAck = { viewYaw: v.playerRow(4).viewYaw };
  // The row's `aim` stays the register, as the `st` rows and bf42plus carry it.
  res.aimRegister = v.playerRow(4).aim;
}

// --- the sidecar carries the aim forward between control states ------------
{
  const m = new Map();
  res.carry = [
    carrySelfAim(m, 632, { pos: SHOOTER }),
    carrySelfAim(m, 632, { aimA: AIM, aimB: -0.81, rot: [0, 0, 0, 1] }),
    carrySelfAim(m, 632, { aimB: TWIST }),
    carrySelfAim(m, 632, {}),
  ];
}

console.log(JSON.stringify(res, null, 2));
