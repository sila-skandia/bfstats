// The join name rule (features/game-profiles, "Join name"), as the API's
// GameProfileRules.ValidateJoinName takes it: Latin-1 only, no quote, no control
// characters, at most 23 characters. The name rides a fixed-size, single-byte
// field on the game's wire that the server keeps 23 bytes of, and the profile
// file quotes it.

/** The longest name the server keeps (GameServer::createPlayer). */
export const JOIN_NAME_MAX = 23

/** `{ name }` to save (null clears), or `{ error }` saying why it cannot be. */
export function checkJoinName(raw: string | null | undefined): { name: string | null; error: string | null } {
  const name = (raw ?? '').trim()
  if (!name) return { name: null, error: null }
  if (name.includes('"')) return { name: null, error: 'Join name cannot contain a quote' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return { name: null, error: 'Join name contains a control character' }
  if (/[^\u0000-ÿ]/.test(name)) return { name: null, error: 'Join name can only use Western European (Latin-1) letters' }
  if (name.length > JOIN_NAME_MAX) return { name: null, error: `Join name is at most ${JOIN_NAME_MAX} characters` }
  return { name, error: null }
}
