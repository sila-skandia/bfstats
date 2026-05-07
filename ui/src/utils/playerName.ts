// Display-side recovery for player names that arrive as cp1251 bytes wrongly
// decoded as cp1252 by the upstream BFlist API. Mirrors api/Utils/PlayerNameDecoder.cs —
// keep the two in sync.
//
// Heuristic: re-encode the string back to cp1252 bytes; if at least 80% of the
// (latin + non-latin) bytes fall in the cp1251 Cyrillic range (192-255), decode
// as cp1251. Otherwise return the input unchanged.

// Thanks Henk for the algorithm on Discord

const CP1252_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C,
  'Ž': 0x8E,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
};

const cp1251Decoder = typeof TextDecoder !== 'undefined'
  ? new TextDecoder('windows-1251')
  : null;

function toCp1252Bytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    // 0x00-0x7F and 0xA0-0xFF are identity with Unicode codepoints in cp1252;
    // the lookup table covers the 0x80-0x9F Windows extensions.
    bytes[i] = CP1252_HIGH[c] ?? (code <= 0xFF ? code : 0x3F);
  }
  return bytes;
}

export function decodePlayerName(raw: string | null | undefined): string {
  if (!raw || !cp1251Decoder) return raw ?? '';

  const bytes = toCp1252Bytes(raw);
  let latin = 0;
  let nonLatin = 0;
  for (const b of bytes) {
    if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122)) latin++;
    else if (b >= 192 && b <= 255) nonLatin++;
  }

  const total = latin + nonLatin;
  if (total === 0) return raw;

  return nonLatin / total >= 0.8 ? cp1251Decoder.decode(bytes) : raw;
}
