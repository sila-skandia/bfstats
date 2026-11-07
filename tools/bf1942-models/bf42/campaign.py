"""The single-player campaign as retail BF1942 1.61 runs it.

The order is data: `Bf1942/Game/CampaignMapList.con` in `Game.rfa`, sixteen
`Game.addLevel <Level>` lines, read by the client's campaign setup
(`FUN_006da1d0`, the path string at `0x009242e8`). There is one list for both
sides; which side the player fights on is the campaign menu's TEAM pick, and
every mission runs that side's `SinglePlayer<Side>.con` under Conquest's rules.

The score rule is code, and these are its tables. After each mission's round
(`GameServer::gameStatusPlaying`, client `FUN_004b1160` at
`0x004b24bb`..`0x004b24e6`, lnxded `0x08150df0` at `0x0815190d`; mission
number at `GameServer+0x30c`, 1-based, only while `Setup+0x15c` is 0):

  - the previous score is kept (`+0x304`), so REPLAY can put it back;
  - a win adds the round's victory type (minor 1, major 2, total 3), a loss
    takes twice it off (`+0x300`);
  - the campaign is over (`+0x310`) when the score is below the mission's
    floor (`totalDefeat`, client `0x008db9c0`, lnxded `0x086c0ae0`);
  - then the score is capped at the mission's ceiling (`totalVictory`, client
    `0x008dba00`, lnxded `0x086c0b20`);
  - the status bar is `(score - floor) / (cap - floor)` (`+0x314`).

The final grade after mission 16 is the Mac client's
`DebriefingMenu::debriefing` (the third-party corpus; not yet read in our own
binary): below -3 a total defeat, below 4 a major one, below 10 a minor one,
below 19 a minor victory, below 24 a major one, else a total victory.

Nothing here reads an archive: `extract_campaign.py` hands in the text.
"""

from __future__ import annotations

import re

#: Per mission, 1..16: below this the campaign is lost (client `0x008db9c0`).
CAMPAIGN_FLOOR: tuple[int, ...] = (-2,) * 4 + (-3,) * 4 + (-4,) * 8
#: Per mission, 1..16: the score is capped here (client `0x008dba00`).
CAMPAIGN_CAP: tuple[int, ...] = (5, 7, 9, 11, 13, 15, 17, 17, 17, 19, 20, 21, 22,
                                 23, 24, 25)
#: The final grade's upper bounds, worst first (Mac `DebriefingMenu::debriefing`).
FINAL_GRADES: tuple[tuple[str, int | None], ...] = (
    ("totalDefeat", -3), ("majorDefeat", 4), ("minorDefeat", 10),
    ("minorVictory", 19), ("majorVictory", 24), ("totalVictory", None),
)

_ADD_LEVEL = re.compile(r"^\s*game\.addlevel\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?",
                        re.IGNORECASE)


def parse_campaign_map_list(text: str) -> list[dict]:
    """`Game.addLevel <Level> [<mode> <mod>]` lines, in file order.

    Vanilla's lines carry the level alone; the mode is Conquest's
    (`GPM_CQ`) and the mod the one the list ships in, so both default.
    `rem` lines are skipped.
    """
    out: list[dict] = []
    for line in text.splitlines():
        if line.strip().lower().startswith("rem"):
            continue
        match = _ADD_LEVEL.match(line)
        if not match:
            continue
        level, mode, mod = match.groups()
        out.append({"level": level, "dir": level.lower(),
                    "mode": mode or "GPM_CQ", "mod": mod or "bf1942"})
    return out


def score_rule() -> dict:
    """The tables and the rule, as `campaign.json` carries them."""
    return {
        "floor": list(CAMPAIGN_FLOOR),
        "cap": list(CAMPAIGN_CAP),
        "win": "score += victoryType (minor 1, major 2, total 3)",
        "loss": "score -= 2 * victoryType",
        "over": "score < floor[mission]: the campaign is lost (TOTAL DEFEAT)",
        "clamp": "then score = min(score, cap[mission])",
        "bar": "(score - floor[mission]) / (cap[mission] - floor[mission])",
        "finalGrades": [{"grade": grade, "below": below} for grade, below in FINAL_GRADES],
        "source": "GameServer::gameStatusPlaying: client FUN_004b1160 "
                  "0x004b24bb..0x004b24e6, floor 0x008db9c0, cap 0x008dba00; "
                  "lnxded 0x08150df0 at 0x0815190d (0x086c0ae0 / 0x086c0b20). "
                  "Final grades: Mac DebriefingMenu::debriefing (corpus lead).",
    }


def final_grade(score: int) -> str:
    """The grade the last debriefing gives a finished campaign."""
    for grade, below in FINAL_GRADES:
        if below is None or score < below:
            return grade
    return FINAL_GRADES[-1][0]
