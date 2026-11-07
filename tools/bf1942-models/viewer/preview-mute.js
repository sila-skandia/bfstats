// `?mute`: a silent page, for previews and automated checks that should not
// play the menu loop or the battle through someone's speakers.
//
// The flag is kept for the tab (sessionStorage), so a level launched from a
// muted menu is muted too without every launch address carrying it; `?mute=0`
// clears it. It only silences: the menu music starts in its muted state and
// the game's master volume reads 0, so everything else runs as normal. That is
// unlike `?shots&noaudio`, the performance experiment that creates no audio at
// all.

const KEY = 'bf42.previewMute';

/** Whether this page should be silent. Never throws: storage may be blocked. */
export function previewMuted(search = globalThis.location?.search ?? '',
                             storage = globalThis.sessionStorage) {
  try {
    const query = new URLSearchParams(search);
    if (query.has('mute')) {
      const on = query.get('mute') !== '0';
      try {
        if (on) storage?.setItem(KEY, '1');
        else storage?.removeItem(KEY);
      } catch { /* blocked storage: this page alone */ }
      return on;
    }
    return storage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
