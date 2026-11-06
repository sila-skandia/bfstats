#!/usr/bin/env python3
"""Extract the single-player campaign: its missions, their sides, their words.

The SINGLEPLAY > CAMPAIGN screen (`viewer/play/campaign-screen.js`) and a
campaign round's end (`viewer/campaign-debriefing.js`) read one file,
`campaign.json`, written into the menu pack beside `menu-levels.json`:

  order     the sixteen missions of `Bf1942/Game/CampaignMapList.con`
            (`Game.rfa`), in the file's order: each one's level directory,
            the title the game's own lists show (`lexiconAll.dat`), the mode
            (`GPM_CQ`) and the mod
  levels    per mission and per side (`allied`, `axis`): the tickets of the
            side's own `SinglePlayer<Side>.con` (both teams' counts and
            bleeds, and its `game.maxNrofPlayers`), and the side's words
            from the level's `Menu/Init.con` (`setAlliedCampaign`,
            `setAlliedObjectives`, `setAlliedHints`, `setAlliedSkirmish`,
            resolved through the chain's lexicon; a key the lexicon does not
            answer is dropped, which on vanilla is every hint)
  score     the score rule and its floor and cap tables (`bf42/campaign.py`)
  strings   the lexicon strings the campaign screen and its debriefing draw
            that no page of theirs carries: the overwrite warnings, the
            campaign's final titles and the statistics labels

The menu page itself (`menu/CampaignMenu`, `menu/CampaignNavigation` and the
SINGLEPLAY row, `menu/SingleplayerNavigation`) is `extract_main_menu_layout.py`'s;
the end-of-mission plate (`SP_debriefing_512x512`, the status bar, DONE /
REPLAY / CONTINUE and the four campaign-over pictures) is
`extract_debriefing_layout.py`'s.

Usage:
    python3 tools/bf1942-models/extract_campaign.py [--game-dir DIR] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR, build_pools, mod_chain  # noqa: E402
from extract_hud_pack import hud_dir_for  # noqa: E402
from extract_menu_layout import chain_level_archives, level_title, title_index  # noqa: E402
from extract_spawn_layout import load_chain_lexicon  # noqa: E402
from bf42.campaign import parse_campaign_map_list, score_rule  # noqa: E402
from bf42.level import load_briefing, load_level_files, parse_tickets  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402

MAP_LIST = "bf1942/game/campaignmaplist.con"

#: The lexicon keys the campaign draws outside any page's own text nodes.
STRING_KEYS = (
    "MENU_CAMPAIGN", "SINGLEPLAYER_NEW_CAMPAIGN", "SINGLEPLAYER_CONTINUE_CAMPAIGN",
    "CONFIRMATION_NEW_CAMPAIGN", "CONFIRMATION_FINISHED_CAMPAIGN",
    "DEBRIEFING_ALLIED_VICTORY", "DEBRIEFING_AXIS_VICTORY",
    "DEBRIEFING_ALLIED_DEFEAT", "DEBRIEFING_AXIS_DEFEAT",
    "DEBRIEFING_CAMPAIGN_STATUS", "DEBRIEFING_CAMPAIGN_STATUS_FINAL",
    "DEBRIEFING_TOTAL_VICTORY", "DEBRIEFING_MAJOR_VICTORY", "DEBRIEFING_MINOR_VICTORY",
    "DEBRIEFING_TOTAL_DEFEAT", "DEBRIEFING_MAJOR_DEFEAT", "DEBRIEFING_MINOR_DEFEAT",
    "DEBRIEFING_DRAW", "DEBRIEFING_DONE", "DEBRIEFING_REPLAY", "DEBRIEFING_CONTINUE",
    "DEBRIEFING_STATISTICS",
    "STATISTICS_SCORE", "STATISTICS_KILLS", "STATISTICS_DEATHS",
)

#: `SinglePlayer<Side>.con` at a level's root, by the side's key.
SIDE_SCRIPTS = {"allied": "SinglePlayerAllied.con", "axis": "SinglePlayerAxis.con"}


def tickets_report(info) -> dict | None:
    """A `TicketInfo` as the page's `?tickets=` takes it, or None."""
    if info is None or (info.team1 is None and info.team2 is None):
        return None
    out = {"team1": info.team1, "team2": info.team2,
           "lossPerMin": {"team1": info.loss_per_min_team1,
                          "team2": info.loss_per_min_team2}}
    if info.max_players is not None:
        out["maxPlayers"] = info.max_players
    return out


def mission_record(files, lexicon: dict[str, str] | None) -> dict:
    """One mission's sides: the tickets and the words for each."""
    briefing = load_briefing(files, lexicon)
    sides: dict[str, dict] = {}
    for side, script in SIDE_SCRIPTS.items():
        hit = files.find(script)
        if not hit:
            continue
        record: dict = {"script": script}
        tickets = tickets_report(parse_tickets(files.read(hit).decode("latin-1", "replace")))
        if tickets:
            record["tickets"] = tickets
        words = (briefing.campaign.get(side) if briefing else None) or {}
        if words:
            record["briefing"] = dict(sorted(words.items()))
        sides[side] = record
    return sides


def build_campaign(game_dir: Path, mod: str = "bf1942") -> dict:
    chain = mod_chain(game_dir, mod)
    sources = MenuSources(chain)
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    titles = title_index(load_chain_lexicon(sources.lexicon_paths, keep="first"))
    _, _, _, game = build_pools(chain, [])
    name = next((n for n in game.names() if n.lower() == MAP_LIST), None)
    if name is None:
        raise SystemExit(f"{mod}'s Game.rfa has no Bf1942/Game/CampaignMapList.con")
    order = parse_campaign_map_list(game.read(name).decode("latin-1", "replace"))
    archives = chain_level_archives(chain)
    levels: dict[str, dict] = {}
    for mission in order:
        paths = archives.get(mission["dir"])
        if not paths:
            print(f"warning: {mission['level']}: no level archive", file=sys.stderr)
            continue
        mission["title"] = level_title(mission["level"], titles)[0]
        levels[mission["dir"]] = mission_record(load_level_files(paths, mission["dir"]), lexicon)
    return {
        "source": f"{name} (Game.rfa), each mission's SinglePlayer<Side>.con and "
                  "Menu/Init.con, lexiconAll.dat",
        "mod": mod,
        "order": order,
        "levels": levels,
        "score": score_rule(),
        "strings": {key: lexicon[key] for key in STRING_KEYS if key in lexicon},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose campaign to read (default: bf1942; the "
                             "campaign is vanilla's alone, owner 2026-11-06)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's menu pack)")
    args = parser.parse_args()
    out = args.out or (hud_dir_for(args.mod) / "menu")
    data = build_campaign(args.game_dir.expanduser(), args.mod)
    out.mkdir(parents=True, exist_ok=True)
    (out / "campaign.json").write_text(json.dumps(data, indent=1) + "\n")
    print(f"{len(data['order'])} missions, {len(data['levels'])} with levels, "
          f"{len(data['strings'])} strings -> {out / 'campaign.json'}")


if __name__ == "__main__":
    main()
