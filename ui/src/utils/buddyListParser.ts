// Parses BF1942-style buddy list files (or plain newline-separated name
// lists) into a deduplicated array of player names. Purely client-side —
// the raw file/text is never sent to the server, only the parsed names.
//
// Real in-game buddy list lines look like:
//   game.addPlayerToBuddyListByName "Latin66"
// Any line that doesn't match that pattern is treated as a plain player
// name, since a lot of users will just paste a newline-separated list.

const BUDDY_LIST_LINE = /^game\.addPlayerToBuddyListByName\s+"(.*)"\s*$/;

export const MAX_BULK_PLAYER_NAMES = 1000;

export interface ParsedBuddyList {
  names: string[];
  truncated: boolean;
}

export function parseBuddyListText(text: string): ParsedBuddyList {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(BUDDY_LIST_LINE);
    // Trim leading/trailing whitespace from the extracted name but keep
    // internal spaces (e.g. "Landing Deductions" stays two words).
    const name = (match ? match[1] : line).trim();
    if (!name || seen.has(name)) continue;

    seen.add(name);
    names.push(name);
  }

  const truncated = names.length > MAX_BULK_PLAYER_NAMES;
  return {
    names: truncated ? names.slice(0, MAX_BULK_PLAYER_NAMES) : names,
    truncated,
  };
}
