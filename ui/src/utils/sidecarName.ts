// The sidecar name rule (features/game-profiles, "Sidecar name"), as the API's
// GameProfileRules.ValidateSidecarName and the sidecar's validPlayerName
// (tools/bf1942-models/sidecar/player-name.mjs) take it: the name rides a
// single-byte field the server keeps 23 bytes of, and the profile file quotes it.

/** The longest name the server keeps (GameServer::createPlayer). */
export const SIDECAR_NAME_MAX = 23

/** `{ name }` to save (null clears), or `{ error }` saying why it cannot be. */
export function checkSidecarName(raw: string | null | undefined): { name: string | null; error: string | null } {
  const name = (raw ?? '').trim()
  if (!name) return { name: null, error: null }
  if (name.includes('"')) return { name: null, error: 'Sidecar name cannot contain a quote' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return { name: null, error: 'Sidecar name contains a control character' }
  if (/[^\u0000-ÿ]/.test(name)) return { name: null, error: 'Sidecar name can only use Western European (Latin-1) letters' }
  if (name.length > SIDECAR_NAME_MAX) return { name: null, error: `Sidecar name is at most ${SIDECAR_NAME_MAX} characters` }
  return { name, error: null }
}
