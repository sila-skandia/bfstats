"""A deck spawn's world position, against the hull it is supposed to be on.

`_vehicle_soldier_spawn_report` mirrored the pad origin's z at output while
rotating the ship-local offset in the UNMIRRORED frame, so the Z-flip landed
twice and both cross terms of the rotation came out negated. On Midway that put
26 of 26 deck spawns off their own hull and 21 of them over open water, which is
what dropped a soldier into the sea when he picked a ship on the spawn screen.

The rule these tests pin is the one the viewer actually applies:
`shipNode.localToWorld(lx, ly, -lz)` where the node carries `Ry(-yaw_con)`
(`gltf.quat_from_ypr`). Written out, rotating `(lx, -lz)` by `-yaw_con`:

    vx = lx*cos(yaw) + lz*sin(yaw)
    vz = lx*sin(yaw) - lz*cos(yaw)
    world = (ox + vx, oy + ly, -oz + vz)

The old expression was `(lx*cos - lz*sin, lx*sin + lz*cos)` with the whole sum
negated, i.e. the same thing with `sin` negated in both terms.
"""

import math
import unittest


def _viewer_offset(lx, lz, yaw_deg):
    """The fix: mirror z, then rotate by the viewer node's own -yaw."""
    r = math.radians(yaw_deg)
    c, s = math.cos(r), math.sin(r)
    return lx * c + lz * s, lx * s - lz * c


def _old_offset(lx, lz, yaw_deg):
    """What the extractor used to bake, as it reached `scene.json`."""
    r = math.radians(yaw_deg)
    c, s = math.cos(r), math.sin(r)
    wx = lx * c - lz * s
    wz = lx * s + lz * c
    return wx, -wz


def _reference(lx, ly, lz, yaw_deg):
    """`localToWorld` done the long way, as three.js would: build the matrix.

    Deliberately not the same algebra as the code under test -- a rotation
    matrix applied to the mirrored point, so a sign slip in the closed form
    cannot agree with it by construction.
    """
    r = math.radians(-yaw_deg)          # the node's own rotation
    c, s = math.cos(r), math.sin(r)
    # Ry(r) on the mirrored local point (lx, ly, -lz), right-handed:
    #   x' =  x*c + z*s
    #   z' = -x*s + z*c
    x, z = lx, -lz
    return x * c + z * s, ly, -x * s + z * c


class DeckSpawnTransformTests(unittest.TestCase):
    # Midway's own fleet: the pad pose out of ObjectSpawns.con and the offset
    # out of the ship's Objects.con.
    HATSUZUKI_PAD = (3173.63, 20.4371, 2259.6, -127.767)
    HATSUZUKI_DRIVER = (0.0, 12.0, 26.0)

    def test_matches_an_independent_matrix_build(self):
        """The closed form agrees with a rotation matrix on the mirrored point."""
        for yaw in (-127.767, 88.1908, 0.0, 90.0, -90.0, 180.0, 45.0, 137.5):
            for lx, ly, lz in ((0, 12, 26), (4, 9.4, -57), (-4, 9.4, -57),
                               (0, 2.22, -4.7), (12.5, 3.5, 0)):
                with self.subTest(yaw=yaw, offset=(lx, ly, lz)):
                    vx, vz = _viewer_offset(lx, lz, yaw)
                    rx, _, rz = _reference(lx, ly, lz, yaw)
                    self.assertAlmostEqual(vx, rx, places=9)
                    self.assertAlmostEqual(vz, rz, places=9)

    def test_the_old_transform_disagreed_by_twice_the_cross_term(self):
        """The defect, stated as arithmetic: sin is negated in both terms."""
        ox, oy, oz, yaw = self.HATSUZUKI_PAD
        lx, ly, lz = self.HATSUZUKI_DRIVER
        vx, vz = _viewer_offset(lx, lz, yaw)
        ox_old, oz_old = _old_offset(lx, lz, yaw)
        s = math.sin(math.radians(yaw))
        # x differs by 2*lz*sin, z differs by 2*lx*sin.
        self.assertAlmostEqual(vx - ox_old, 2 * lz * s, places=6)
        self.assertAlmostEqual(vz - (-oz + oz_old + oz), 2 * lx * s, places=6)

    def test_hatsuzukis_driver_pad_moves_41_metres(self):
        """The measured size of the error on the owner's own repro."""
        ox, oy, oz, yaw = self.HATSUZUKI_PAD
        lx, ly, lz = self.HATSUZUKI_DRIVER
        vx, vz = _viewer_offset(lx, lz, yaw)
        old_x, old_z = _old_offset(lx, lz, yaw)
        new = (ox + vx, oy + ly, -oz + vz)
        old = (ox + old_x, oy + ly, -oz + old_z + oz - oz)
        moved = math.dist((new[0], new[2]), (old[0], old[2]))
        self.assertGreater(moved, 40.0)
        self.assertLess(moved, 42.0)
        # And the y is untouched by any of this -- the deck height was never
        # in question, which is why the symptom was a soldier in the water
        # rather than one inside a hull.
        self.assertAlmostEqual(new[1], 32.4371, places=4)

    def test_a_yaw_near_ninety_degrees_hides_the_bug_along_the_hull(self):
        """Why one of Midway's eight pads appeared to work, and it is not size.

        The error vector is `(2*lz*sin, 2*lx*sin)` in WORLD axes, so for a
        stern offset it points along world x and its magnitude GROWS towards
        +-90 degrees -- 51.97 m at pad 8's 88.19 against 41.11 m at pad 1's
        -127.767. It is not "worth under a metre" there; it is bigger.

        What saves pad 8 is direction. At a yaw near +-90 the ship's long axis
        is itself along world x, so the whole error runs ALONG a 133.86 m hull
        (51.95 m along, 1.64 m across) and a point 26 m aft is still over deck.
        At pad 1's oblique yaw, 25.18 m of it runs ACROSS a hull only 18.73 m
        wide, so the spawn leaves the ship and the soldier lands on the sea.

        The across-hull component is the thing that decides, and it is what
        this test pins.
        """
        lx, ly, lz = self.HATSUZUKI_DRIVER
        HALF_BEAM = 18.73 / 2

        for yaw, expect_on_hull in ((88.1908, True), (-127.767, False)):
            with self.subTest(yaw=yaw):
                s = math.sin(math.radians(yaw))
                err = (2 * lz * s, 2 * lx * s)
                # The hull's forward axis in viewer space: Ry(-yaw) on (0,0,-1).
                r = math.radians(-yaw)
                fwd = (-math.sin(r), -math.cos(r))
                along = err[0] * fwd[0] + err[1] * fwd[1]
                across = err[0] * -fwd[1] + err[1] * fwd[0]
                # Bigger at 88 degrees, not smaller -- the verdict's stated
                # reason was wrong.
                self.assertGreater(math.hypot(*err), 40.0)
                if expect_on_hull:
                    self.assertLess(abs(across), HALF_BEAM)
                    self.assertGreater(abs(along), 50.0)
                else:
                    self.assertGreater(abs(across), HALF_BEAM)

    def test_an_axis_aligned_pad_is_unaffected_when_the_offset_is_on_axis(self):
        """A zero cross term is a zero error -- the bug needed both."""
        for yaw in (0.0, 180.0):
            with self.subTest(yaw=yaw):
                # lz only, yaw 0: sin is 0, so the two agree exactly.
                self.assertAlmostEqual(
                    math.dist(_viewer_offset(0.0, 26.0, yaw),
                              _old_offset(0.0, 26.0, yaw)),
                    0.0, places=9)


if __name__ == "__main__":
    unittest.main()
