// The pre-join look sidecar.mjs gets under the parity driver
// (sidecar-preload.mjs resolves its server-query.mjs here): the script's
// answer, after the script's delay on the fake clock. SidecarHarness.kt's
// queryServerLevel is the Kotlin twin.
const P = globalThis.__sidecarParity;

export async function queryServerLevel() {
  if (P.prejoinDelayMs) await new Promise((r) => setTimeout(r, P.prejoinDelayMs));
  if (P.prejoin === 'throw') throw new Error('no answer');
  return P.prejoin ?? null;
}
