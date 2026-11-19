// The item a real server has in the local player's own soldier's hands, read
// by the page (`net-relay.js` `selfItem`), so the page can raise it when the
// two disagree (`net-room.js` `keepItemWithServer`).
//
// The rows are modelled on a live session (Liberation of Caen, 2026-11-19):
// the soldier (1553, a German AT kit) leaves a Kubelwagen holding the
// Panzerschreck (item 3), the server raises his grenades (item 4) 0.2 s
// later from a number key the page pressed while it still had him seated,
// and he dies (the item sentinel 0xffffffff). The relay acks the page's
// words with his aim, which names the soldier the ack is about.
//
// Run by tests/test_relay_self_item.py.
import { createRelayState } from './net-relay.js';

const out = {};
const st = createRelayState();
const ack = (seq) => ({ k: 'ack', t: 479.5, seq, tick: 12580, serial: 13264, id: 1553, iq: 0, aim: -0.001, twist: 0 });
const stance = (t, tick, item) => ({ k: 'st', t, tick, o: [[1553, 5, 175, -0.001, 0, item, 65]] });

out.before = st.selfItem();
st.ingest(stance(479.576, 12581, 3));
out.noAck = st.selfItem();
st.ingest(ack(11288));
out.panzerschreck = st.selfItem();
st.ingest(stance(479.787, 12588, 4));
out.grenades = st.selfItem();
// Another soldier's stance does not move it.
st.ingest({ k: 'st', t: 480, tick: 12590, o: [[1600, 1, 12, 0, 0, 1, 64]] });
out.otherSoldier = st.selfItem();
st.ingest(stance(489.225, 12871, 4294967295));
out.dead = st.selfItem();

console.log(JSON.stringify(out));
