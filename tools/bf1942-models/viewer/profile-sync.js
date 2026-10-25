// The viewer's BF1942 profile on the bfstats.io account (features/game-profiles).
//
// Signed in, the account's active profile is the one the page plays with: it
// is loaded over the localStorage copy (which stays as the offline cache), an
// import or a DEFAULT in OPTIONS > CONTROLS is saved back to the account two
// seconds after the last change, and the controls screen's picker switches
// the active profile. Signed out, offline, or with the API failing, the page
// works from localStorage as before and says so once.
//
// Which profile a change is saved to:
//   - an import of a profile folder goes to the profile of that folder's
//     name (created, or replaced: the site's import does the same) and makes
//     it active;
//   - any other change goes to the active profile;
//   - with no profile at all, one named after the imported folder, else
//     "Viewer".
// A signed-in account with no profiles yet takes the page's local import, so
// a profile imported before signing in is not lost.
//
// The player name the sidecar joins as (`identity`) is the active profile's,
// else the local profile's, else none (net-room.js sends it as the page's
// first action, sidecar.mjs --name-from-page).

import { resolveApi, sharedRecordingsApi } from './recordings-api.js';
import { GENERAL_OPTIONS_FILE } from './controls.js';

export const FALLBACK_PROFILE_NAME = 'Viewer';
const SAVE_DELAY_MS = 2000;
const IDENTITY_WAIT_MS = 5000;

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/**
 * @param {object} options
 * @param {object} options.controls   a `createControls` instance
 * @param {object|Promise|null} [options.api]  a recordings-api client, or a
 *   promise of one; by default the page's own (`resolveApi`)
 * @param {number} [options.debounceMs]
 * @param {(text: string) => void} [options.warn]  said at most once
 */
export function createProfileSync({
  controls,
  api = null,
  debounceMs = SAVE_DELAY_MS,
  warn = text => console.warn(`[profiles] ${text}`),
} = {}) {
  let client = null;
  let state = 'loading';   // loading | signed-out | offline | synced | saving | error
  let detail = '';
  let profiles = [];       // as the API answers them, files included
  let warned = false;
  let pending = null;      // { name, makeActive } of the save waiting for its timer
  let timer = null;
  let generation = 0;      // bumped by every local change, so a late answer never overwrites a newer one
  let saving = null;
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) { try { fn(view()); } catch (e) { console.warn('profiles: a listener failed', e); } } };

  const say = text => {
    detail = text;
    if (warned) return;
    warned = true;
    try { warn(text); } catch { /* a warning never stops the page */ }
  };

  const activeProfile = () => profiles.find(p => p.isActive) ?? null;
  const canSync = () => state === 'synced' || state === 'saving';

  function view() {
    return {
      state, detail,
      active: activeProfile()?.name ?? null,
      profiles: profiles.map(({ name, playerName, isActive, updatedAt }) => ({ name, playerName: playerName ?? null, isActive: !!isActive, updatedAt })),
    };
  }

  /** Keep the API's answer for one profile in the list, by name. */
  function remember(profile, { active = false } = {}) {
    if (!profile || typeof profile.name !== 'string') return;
    const rest = profiles.filter(p => !sameName(p.name, profile.name));
    if (active || profile.isActive) for (const p of rest) p.isActive = false;
    profiles = [...rest, { ...profile, isActive: active || !!profile.isActive }]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function load() {
    try {
      client = await (api ?? sharedRecordingsApi(await resolveApi()));
    } catch (e) {
      client = null;
    }
    if (!client || client.mode === 'remote') {
      state = 'offline';
      say('No account API on this page: the controls are kept in this browser only.');
      changed();
      return;
    }
    let signedIn = false;
    try { signedIn = await client.ready(); } catch { signedIn = false; }
    if (!signedIn) {
      state = 'signed-out';
      say('Not signed in to bfstats.io, or it cannot be reached: the controls are kept in this browser only.');
      changed();
      return;
    }
    try {
      const list = await client.gameProfiles();
      profiles = Array.isArray(list) ? list.filter(p => p && typeof p.name === 'string') : [];
    } catch (e) {
      state = 'error';
      say(`Could not load the account's profiles (${e?.message ?? e}): using this browser's copy.`);
      changed();
      return;
    }
    state = 'synced';
    const active = activeProfile();
    // A change made here while the account was loading wins: it is saved
    // over the account's copy below, so it is not overwritten first.
    if (active && !pending) {
      controls.applyProfile(active);
    } else if (!profiles.length && controls.profileOrigin().source === 'profile' && !pending) {
      // A profile imported in this browser before signing in becomes the
      // account's first.
      queueSave({ name: controls.profileOrigin().folder || FALLBACK_PROFILE_NAME, makeActive: true });
    }
    changed();
  }

  const ready = load().catch(e => {
    state = 'error';
    say(`Profiles unavailable: ${e?.message ?? e}`);
    changed();
  });

  function queueSave(target) {
    pending = target;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, debounceMs);
  }

  /** Send the waiting save now. */
  async function flush() {
    clearTimeout(timer);
    timer = null;
    await ready;
    if (saving) await saving.catch(() => {});
    if (!pending || !canSync()) return;
    const { name, makeActive } = pending;
    pending = null;
    const mine = generation;
    const body = { ...controls.profilePayload(), makeActive };
    // What the page does not hold stays as the account had it: a DEFAULT
    // resets the bindings, not the player's name or general options (retail's
    // DEFAULT is the CONTROLS screen's alone).
    const before = profiles.find(p => sameName(p.name, name));
    const kept = before?.files?.[GENERAL_OPTIONS_FILE];
    if (kept && !body.files[GENERAL_OPTIONS_FILE]) body.files = { ...body.files, [GENERAL_OPTIONS_FILE]: kept };
    if (!body.playerName && before?.playerName) body.playerName = before.playerName;
    state = 'saving';
    changed();
    saving = (async () => {
      try {
        const saved = await client.saveGameProfile(name, body);
        remember(saved && typeof saved === 'object' ? saved : { name, ...body }, { active: makeActive || !!saved?.isActive });
        state = 'synced';
        // The account's copy is the one in use now; nothing newer has been
        // changed here since the save left.
        if (mine === generation && saved?.files) controls.applyProfile(saved);
      } catch (e) {
        state = 'synced';
        if (e?.status === 409) say('The account holds 10 profiles already: delete one on bfstats.io to add another. Kept in this browser.');
        else if (e?.status === 401) { state = 'signed-out'; say('Signed out of bfstats.io: the controls are kept in this browser only.'); }
        else say(`Could not save the profile to the account (${e?.message ?? e}): kept in this browser.`);
      }
      changed();
    })();
    await saving;
    saving = null;
  }

  controls.onChange?.(({ reason }) => {
    if (reason === 'account') return;
    generation += 1;
    const active = activeProfile();
    const folder = controls.profileOrigin().folder;
    // An import of a named folder is that profile; anything else is the
    // active one's change.
    const name = reason === 'import' && folder ? folder : (active?.name ?? folder ?? FALLBACK_PROFILE_NAME);
    const target = { name, makeActive: !active || !sameName(active.name, name) || reason === 'import' };
    if (state === 'loading') { pending = target; ready.then(() => { if (pending === target) queueSave(target); }); return; }
    if (!canSync()) return;
    queueSave(target);
  });

  return {
    ready,
    get state() { return state; },
    get active() { return activeProfile()?.name ?? null; },
    get profiles() { return view().profiles; },
    get api() { return client; },
    view,
    flush,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Make `name` the account's active profile and play with it. */
    async activate(name) {
      await ready;
      if (!canSync()) return false;
      const target = profiles.find(p => sameName(p.name, name));
      if (!target) return false;
      if (pending || timer) await flush();
      try {
        await client.activateGameProfile(target.name);
      } catch (e) {
        say(`Could not switch the profile (${e?.message ?? e}).`);
        changed();
        return false;
      }
      for (const p of profiles) p.isActive = p === target;
      generation += 1;
      controls.applyProfile(target);
      changed();
      return true;
    },

    /** The player name to join a server as: the active account profile's,
     *  else this browser's profile's, else null. Waits for the account at
     *  most `timeoutMs`. */
    async identity({ timeoutMs = IDENTITY_WAIT_MS } = {}) {
      await Promise.race([ready, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
      const active = activeProfile();
      const name = (active?.playerName && String(active.playerName).trim()) || controls.playerName?.() || null;
      return name || null;
    },
  };
}
