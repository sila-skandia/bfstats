package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/player-name.mjs; keep in step.
//
// The player name a join presents, checked as retail would take it
// (features/game-profiles). The name rides the CreatePlayer event the client
// queues at the Challenge (session.mjs), a fixed 32-byte field:
//
//   - the client cuts it at 31 bytes (GameEventManager::createPlayerRequest,
//     lnxded 0x0812cf20: `min(len, 0x1f)` bytes into the event);
//   - the server keeps 23 of them (GameServer::createPlayer 0x081310e0:
//     `std::string(name, 0, 0x17)`) and renames a taken one `<name>_<n>`.
//
// So a name longer than 23 bytes is cut to 23 here, where it shows: the
// scoreboard would show the cut name anyway. Neither side filters
// characters, but the field is single bytes (bitstream.mjs writes latin1),
// and the profile's own file holds the name between quotes
// (`game.setPlayerName "<name>"`), so a quote, a control character or a
// character beyond U+00FF has no way to reach the server as typed. Those are
// refused rather than mangled.
//
// Strings are UTF-16 here as in JS, so slice and the two tests run on the
// same code units; trim is JS's (JsOps.trim), not Kotlin's.

/** The longest name the server keeps (GameServer::createPlayer). */
const val SERVER_NAME_BYTES = 23

/** `raw` as the name to join with, or null when there is none to use. */
fun validPlayerName(raw: Any?): String? {
  if (raw !is String) return null
  val t = JsOps.trim(raw)
  if (t.isEmpty()) return null
  if (t.any { it <= '\u001f' || it in '\u007f'..'\u009f' || it == '"' }) return null
  if (t.any { it > 'ÿ' }) return null
  val cut = JsOps.trimEnd(t.substring(0, minOf(t.length, SERVER_NAME_BYTES)))
  return cut.ifEmpty { null }
}
