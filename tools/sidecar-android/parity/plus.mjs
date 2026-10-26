// Writes core/src/commonTest/resources/parity/plus.json from the Node sidecar's
// plus.mjs: the bf42++ ConnectAcceptAck marker and its reader, crc8, the
// welcome-line settings parser over the plus harness's edge cases and more,
// the colours, and the restart timing. PlusTest.kt replays them.
//   node parity/plus.mjs
import { sidecar, write, hex } from './lib/fixture.mjs';

const P = await sidecar('plus.mjs');
const out = {};

out.acks = [
  { id: 5 }, { id: 0 }, { id: 255 }, { id: 300 }, { id: 7, version: { major: 1, minor: 6, patch: 3, build: 20 } },
  { id: 7, version: { major: 2, minor: 1, patch: 0, build: 15 }, protocol: 1 }, { id: 9, version: { major: 300, minor: 0, patch: 1, build: 3 }, protocol: 258 },
].map((a) => ({ ...a, hex: hex(P.buildPlusAcceptAck(a.id, a.version, a.protocol)) }));
out.parseAck = ['052b400200000270', '0500400000000000', '052b400200000271', '052b500200000270', '052b4002000002', '',
  hex(P.buildPlusAcceptAck(5)), hex(P.buildPlusAcceptAck(1, { major: 1, minor: 6, patch: 3, build: 20 }))]
  .map((h) => ({ hex: h, out: P.parsePlusAcceptAck(Buffer.from(h, 'hex')) }));
out.crc8 = ['', '313233343536373839', '00', 'ff', '2b4002000002', '0123456789abcdef'].map((h) => [h, P.crc8(Buffer.from(h, 'hex'))]);
out.colors = ['', '#f0a', '#FF8000', 'DodgerBlue', 'dodgerblue', '#12345', 'nocolor', '#-12', '#fff', '#000', '#abcdef', '#ABC', '#gg0', 'red', 'RebeccaPurple', '#', '#1234567', 'f0a']
  .map((c) => [c, P.colorFromString(c)]);
out.colorsNull = P.colorFromString(null);

const templates = ['Mortar', 'flak38', 'Sherman'];
const exists = (n) => templates.some((t) => t.toLowerCase() === n.toLowerCase());
// Each case: a list of lines parsed one after another into one record.
const cases = [
  ['Welcome to the lab'], ['Have fun %UI&nfr&hssdeath~'], ['%3DM&D=50&C=red~ %3DO&t=Mortar&T=MORTAR~'],
  ['a %UI&sbw~ b %UI&hen~ c'], ['%UI&nfr'], ['%UI&nfr~%U-I&sbw~%UI&hen~'], ['%ui&nfr~'], ['%U&nfr~%ABCDE&x~%UI&hssjoin~'],
  ['%3DS&D=99~%3DCP&D=7~'], ['%3DM&D=12abc~'], ['%3DM&D=~'], ['%3DM&D~'], ['%3DM&D=-3~'], ['%3DM&D= +8~'], ['%3DM&D=99999999999999999999999~'],
  ['%3DO&t=Nope&T=x~%3DO&t=Mortar~%3DO&t=mortar&T=second~'], ['%UI&sbw~\0%UI&hen~'], ['%UI&n', 'fr~'],
  ['%3DO&t=Sherman&A&sD&D=40&C=#0f0&T=TANK~', '%3DO&t=flak38&T=&C=nocolor~'], ['%3DO&T=no template~'], ['%3DO&t=~'],
  ['%3DM&T=MINE&T=two&C=#abc&D=5&Z=1~%3DM~'], ['%%UI&hen~~'], ['~%UI&sbw'], ['%UI~%3DM&&D=4~'], ['%UI&=x&hen=~'],
  ['%3DCP&D=12~ text %3DS&X=1~'], ['%UI&hssdeath&hssjoin&nfr&sbw&hen~'], ['%12&a~%A1B2&b~'], ['café %UI&hen~ é'],
];
out.settings = cases.map((lines) => {
  const s = P.defaultServerSettings();
  for (const l of lines) P.parseServerSettings(l, s, { templateExists: exists });
  return { lines, out: s };
});
out.settingsNoTemplates = cases.map((lines) => {
  const s = P.defaultServerSettings();
  for (const l of lines) P.parseServerSettings(l, s);
  return s;
});
out.settingsNull = P.parseServerSettings(null);
out.defaults = P.defaultServerSettings();
out.timing = {
  plus: P.restartTiming({ plus: true }),
  plusNfr: P.restartTiming({ plus: true, settings: P.parseServerSettings('%UI&nfr~') }),
  plusOther: P.restartTiming({ plus: true, settings: P.parseServerSettings('%UI&hen~') }),
  retail: P.restartTiming({ plus: false }),
  retailNfr: P.restartTiming({ plus: false, settings: P.parseServerSettings('%UI&nfr~') }),
  RETAIL_RESTART: P.RETAIL_RESTART, PLUS_RESTART: P.PLUS_RESTART,
};
out.constants = { PLUS_PROTOCOL_VERSION: P.PLUS_PROTOCOL_VERSION, PLUS_VERSION: P.PLUS_VERSION, INVALID_COLOR: P.INVALID_COLOR, templates };

write('plus', out);
