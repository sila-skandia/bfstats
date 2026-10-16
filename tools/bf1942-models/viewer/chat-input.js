/* The text chat input: K opens a say-all line, L a say-team line, and while
 * the line is open the keyboard is its own.
 *
 * Read out of BF1942.exe (sha256 60c9452d...cd3699); the evidence is in
 * `features/radio-and-chat-log/README.md`, "Typing a chat line":
 *
 * - `menu/InGame`'s chat box: a group at (-3, 350) in the 800 x 600 screen,
 *   the prompt (`INGAME_CHAT_SAY_ALL` "SayAll>" / `INGAME_CHAT_SAY_TEAM`
 *   "SayTeam>") at (10, 0) and the BfEditNode at (10, 14), 340 x 21, both
 *   left-set with the black outline (`BfLeftOutlineStyle`) in one colour
 *   (0.957, 0.953, 0.535), the edit box's `Max characters` 63. Each half
 *   shows under its own cull variable, `Chat/ChatBoxSayAll` /
 *   `Chat/ChatBoxSayTeam`.
 * - Open (0x006AC0A0 / 0x006AC0E0): one of the two flags up, the other down,
 *   the edit box focused. The key that opened it is never typed: the frame
 *   that opens the line drains the character queue (0x004466D0).
 * - The line's key handler (0x006AC5E0): Backspace edits, Tab is dropped,
 *   Enter sends (say all 0x006AC120, say team 0x006AC290) and closes; the
 *   left and right keys move the caret; every other character is typed at
 *   the caret.
 * - Send: an empty line sends nothing (the length test in 0x006AC120); the
 *   box closes either way (0x006AC560 clears the text and both flags).
 * - The caret: a 2-px bar the line's height at the caret's glyph, shown
 *   while the box's blink timer is non-negative; the timer starts at -0.4,
 *   gains the frame time, and goes back to -0.4 once it reaches 0.4
 *   (0x007DE44A..0x007DE468, drawn by 0x007DEB10): 0.4 s off, 0.4 s on.
 *
 * Escape cancels the line here. The retail box has no Escape of its own; the
 * page's line has nowhere else to go, so Escape is its way out.
 *
 * Imports nothing and touches no DOM: `tests/chat_input_harness.mjs` drives
 * it under node.
 */

/** The edit box's `Max characters`, and the wire's limit (CHAT-2: the
 *  sender cuts a line at 0x3f bytes). One latin1 byte per character. */
export const CHAT_MAX_BYTES = 63;

/** The blink timer's bounds (0x007DE44A: `+0x24` restarts at -0.4 once it
 *  reaches 0.4). */
export const CARET_BLINK = 0.4;

/** The box in the 800 x 600 virtual screen (`menu/InGame`, the group at
 *  (-3, 350) and its two children). */
export const CHAT_BOX = Object.freeze({
  prompt: Object.freeze([7, 350, 150, 20]),
  edit: Object.freeze([7, 364, 340, 21]),
  color: Object.freeze([0.9570313096046448, 0.953125, 0.5351560115814209]),
  caretWidth: 2,
});

/** The prompt's lexicon keys, and their English text as the fallback. */
export const PROMPT_KEYS = Object.freeze({ all: 'INGAME_CHAT_SAY_ALL', team: 'INGAME_CHAT_SAY_TEAM' });
export const PROMPT_FALLBACK = Object.freeze({ all: 'SayAll>', team: 'SayTeam>' });

/** A character the line can carry: one latin1 byte, printable. The wire is
 *  latin1 (sidecar/chat.mjs), so a character past 0xFF would arrive as `?`. */
export function typeable(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x20 && c <= 0xff && c !== 0x7f && !(c >= 0x80 && c < 0xa0);
}

/** The prompt text for a line: the lexicon's own string, else English. */
export function promptText(team, names) {
  const key = team ? PROMPT_KEYS.team : PROMPT_KEYS.all;
  return names?.[key] ?? (team ? PROMPT_FALLBACK.team : PROMPT_FALLBACK.all);
}

/**
 * The open line. `send(text, team)` is called once per Enter on a non-empty
 * line; the caller decides where it goes (the room, or the log).
 */
export class ChatInput {
  constructor({ send = null, maxBytes = CHAT_MAX_BYTES } = {}) {
    this.send = send;
    this.maxBytes = maxBytes;
    this.isOpen = false;
    this.team = false;
    this.text = '';
    this.cursor = 0;
    this.blink = -CARET_BLINK;
    this.version = 0;
  }

  /** K (`team` false) or L (true). Opening the other kind while one is open
   *  switches the prompt and keeps the text, as the two flags do. */
  open(team) {
    this.isOpen = true;
    this.team = !!team;
    this.blink = -CARET_BLINK;
    this.version++;
  }

  /** 0x006AC560: the text cleared, both flags down. */
  close() {
    if (!this.isOpen && !this.text) return;
    this.isOpen = false;
    this.text = '';
    this.cursor = 0;
    this.version++;
  }

  /** Enter. True when a line was handed to `send`. */
  submit() {
    if (!this.isOpen) return false;
    const { text, team } = this;
    this.close();
    if (!text.length) return false;
    this.send?.(text, team);
    return true;
  }

  insert(ch) {
    if (!typeable(ch) || this.text.length >= this.maxBytes) return false;
    this.text = this.text.slice(0, this.cursor) + ch + this.text.slice(this.cursor);
    this.cursor++;
    this.version++;
    return true;
  }

  backspace() {
    if (this.cursor <= 0) return false;
    this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
    this.cursor--;
    this.version++;
    return true;
  }

  move(step) {
    const next = Math.max(0, Math.min(this.text.length, this.cursor + step));
    if (next === this.cursor) return false;
    this.cursor = next;
    this.version++;
    return true;
  }

  /**
   * One keydown while the line is open, `{ code, key, ctrlKey, metaKey,
   * altKey }`. Every key is the line's (the answer is true, the caller
   * swallows it), except a Ctrl or Meta chord, which is left to the browser
   * untyped (`'pass'`); either way none reaches the game.
   */
  keydown(e) {
    if (!this.isOpen) return false;
    const code = e.code ?? '';
    if (code === 'Enter' || code === 'NumpadEnter') { this.submit(); return true; }
    if (code === 'Escape') { this.close(); return true; }
    if (code === 'Backspace') { this.backspace(); return true; }
    if (code === 'ArrowLeft') { this.move(-1); return true; }
    if (code === 'ArrowRight') { this.move(1); return true; }
    if (code === 'Tab') return true;
    // AltGr arrives as Ctrl+Alt and types (`@` on a German board).
    if ((e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.altKey)) return 'pass';
    this.insert(e.key);
    return true;
  }

  /** The blink timer, once a frame. True when the caret changed phase. */
  tick(dt) {
    if (!this.isOpen) return false;
    const was = this.caretShown();
    this.blink += dt;
    if (this.blink >= CARET_BLINK) this.blink = -CARET_BLINK;
    return was !== this.caretShown();
  }

  caretShown() {
    return this.isOpen && this.blink >= 0;
  }

  state() {
    return { open: this.isOpen, team: this.team, text: this.text, cursor: this.cursor,
      caret: this.caretShown() };
  }
}
