"""Constructs an isolated, sub-second mock BF1942 and EoD game tree in temporary storage."""

from __future__ import annotations

import tempfile
from pathlib import Path

from .synthetic_rfa import SyntheticRfaBuilder
from .synthetic_images import create_synthetic_tga, create_synthetic_dxt1_dds
from .synthetic_audio import ensure_tiny_bik_fixture


class SyntheticGameTree:
    """Constructs a minimal, valid BF1942 & EoD directory hierarchy in a temporary directory."""

    def __init__(self, create_output_dir: bool = True) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.dest = self.root / "output"
        if create_output_dir:
            self.dest.mkdir(parents=True, exist_ok=True)
        self._build_tree()

    def _build_tree(self) -> None:
        bik_path = ensure_tiny_bik_fixture()
        bik_bytes = bik_path.read_bytes() if bik_path.exists() else b"BIKf" + b"\x00" * 4096

        # ------------------------------------------------------------------- #
        # 1. Vanilla BF1942 Mod Tree
        # ------------------------------------------------------------------- #
        bf_dir = self.root / "Mods" / "bf1942"
        bf_dir.mkdir(parents=True, exist_ok=True)
        (bf_dir / "init.con").write_text(
            'Game.setLoadMusicFilename "music/vehicle4.bik"\n',
            encoding="latin-1",
        )
        music_dir = bf_dir / "Music"
        music_dir.mkdir(parents=True, exist_ok=True)
        (music_dir / "Vehicle4.bik").write_bytes(bik_bytes)

        # menu.rfa with chrome and 7 theaters
        menu_builder = SyntheticRfaBuilder()
        menu_builder.add_file(
            "menu/Texture/Briefing/menu_loading.dds",
            create_synthetic_dxt1_dds(512, 64),
        )
        menu_builder.add_file(
            "menu/Texture/loading_full_256x16.dds",
            create_synthetic_dxt1_dds(256, 16),
        )
        theaters = ["Desert", "Eastern", "Eastern2", "Pacific", "Pacific2", "Western", "Western2"]
        for theater in theaters:
            menu_builder.add_file(
                f"menu/Texture/Load/{theater}.tga",
                create_synthetic_tga(800, 600, color=(127, 124, 73)),
            )
        menu_builder.write(bf_dir / "Archives" / "menu.rfa")

        # Vanilla level RFAs under Archives/bf1942/levels/
        levels_dir = bf_dir / "Archives" / "bf1942" / "levels"
        levels_dir.mkdir(parents=True, exist_ok=True)

        # Wake Island
        wake_builder = SyntheticRfaBuilder()
        wake_builder.add_text("Menu/init.con", "game.setLoadPicture Load/Pacific2.tga\n")
        wake_builder.write(levels_dir / "Wake.rfa")

        # Battle of Britain (custom override picture)
        britain_builder = SyntheticRfaBuilder()
        britain_builder.add_text(
            "Menu/init.con",
            "game.setLoadPicture ../../bf1942/levels/battle_of_britain/menu/texture/Load/Britain_Load.tga\n",
        )
        britain_builder.add_file(
            "bf1942/levels/Battle_of_Britain/Menu/Texture/Load/Britain_Load.tga",
            create_synthetic_tga(800, 600, color=(80, 100, 120)),
        )
        britain_builder.write(levels_dir / "Battle_of_Britain.rfa")

        # ------------------------------------------------------------------- #
        # 2. Eve of Destruction (EoD) Mod Tree
        # ------------------------------------------------------------------- #
        eod_dir = self.root / "Mods" / "EoD"
        eod_dir.mkdir(parents=True, exist_ok=True)
        (eod_dir / "init.con").write_text(
            'game.setLoadMusicFilename "music/vehicle4.bik"\n',
            encoding="latin-1",
        )
        eod_music = eod_dir / "music"
        eod_music.mkdir(parents=True, exist_ok=True)
        (eod_music / "vehicle4.bik").write_bytes(bik_bytes)

        # EoD level RFAs under archives/bf1942/levels/ (lowercase archives for Linux case tests)
        eod_levels_dir = eod_dir / "archives" / "bf1942" / "levels"
        eod_levels_dir.mkdir(parents=True, exist_ok=True)

        # Operation Hastings
        hastings_builder = SyntheticRfaBuilder()
        hastings_builder.add_text(
            "Menu/init.con",
            "game.setLoadPicture ../../bf1942/levels/operation_hastings/menu/loader.tga\n",
        )
        hastings_builder.add_file(
            "bf1942/levels/Operation_Hastings/Menu/loader.tga",
            create_synthetic_tga(800, 600, color=(50, 90, 40)),
        )
        hastings_builder.write(eod_levels_dir / "Operation_Hastings.rfa")

    def cleanup(self) -> None:
        self.tmp.cleanup()
