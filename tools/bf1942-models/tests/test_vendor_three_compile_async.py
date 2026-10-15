"""The vendored three.js (r169) keeps the r170 guard in `compileAsync`.

`WebGLRenderer.compileAsync` polls each material's program from a timer. A
material disposed between the compile and the poll has no program, and r169's
`program.isReady()` threw inside the timer: the promise never settled, and the
page's warm-ups that wait on it never finished; `arms-rig.js` shows a
first-person rig only once its warm-up lands. Four FHSWEurope levels reported
the page error "Cannot read properties of undefined (reading 'isReady')"
(`v_behaviour_new`, 2026-10-16). (The scout's Katana not raised on
battle_of_edson_s_ridge, first blamed on this, was the round ending under the
kit phase: `audit_behaviour.mjs` now runs the flags last.) Upstream fixed
it in r170 (the copy in `ui/node_modules/three` has it); a re-vendor of r169
would bring the hang back.
"""

import unittest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "viewer" / "vendor" / "three.module.js"


class CompileAsyncGuard(unittest.TestCase):
    def test_a_disposed_material_does_not_stall_the_poll(self):
        text = VENDOR.read_text()
        start = text.index("this.compileAsync = function")
        body = text[start:start + 2500]
        self.assertIn("program === undefined || program.isReady()", body)
        self.assertNotIn("if ( program.isReady() )", body)


if __name__ == "__main__":
    unittest.main()
