"""extract_spawn_layout.py's kit rows: vanilla's pointer regions and Desert
Combat's `BfSelectButtonNode`s.

Desert Combat builds its kit column out of a node class the flattener did
not name, so the six rows came out as bare weapon pictures with no plate and
no pointer region: nothing to click, nothing behind them. The rows are
`select` leaves now, carrying the `Kit/SelectedKit` slot each one sets.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import meme  # noqa: E402
from extract_spawn_layout import Flattener, decode_layout  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def _row(y: float, index: int) -> meme.Obj:
    """One Desert Combat row: the select node inside its 256x128 transform."""
    select = meme.Obj("BfSelectButtonNode", fields={
        "Next node": None,
        "Picture": "Ingame/respawn/respawn_middle_256x128.tga",
        "Mouse over picture": "Ingame/respawn/respawn_middle_256x128_MO.tga",
        "Clicked picture": "Ingame/respawn/respawn_middle_256x128_CL.tga",
        "Action": None,
        "Index": index,
        "Current clicked index": meme.Obj("IntData", name="Kit/SelectedKit",
                                          fields={"Value": 0}),
        "Width": 205.0,
        "Height": 69.0,
    })
    return meme.Obj("TransformNode", fields={
        "Next node": None, "X": 0.0, "Y": y, "Width": 256.0, "Height": 128.0,
        "Transformed node": select,
    })


class SelectLeafTests(unittest.TestCase):
    def test_a_select_node_is_a_leaf_with_its_slot_and_three_plates(self) -> None:
        top = meme.Obj("TransformNode", fields={
            "Next node": None, "X": 30.0, "Y": 0.0, "Width": 800.0, "Height": 800.0,
            "Transformed node": _row(466.0, 5),
        })
        flat = Flattener({})
        flat.run([top])
        self.assertEqual([{
            "kind": "select",
            # The node's origin and its own Width/Height: the pointer region.
            "rect": [30.0, 466.0, 205.0, 69.0],
            "texture": "respawn_middle_256x128",
            "hover": "respawn_middle_256x128_mo",
            "clicked": "respawn_middle_256x128_cl",
            "index": 5,
            "var": "Kit/SelectedKit",
        }], flat.elements)
        self.assertEqual(0, flat.variables["Kit/SelectedKit"])

    def test_a_culled_row_carries_its_condition(self) -> None:
        cull = meme.Obj("CullNode", fields={
            "Next node": None,
            "Variable": meme.Obj("BoolData", name="Kit/IsAlive", fields={"Value": True}),
        })
        cull.fields["Next node"] = _row(126.0, 0)
        flat = Flattener({})
        flat.run(cull.chain())
        (el,) = flat.elements
        self.assertEqual([{"var": "Kit/IsAlive", "op": "eq", "value": True}], el["when"])


def _layout(mod: str) -> dict:
    from extract_models import mod_chain
    from bf42.modmenu import MenuSources
    sources = MenuSources(mod_chain(GAME_DIR, mod))
    with sources.open_menu() as menu:
        entry = next(e for e in menu.entries if e.lower() == "menu/ingame")
        return decode_layout(menu.read(entry), {})


@unittest.skipUnless((GAME_DIR / "Mods/DesertCombat").is_dir(), "needs Desert Combat installed")
class DesertCombatKitRowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.elements = _layout("DesertCombat")["groups"]["spawn"]["elements"]

    def test_six_rows_one_per_slot_on_a_68_px_pitch(self) -> None:
        rows = sorted((el for el in self.elements if el["kind"] == "select"),
                      key=lambda el: el["index"])
        self.assertEqual(list(range(6)), [el["index"] for el in rows])
        self.assertEqual([[30.0, 126.0 + 68 * i, 205.0, 69.0] for i in range(6)],
                         [el["rect"] for el in rows])
        self.assertEqual({"Kit/SelectedKit"}, {el["var"] for el in rows})

    def test_each_plate_is_drawn_under_its_row_label_and_picture(self) -> None:
        # File order is paint order: the plate first, then the row's text
        # and its weapon picture over it.
        kinds = [el["kind"] for el in self.elements if el["rect"][0] == 30.0
                 and 126.0 <= el["rect"][1] <= 475.0]
        for i, kind in enumerate(kinds):
            if kind == "select":
                self.assertEqual(["text", "picture", "picture"], kinds[i + 1:i + 4])


@unittest.skipUnless(GAME_DIR.is_dir(), "needs the BF1942 install")
class VanillaKitRowTests(unittest.TestCase):
    def test_vanilla_rows_are_still_the_five_hover_regions(self) -> None:
        elements = _layout("bf1942")["groups"]["spawn"]["elements"]
        self.assertEqual([], [el for el in elements if el["kind"] == "select"])
        hover = [el["hover"] for el in elements if el["kind"] == "hit" and el.get("hover")]
        self.assertEqual(["Kit/MouseOver/MouseOverScout", "Kit/MouseOver/MouseOverAssault",
                          "Kit/MouseOver/MouseOverAT", "Kit/MouseOver/MouseOverMedic",
                          "Kit/MouseOver/MouseOverEngineer"], hover)


if __name__ == "__main__":
    unittest.main()
