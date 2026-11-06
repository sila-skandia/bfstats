# Single-player campaign

Status: built 2026-11-06 for the browser-play feedback's report #3 ("In the
singleplayer menu we can not play the campaign like in the original",
[`../browser-play-feedback-2026-11-06/README.md`](../browser-play-feedback-2026-11-06/README.md),
"#3 No campaign"). Not yet live: the data below has to be published to
mesh.bfstats.io (section 5). Checked under node and against the install; not
yet driven in a real browser.

The engine law is ledger CAMP-1..CAMP-6 (the order, the score rule, the final
grade, the plate, the save, the presets) and AI-20 / AI-21 (what the
difficulty values convert to). This page is what the site built on them.

## 1. What the player gets

- **SINGLEPLAY has retail's row**: CAMPAIGN | INSTANT BATTLE, the file's own
  `menu/SingleplayerNavigation` plates under the tab strip, the way MULTIPLAY
  has its row. The choice that is up is drawn on the clicked plate.
  CAMPAIGN is drawn only once its screen has loaded, so a pack or a site
  without the campaign's data keeps Instant Battle alone.
- **The campaign screen** (`?tab=campaign`) is `menu/CampaignMenu` and
  `menu/CampaignNavigation` drawn from `main-menu-layout.json`: NEW CAMPAIGN /
  CONTINUE CAMPAIGN, TEAM, the CUSTOM / EASY / NORMAL / HARD column with
  OVERALL DIFFICULTY and the three sliders (each up to IMPOSSIBLE), the
  PERFORMANCE block's NUMBER OF BOTS, the level preview, LEVELS (the sixteen
  missions in order, each played one tagged WON or LOST, the one the campaign
  is on tagged NEXT) and STATISTICS (mission, campaign status, won, lost,
  score, kills, deaths, difficulty, bots). START on NEW CAMPAIGN over a side
  that has a campaign asks first, with the game's own words ("YOUR ONGOING
  CAMPAIGN WILL BE OVERWRITTEN", or the FINISHED variant).
- **A mission** launches like Instant Battle (`play/campaign.js` `launchUrl`):
  `map.html?map=<level>&team=<side>&mode=CoOp&botCount=&botSkill=&enemyBots=&tickets=&lossPerMin=&deathPenalty=&campaign=1`.
  The load screen's briefing shows the side's own objectives and, under
  COMMENTS, its campaign story (cut to six lines).
- **Its end** is `menu/LoadMenu`'s single-player plate (CAMP-4): the result's
  title, the side's level line, CURRENT CAMPAIGN STATUS and its bar, the
  player's row, STATISTICS: and DONE / REPLAY / CONTINUE. The score rule
  (CAMP-2) is applied and saved when the plate opens. CONTINUE goes on to the
  next mission, won or lost; REPLAY plays the mission again from the score it
  started with, in place; DONE goes back to the campaign screen.
- **The end of the campaign**: past mission 16, or below a mission's floor
  (TOTAL DEFEAT), CONTINUE shows the side's won or lost picture
  (`allied_win_camp` ..) with its line; a click shows FINAL CAMPAIGN STATUS
  with the grade (CAMP-3) and DONE.

## 2. Decisions (owner, 2026-11-06, and where the code had to choose)

| Question | Decision |
|---|---|
| A lost mission | Copied from retail: it still advances while the score holds its floor |
| Mods | Vanilla only. The screen reads vanilla's pack and levels whatever CUSTOM GAME has picked |
| Saving | This browser's `localStorage`, one campaign a side (`bf42-campaign-1`, `bf42-campaign-2`, the side last picked in `bf42-campaign-team`). The account was considered: `profile-sync.js` syncs a profile folder's files, and retail keeps `campaign.con` outside the profile folder (`save/<profile>/<id>/`), so there is no natural place; left for when the profiles API grows one |
| One campaign a side | CAMP-5 reads the save's id as the side (the TEAM rows call `Campaign/SelectCampaign`). Inferred, not traced |
| Bot count | Retail fills `game.maxNrofPlayers` (18 on Wake), too heavy in a browser. The screen's NUMBER OF BOTS takes its place (0..32, in twos; default 4, Instant Battle's), saved with the campaign. CPU-TIME GIVEN TO AI is not drawn |
| AI SKILLS | AI-20's table: 0.25 / 0.5 / 0.75 / 1.0 as `?botSkill=` (the campaign arm reaches the bots, AI-21) |
| ENEMY VS. FRIENDLY UNITS RATIO | AI-20's pairs read as friendly : enemy (1:1, 3:4, 1:2, 1:3, the reading AI-20 marks inferred). The player's side is the player plus its bots; `campaign.js` `enemyBots` splits the count, ties to the player (1:1 is Instant Battle's split), and `?enemyBots=` deals them (`botTeams`) |
| PLAYER DEATH TICKET PENALTY | AI-20's NrOfLives table (1 / 5 / 10 / 20) read by its label as the tickets the player's own death costs his side (`round-state.js` `playerDeathPenalty`, `?deathPenalty=`). Inferred from the label |
| Tickets | Per side from `SinglePlayer<Side>.con` (`?tickets=`, `?lossPerMin=`), over the CoOp layer's; scaled by the round's slots like every bot round (TKT-1) |
| Difficulty mid-campaign | The column stays live on CONTINUE CAMPAIGN and changes the saved campaign (retail's behaviour there was not read) |
| A slider click in a preset | Turns the column to CUSTOM with the preset's values |
| REPLAY | Offered, as retail does: the mission again in place (`restartRound`), the score put back |
| Statistics | The player's score, kills and deaths summed over the campaign, from the board's row at each mission's end. Retail's per-weapon and per-vehicle rows are not kept |
| The SP briefing plate | Not drawn: retail loads a mission on `sp_briefing_512x512`, whose layout was not extracted. The multiplayer briefing plate carries the side's words instead |

## 3. The pieces

| File | What |
|---|---|
| `tools/bf1942-models/bf42/campaign.py` | The map list's reader, the floor / cap tables, the final grades |
| `tools/bf1942-models/extract_campaign.py` | Writes `campaign.json` into the menu pack: the order, each mission's per-side tickets and words, the score rule, the strings |
| `tools/bf1942-models/extract_main_menu_layout.py` | Adds `singleplayerNav`, `campaign`, `campaignNav` to `main-menu-layout.json` (optional pages: a menu chain without them still builds) |
| `tools/bf1942-models/extract_debriefing_layout.py` | Adds `campaign` to `debriefing-layout.json`: `menu/LoadMenu`'s single-player groups, the status bar as a `fillbar` leaf |
| `tools/bf1942-models/extract_menu_layout.py` | `menu-levels.json` gains `campaign.levels` and each level's `campaignMission` |
| `tools/bf1942-models/bf42/level.py`, `scene_layers.py` | `parse_briefing` reads `set<Side>Campaign / Objectives / Hints / Skirmish` into `briefing.campaign` (the `game` layer); a hint whose lexicon record is its own key (every vanilla one) is dropped |
| `viewer/play/campaign.js` | The law: score, progression, REPLAY, saving, the launch address, the bot split |
| `viewer/play/campaign-screen.js` | The campaign screen |
| `viewer/campaign-debriefing.js` | The end-of-mission plate and its buttons |
| `viewer/play/front-end.js`, `index.html`, `skirmish.js`, `nav-strip.js` | The SINGLEPLAY row (`paintChosen`), the tab |
| `viewer/map.html`, `round-end.js`, `round-state.js`, `level-load.js`, `briefing-screen.js` | `?campaign=1`: the round held at its end, the plate in place of the multiplayer one, the tickets, bots and penalty, the briefing's words |

Also fixed with it: Instant Battle's LEVELS list cut a title that would run
over its NO BOTS tag (INVASION OF THE PHILIPPINES) short with `...`
(`menu-screen.js` `fitText`).

## 4. How it was checked

- `tests/test_campaign.mjs` (node, 28 cases), run by `tests/test_campaign.py`:
  the score rule and its tables, a loss that advances and one that ends the
  campaign, the cap, REPLAY's undo, sixteen missions to a grade, the
  `CampaignVictory` triples, saving per side (unreadable, other-version and
  refusing storage read as none), the presets, the bot split, the launch
  address, the campaign page's rows, SINGLEPLAY's row through `nav-strip.js`
  (and a pack without it), the plate's buttons and last screen, and the
  long-title cut.
- `tests/test_campaign.py`: the map list, the tables, the briefing verbs; and
  against the install (`BF1942_GAME_DIR`, wine's, or the CrossOver bottle):
  the order, Wake's per-side tickets, the words, the campaign pages in the
  menu pack and the single-player plates in the debriefing pack.
- The existing `test_main_menu_layout`, `test_menu_layout`,
  `test_debriefing_layout` and `test_level` pass against the install (run
  with `HOME` pointing at a folder whose `.wine` links the CrossOver bottle);
  the multiplayer pages and plate come out byte-identical to the live ones.
- A node smoke run of `createCampaignScreen` and `createCampaignDebriefing`
  over stub DOM and the extracted packs: load, the difficulty rows, a slider,
  the bot trough, TEAM, START and its warning, the plate's REPLAY, CONTINUE
  to the next mission's address, and the last screen to DONE.

Open: a real browser pass of the screen and a played mission; the final
grade's bands in our own binary (CAMP-3); whether the save's id is the side
(CAMP-5); the SP briefing plate.

## 5. Publishing

Extracted on 2026-11-06 from the CrossOver install into the worktree's
`tools/bf1942-models/viewer/maps/_shared/hud/` (gitignored). To go live
(`maps/_shared/hud/...` on the assets volume):

- `menu/campaign.json` (new)
- `menu/main-menu-layout.json`: the live file plus the three campaign pages,
  their textures, fonts and strings. Built on a Mac with only vanilla and the
  two expansions installed, so the extractor's `modBadges` there list three
  mods; the file to publish keeps the live `modBadges` and badge textures
  (merged in the scratch copy that goes up). Re-running the extractor on a
  machine with every mod installed gives the same file
- `menu/textures/menu_campaign2_tab_512x32.png`, `menu_campaign_stat_256x256.png`
  (the page's other plates and `trebuchet_ms18_latin` are live already,
  byte-identical, from the Instant Battle pack)
- `debriefing/debriefing-layout.json` (the multiplayer half unchanged)
- `debriefing/textures/`: `sp_debriefing_512x512`, `sp_debriefing_small_512x64`,
  `statusbar`, `statusbar_full`, `allied_win_camp`, `allied_lose_camp`,
  `axis_win_camp`, `axis_lose_camp`, `knapp3_n`, `knapp3_mo`, `knappext_n`,
  `knappext_mo` (`.png`)

Not needed for the page: `menu-levels.json`'s campaign order (the screen
reads `campaign.json`), and `briefing.campaign` in each level's `scene.json`
(the page falls back to `campaign.json`; the next
`patch_scene.py --layer game --mod bf1942 --all` writes it).
