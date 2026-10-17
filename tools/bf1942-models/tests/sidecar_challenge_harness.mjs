// The sidecar's answer to a Challenge (`sidecar/session.mjs`
// `challengeResponses`): one ChallengeResponse for the base game, and a
// second for the expansion a Challenge names. Prints one JSON blob for
// `tests/test_sidecar_challenge.py`.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { challengeResponses } = await import(pathToFileURL(path.join(here, '..', 'sidecar', 'session.mjs')).href);

// A Secret Weapons lab server's Challenge, as it arrived (2026-10-17).
const challenge = Buffer.from('77646a76756a62776300', 'hex');
process.stdout.write(JSON.stringify({
  sw: challengeResponses({ challenge, xpack: 783, mod: 'xpack2' }),
  rtr: challengeResponses({ challenge, xpack: 713, mod: 'xpack1' }),
  vanilla: challengeResponses({ challenge, xpack: -1, mod: 'bf1942' }),
}));
