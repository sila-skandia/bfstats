"""A seat Camera's `setPivotPosition` moves the eye (`viewer/camera-pivot.js`).

`Camera::handleUpdate` (lnxded 0x081aa940) builds the camera's transform as
`T(pivotPosition) * R(angles) * bundle`, so the eye is the node plus the pivot
turned by the node's own rotation. The half-track's ring-mount Browning is the
case that shows it: `M3A1Camera2` sits at console z = -0.499 turned 180 degrees
(glTF +0.499 after the z mirror) and declares `setPivotPosition 0/0.3/-1`, which
puts the eye 0.3 m up and 1 m behind the node -- behind the receiver rather than
inside the barrel.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

SCRIPT = r"""
const { applyCameraPivot, applyCameraPivots, cameraPivotOffset } =
  await import(process.argv[1]);
const node = (userData, position, quaternion) => ({
  userData, position: { ...position },
  quaternion: quaternion || { x: 0, y: 0, z: 0, w: 1 },
  children: [],
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); },
});
// M3A1Camera2 exactly as the Wake bake ships it.
const half = { x: 0, y: 0.9999999999619228, z: 0, w: 8.726646260010393e-06 };
const m3a1 = node({ templateKind: 'Camera', physics: { pivotPosition: [0, 0.3, -1] } },
  { x: 0, y: 0, z: 0.499 }, half);
const first = applyCameraPivot(m3a1);
const second = applyCameraPivot(m3a1);
// WillyCamera: unrotated, a head nudge up and forward.
const willy = node({ templateKind: 'Camera', physics: { pivotPosition: [0, 0.25, 0.3] } },
  { x: -0.38, y: 0.95, z: 1.25 });
applyCameraPivot(willy);
// No pivot, a zero pivot, and a pivot on something that is not a Camera.
const sherman = node({ templateKind: 'Camera' }, { x: 0, y: 0.3, z: -0.5 }, half);
const zero = node({ templateKind: 'Camera', physics: { pivotPosition: [0, 0, 0] } }, { x: 1, y: 2, z: 3 });
const wing = node({ templateKind: 'Wing', physics: { pivotPosition: [0, 1, 0] } }, { x: 0, y: 0, z: 0 });
const root = node({}, { x: 0, y: 0, z: 0 });
root.children.push(sherman, zero, wing);
const moved = applyCameraPivots(root);
console.log(JSON.stringify({
  first, second, m3a1: m3a1.position, willy: willy.position,
  sherman: sherman.position, zero: zero.position, wing: wing.position, moved,
  offset: cameraPivotOffset(m3a1.userData),
}));
"""


class CameraPivotTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", SCRIPT, (VIEWER / "camera-pivot.js").as_uri()],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.results = json.loads(proc.stdout)

    def assertPos(self, got: dict, want: tuple[float, float, float]) -> None:
        for axis, value in zip("xyz", want):
            self.assertAlmostEqual(got[axis], value, places=4, msg=f"{axis}: {got}")

    def test_the_halftrack_gunner_eye_backs_out_behind_the_receiver(self) -> None:
        # 0.499 + R_y(180)(0, 0.3, +1) = (0, 0.3, 0.499 - 1)
        self.assertPos(self.results["m3a1"], (0.0, 0.3, -0.501))

    def test_the_pivot_is_applied_once(self) -> None:
        self.assertTrue(self.results["first"])
        self.assertFalse(self.results["second"])

    def test_the_offset_is_mirrored_into_gltf_axes(self) -> None:
        self.assertEqual(self.results["offset"], [0, 0.3, 1])
        # Refractor +z (forward) is glTF -z.
        self.assertPos(self.results["willy"], (-0.38, 1.2, 0.95))

    def test_nodes_without_a_camera_pivot_are_left_alone(self) -> None:
        self.assertPos(self.results["sherman"], (0.0, 0.3, -0.5))
        self.assertPos(self.results["zero"], (1.0, 2.0, 3.0))
        self.assertPos(self.results["wing"], (0.0, 0.0, 0.0))
        self.assertEqual(self.results["moved"], 0)


if __name__ == "__main__":
    unittest.main()
