"""recorpus.py reads the third-party bf1942reverseengineering dumps.

Each build writes its file header differently, and the Mac build keeps some
names mangled in a form c++filt rejects. The fake corpus here has one file of
each shape, so the test runs without the 650 MB checkout.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE = REPO_ROOT / "features" / "bf1942-engine-reference"

spec = importlib.util.spec_from_file_location("recorpus", REFERENCE / "recorpus.py")
recorpus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorpus)

FILES = {
    "decompiled_functions_bf1942exeWinPC/0053b950_FUN_0053b950.c":
        "// Function: FUN_0053b950\n// Address: 0053b950\n\n\nvoid __fastcall FUN_0053b950(int param_1)\n{\n}\n",
    "decompiled_functions_bf42linuxServer/setTeam.c":
        "// Original: setTeam\n// Cleaned: setTeam\n// Address: 0x0805C720\n\n\n"
        "/* dice::bf::BFPlayer::setTeam(int) */\n\nvoid f(void)\n{\n}\n",
    "decompiled_functions_MacClient/dice_bf_BFPlayer_setVehicle_00547c14.c":
        "/*\n * Program: Battlefield 1942\n * Function: dice::bf::BFPlayer::_setVehicle\n"
        " * Entry: 00547c14\n * Naming: semantic\n */\n\n"
        "/* WARNING: Removing unreachable block (ram,0x00547c60) */\n"
        "/* dice::bf::BFPlayer::_setVehicle(dice::ref2::world::IObject*, int) */\n\nvoid f(void)\n{\n}\n",
    "decompiled_functions_MacClient/ZN4dice4ref24rend13PCDX8Renderer17beginBlockClusterERKSsjjS5.c":
        "/*\n * Program: Battlefield 1942\n"
        " * Function: __ZN4dice4ref24rend13PCDX8Renderer17beginBlockClusterERKSsjjS5_\n"
        " * Entry: 0023567c\n * Naming: semantic\n */\n\nvoid f(void)\n{\n}\n",
    "decompiled_functions_bf1942Debugger/00401000_FUN_00401000.c":
        "// Function: FUN_00401000\n// Address: 00401000\n",
    "symbols/exports/confirmed_functions.csv":
        "function_key,build,binary_name,address,decompiled_name,display_name,file_path,symbol_key,"
        "canonical_name,symbol_kind,symbol_confidence,link_confidence_score,rationale,evidence_count,evidence_sources\n"
        "winpc_0053b950,winpc,BF1942.exe,0x0053b950,FUN_0053b950,ProjectileSpawn_Core,x,k,"
        "ProjectileSpawn_Core,function,high,1.0,Builds the projectile list.,1,x\n",
    "@bf1942_engine_knowledge_base.md":
        "- `0053B950` (ProjectileSpawn_Core): builds client projectile list entries\n",
}


class RecorpusTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "corpus"
        for rel, text in FILES.items():
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        # Not a git checkout, so the index is never cached; keep the cache dir private anyway.
        self.cache = mock.patch.object(recorpus, "CACHE_DIR", Path(self.tmp.name) / "cache")
        self.cache.start()

    def tearDown(self) -> None:
        self.cache.stop()
        self.tmp.cleanup()

    def run_cli(self, *args: str) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.dict(os.environ, {"BF1942_RE_REPO": str(self.root)}):
            self.assertEqual(recorpus.main(list(args)), 0)
        return out.getvalue()

    def test_index_reads_every_header_shape(self) -> None:
        rows = {r["path"].split("/")[0]: r for r in recorpus.build_index(self.root)}
        self.assertEqual(rows["decompiled_functions_bf1942exeWinPC"]["addr"], 0x0053B950)
        linux = rows["decompiled_functions_bf42linuxServer"]
        self.assertEqual((linux["addr"], linux["name"]), (0x0805C720, "dice::bf::BFPlayer::setTeam(int)"))
        names = {r["name"] for r in recorpus.build_index(self.root) if r["build"] == "mac"}
        self.assertIn("dice::bf::BFPlayer::_setVehicle(dice::ref2::world::IObject*, int)", names)
        self.assertIn("dice::ref2::rend::PCDX8Renderer::beginBlockCluster(...)", names)

    def test_qualified_name_reads_destructors(self) -> None:
        self.assertEqual(recorpus.qualified_name("__ZN4dice2bf3FooD1Ev"), "dice::bf::Foo::~Foo(...)")
        self.assertEqual(recorpus.qualified_name("_aglDescribeRenderer"), "_aglDescribeRenderer")

    def test_address_inside_a_client_function_finds_its_entry(self) -> None:
        # 0x0053b950 is a real entry in client-functions.txt; 0x0053b960 is inside it.
        out = self.run_cli("0x0053b960")
        self.assertIn("inside the function at 0x0053b950", out)
        self.assertIn("0053b950_FUN_0053b950.c", out)
        self.assertIn("ProjectileSpawn_Core [high]", out)
        self.assertIn("@bf1942_engine_knowledge_base.md:1", out)

    def test_name_query_matches_signatures_across_builds(self) -> None:
        out = self.run_cli("BFPlayer::setTeam")
        self.assertIn("linux    0x0805c720", out)
        out = self.run_cli("PCDX8Renderer::beginBlock", "--build", "mac")
        self.assertIn("dump files (1)", out)

    def test_other_build_address_is_matched_exactly(self) -> None:
        out = self.run_cli("0x0805c720", "--build", "linux")
        self.assertIn("setTeam.c", out)


if __name__ == "__main__":
    unittest.main()
