// What BF42++ (bf42plus, the community client most servers expect) adds to
// the wire, from the client's side. features/udp-sidecar/wire.md section 30 is
// the inventory with the source lines; this module is the part the sidecar
// needs to join a bf42++-aware server as a bf42++ client does:
//
//   * the marker a bf42++ client writes into its ConnectAcceptAck, by which a
//     server tells it from a retail client (bfhook.cpp
//     patch_add_plus_version_to_accept_ack, lines 338-366);
//   * the server settings a bf42++ server hides in its welcome lines
//     (settings.cpp ServerSettings::parseFromText, lines 306-395, and
//     parseNextParameter, 272-304), parsed exactly as the client parses them;
//   * the map-change restart timing those settings switch (bfhook.cpp
//     patch_quicker_server_pinging_on_restart, lines 114-148).
//
// The three game events bf42++ adds (HUDText 0x01, CreateStaticObject 0x1c,
// UpdateStaticObject 0x1d) are in events.mjs with the rest of the table.

// bfhook.cpp:30. "Increment this on breaking network protocol change": 1 was
// the marker (7d57ff2), 2 added HUDTextEvent (f924835).
export const PLUS_PROTOCOL_VERSION = 2;

// The version this PC's bf42++ build reports: src/version.h build_version_full
// "2.0.0-0-0", read by get_build_version_components (bfhook.cpp:323) as
// major 2, minor 0, patch 0, build 0.
export const PLUS_VERSION = Object.freeze({ major: 2, minor: 0, patch: 0, build: 0 });

// util.cpp:195 crc8: init 0xff, polynomial 0x97, MSB first, no final xor.
export function crc8(bytes) {
  let crc = 0xff;
  for (const b of bytes) {
    crc ^= b;
    for (let n = 0; n < 8; n++) crc = (crc & 0x80) ? (((crc << 1) ^ 0x97) & 0xff) : ((crc << 1) & 0xff);
  }
  return crc;
}

// The 8-byte ConnectAcceptAck with the bf42++ marker. The retail builder
// (BF1942.exe 0x0060f390) sends an uninitialised 8-byte stack buffer with
// [0] = the connection id and the u16 at [1] masked `& 0x0fff | 0x4000`, so
// byte 1 and the low nibble of byte 2 survive and bytes 3..7 are whatever was
// on the stack: the server reads only the id and the type. bf42++ fills the
// buffer first (hooked at 0x0060f393, before the original code runs):
//   [1] '+'  [2] 0x40 | min(build, 15)  [3] major  [4] minor  [5] patch
//   [6] PLUS_PROTOCOL_VERSION  [7] crc8 of [1..6]
// and the retail code then writes [0] and re-applies the mask, which keeps all
// of it (the type nibble is already 4).
export function buildPlusAcceptAck(id, version = PLUS_VERSION, protocol = PLUS_PROTOCOL_VERSION) {
  const b = Buffer.alloc(8);
  b[0] = id & 0xff;
  b[1] = 0x2b; // '+'
  b[2] = 0x40 | (Math.min(version.build ?? 0, 15) & 0x0f);
  b[3] = (version.major ?? 0) & 0xff;
  b[4] = (version.minor ?? 0) & 0xff;
  b[5] = (version.patch ?? 0) & 0xff;
  b[6] = protocol & 0xff;
  b[7] = crc8(b.subarray(1, 7));
  return b;
}

// A server's reading of an ack: the marker, or null for a retail client.
export function parsePlusAcceptAck(buf) {
  if (!buf || buf.length < 8 || buf[1] !== 0x2b || (buf[2] >> 4) !== 4) return null;
  if (crc8(buf.subarray(1, 7)) !== buf[7]) return null;
  return { build: buf[2] & 0x0f, major: buf[3], minor: buf[4], patch: buf[5], protocol: buf[6] };
}

// --- server settings ---------------------------------------------------------

// util.h:40
export const INVALID_COLOR = 0xffffffff;

// util.cpp:108 webcolors, sorted, looked up case-blind (_stricmp).
const WEBCOLORS = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4,
  azure: 0xf0ffff, beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd,
  blue: 0x0000ff, blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887, cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00, chocolate: 0xd2691e, coral: 0xff7f50, cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc, crimson: 0xdc143c, cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9, darkgreen: 0x006400, darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b, darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f, darkorange: 0xff8c00,
  darkorchid: 0x9932cc, darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f, darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3, deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969,
  dimgrey: 0x696969, dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0,
  forestgreen: 0x228b22, fuchsia: 0xff00ff, gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff,
  gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080, green: 0x008000, greenyellow: 0xadff2f,
  grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4, indianred: 0xcd5c5c, indigo: 0x4b0082,
  ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa, lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080, lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2, lightgray: 0xd3d3d3, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa,
  lightslategray: 0x778899, lightslategrey: 0x778899, lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff,
  maroon: 0x800000, mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db, mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585,
  midnightblue: 0x191970, mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5,
  navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23,
  orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6, palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093, papayawhip: 0xffefd5,
  peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd, powderblue: 0xb0e0e6,
  purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f, royalblue: 0x4169e1,
  saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f,
  steelblue: 0x4682b4, tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8, tomato: 0xff6347,
  turquoise: 0x40e0d0, violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff, whitesmoke: 0xf5f5f5,
  yellow: 0xffff00, yellowgreen: 0x9acd32,
};

// util.cpp:143 GetColorFromString: "#rgb" / "#rrggbb" (std::from_chars base 16
// over the whole rest, so no sign and no "0x"), else a web colour name.
export function colorFromString(name) {
  if (!name) return INVALID_COLOR;
  if (name[0] === '#') {
    const hex = name.slice(1);
    if ((name.length !== 4 && name.length !== 7) || !/^[0-9a-fA-F]+$/.test(hex)) return INVALID_COLOR;
    const c = parseInt(hex, 16);
    if (name.length === 4) {
      return ((0xf00000 & (c << 12)) | (0x0f0000 & (c << 8)) | (0x00f000 & (c << 8))
        | (0x000f00 & (c << 4)) | (0x0000f0 & (c << 4)) | (0x00000f & c)) >>> 0;
    }
    return c >>> 0;
  }
  const v = WEBCOLORS[name.toLowerCase()];
  return v === undefined ? INVALID_COLOR : v;
}

// strtol(value.data(), 0, 10). The value is a view into the line, so strtol
// reads on past it; but a value always ends at '&' or the setting's '~', which
// stop it, so the value alone decides. A key with no '=' hands strtol a null
// pointer (undefined behaviour in the client); taken as 0 here.
function strtol10(s) {
  const m = /^[\s]*([+-]?\d+)/.exec(s ?? '');
  return m ? parseInt(m[1], 10) : 0;
}

// ServerSettings (settings.h:273-311), with the client's defaults. The 3D map
// switches decide nothing on the wire or in the simulation (the client draws
// markers); they are parsed so the record is complete.
export function defaultServerSettings() {
  return {
    mine3DMap: { allow: false, distance: 30, color: 0xff1493, text: '*MINE*' },
    supplyDepot3DMap: { allow: false, distance: 65 },
    controlPoint3DMap: { allow: false, distanceRadiusFactor: 4 },
    custom3DMaps: [],           // [{templateName, text, distance, color, onlySameTeam, showDistance}]
    UI: {
      openSpawnScreenOnDeath: true,
      openSpawnScreenOnJoin: true,
      allowFasterRestart: true,
      skipBriefingWindow: false,
      showEnemyNametags: true,
    },
    seen: [],                   // every setting name read, in order (the record's, not the client's)
  };
}

// parseNextParameter (settings.cpp:274): one "&key[=value]" off the front.
function nextParameter(view) {
  if (!view.s.startsWith('&')) return null;
  view.s = view.s.slice(1);
  const m = /[=&~]/.exec(view.s);
  const end = m ? m.index : view.s.length;
  const key = view.s.slice(0, end);
  view.s = view.s.slice(end);
  let value = null; // no '=': an empty view whose data() is null
  if (view.s.startsWith('=')) {
    view.s = view.s.slice(1);
    const amp = view.s.indexOf('&');
    value = amp < 0 ? view.s : view.s.slice(0, amp);
    view.s = view.s.slice(value.length);
  }
  return { key, value };
}

// ServerSettings::parseFromText (settings.cpp:306), run by the client on the
// text of every WelcomeMsgEvent it receives (gameevent.cpp:153-157), one line
// at a time: a setting must sit inside one welcome line. `into` accumulates as
// the client's global does (nothing resets it but a new process).
// `templateExists(name)` stands in for ObjectTemplate::getTemplateByName; a
// 3DO whose template is unknown is dropped, as the client drops it.
export function parseServerSettings(text, into = defaultServerSettings(), { templateExists = null } = {}) {
  let str = String(text ?? '');
  // The line is a C string: the client stops at the first NUL.
  const nul = str.indexOf('\0');
  if (nul >= 0) str = str.slice(0, nul);
  for (let pos; (pos = str.indexOf('%')) >= 0;) {
    str = str.slice(pos + 1);
    const end = str.indexOf('~');
    if (end < 0) break;                                   // no closing character: stop
    const setting = str.slice(0, end);
    const nm = /^[A-Z0-9]*/.exec(setting)[0];
    // Anything but '&' after the name ends the whole line's parse (a break,
    // not a continue, in the client).
    if (nm.length < setting.length && setting[nm.length] !== '&') break;
    const params = { s: setting.slice(nm.length) };
    if (nm.length > 1 && nm.length <= 4) {
      into.seen.push(nm);
      let p;
      if (nm === '3DM') {
        into.mine3DMap.allow = true;
        while ((p = nextParameter(params))) {
          if (p.key === 'D') into.mine3DMap.distance = strtol10(p.value);
          else if (p.key === 'C') into.mine3DMap.color = colorFromString(p.value ?? '');
          else if (p.key === 'T') into.mine3DMap.text = p.value ?? '';
        }
      } else if (nm === '3DS') {
        into.supplyDepot3DMap.allow = true;
        // settings.cpp:347: the client writes the MINE map's distance here,
        // so a supply map's D moves the mine markers' range. Kept.
        while ((p = nextParameter(params))) if (p.key === 'D') into.mine3DMap.distance = strtol10(p.value);
      } else if (nm === '3DCP') {
        into.controlPoint3DMap.allow = true;
        // settings.cpp:353: the same slip as 3DS.
        while ((p = nextParameter(params))) if (p.key === 'D') into.mine3DMap.distance = strtol10(p.value);
      } else if (nm === '3DO') {
        const c = { templateName: '', text: '', distance: 30, color: 0xffff00, onlySameTeam: true, showDistance: false };
        let ok = false;
        while ((p = nextParameter(params))) {
          if (p.key === 't') {
            c.templateName = p.value ?? '';
            ok = templateExists ? !!templateExists(c.templateName) : true;
            if (!ok) break;
          } else if (p.key === 'T') c.text = p.value ?? '';
          else if (p.key === 'D') c.distance = strtol10(p.value);
          else if (p.key === 'C') c.color = colorFromString(p.value ?? '');
          else if (p.key === 'A') c.onlySameTeam = false;
          else if (p.key === 'sD') c.showDistance = true;
        }
        if (ok) {
          if (!c.text) c.text = c.templateName;
          // std::map::emplace: a template already present keeps its first entry.
          const key = c.templateName.toLowerCase();
          if (!into.custom3DMaps.some((x) => x.templateName.toLowerCase() === key)) into.custom3DMaps.push(c);
        }
      } else if (nm === 'UI') {
        while ((p = nextParameter(params))) {
          if (p.key === 'hssdeath') into.UI.openSpawnScreenOnDeath = false;
          else if (p.key === 'hssjoin') into.UI.openSpawnScreenOnJoin = false;
          else if (p.key === 'nfr') into.UI.allowFasterRestart = false;
          else if (p.key === 'sbw') into.UI.skipBriefingWindow = true;
          else if (p.key === 'hen') into.UI.showEnemyNametags = false;
        }
      }
    }
    // Advance past the setting, leaving the '~' (the next search starts on it).
    str = str.slice(setting.length);
  }
  return into;
}

// --- the map-change restart --------------------------------------------------

// The retail client's restart pinger (BF1942.exe): first ServerInfoRequest
// 16 s after the wait starts (0x004b6ffd writes 16.0 at +0xc), then every 3 s
// (0x004b6f69 writes 3.0 at +8). wire.md section 29, RECON-6.
export const RETAIL_RESTART = Object.freeze({ firstProbeMs: 16000, probeMs: 3000 });
// bf42++ with its `fasterMapchange` option (default on, settings.h:202):
// 1.0 at +0xc and 2.0 patched over the 3.0 (bfhook.cpp:114-135), unless the
// server's welcome lines carried UI&nfr (allowFasterRestart false), which
// writes the retail 16.0 back.
export const PLUS_RESTART = Object.freeze({ firstProbeMs: 1000, probeMs: 2000 });

export function restartTiming({ plus = true, settings = null } = {}) {
  if (!plus) return RETAIL_RESTART;
  // nfr restores only the first delay: the 2.0 interval is patched at start-up
  // regardless (bfhook.cpp:134-135), so a bf42++ client then probes at 16 s,
  // 18 s, 20 s ...
  if (settings && settings.UI && settings.UI.allowFasterRestart === false) {
    return { firstProbeMs: RETAIL_RESTART.firstProbeMs, probeMs: PLUS_RESTART.probeMs };
  }
  return PLUS_RESTART;
}
