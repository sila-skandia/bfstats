# Replay Shorts: what to build next (2026-11-03)

The owner asked for web research on new clip ideas, "not just themes but
highlight packages for a particular player from a round". A research pass
(sources at the end) was checked against four real rounds; the counts below
are measured, not guessed.

## What the research says

- **Rank by category, then normalise.** Overwatch's Play of the Game scores
  the event log per category (High Score, Lifesaver, Shutdown,
  Sharpshooter) and falls back across categories below a threshold; one
  overweighted stat (Zenyatta's healing) won almost every time until it was
  fixed [1][2].
- **Explain why a moment was picked.** Call of Duty swapped the final
  killcam for "Best Play"; players called it random, and Treyarch brought the
  final killcam back to Search and Destroy [3][4]. The round's deciding
  moment carries its own meaning.
- **Named tiers caption themselves.** Halo's multi-kill medals (Double Kill
  up, kills within about 4.5 s) and spree tiers (5, 10, 15, 20) [5].
- **Auto-clippers** (Medal, NVIDIA Highlights, SteelSeries) trigger on
  kill-feed events with a window either side [6][7][8][9]. chess.com labels
  a move by how much it beat the expected outcome, not the raw stat [10].
- **Per-player packages are queries over tagged events.** WSC Sports tags
  every NBA play by player and type and assembles per-player feeds (25,844
  player highlights in the 2020 playoffs) [11][12].
- **Recaps travel as identity plus a card.** Spotify Wrapped's personality
  labels, Strava's streaks and "training partner" card [13][14][15].
- **Short-form craft:** the payoff or tension in the first 1-2 s; one
  message in picture, a 3-5 word caption and a hard sound; captions 4-7
  words, large, outlined, in the safe area; single moments 8-15 s, packages
  20-30 s; a last frame that matches the first loops [16][17][18]. "POV:"
  framing and unscripted fails work [19].
- **Battlefield culture:** the RendeZook (bail out, rocket the enemy jet,
  get back in) is the series' signature clip, and a "LoopZook" existed in
  BF1942 [20][21][22]; the jet swap [23]; the C4 jeep [24]; BF1942's own
  stunt era (patch 1.3 and earlier) [25]; Wake Island and the carrier [26].

## Measured on four rounds (Meuse, Battle of Britain, Omaha, Savoy)

| Moment | Per round |
|---|---|
| Double kill (2 within 5 s) | 7-20 |
| Triple | 0-4 |
| Quad or more | 0-3 |
| Nemesis pair (5+ kills both ways, or 3+ each way) | 0-6 |
| Revenge within 60 s | 2-17 |
| Best kill streak | 8-25 |
| Bazooka or AT gun on a plane | 0 |

Every count is over everyone the recorder saw. A package about one player
must first check the recording held him most of the round: the share of his
alive time with position samples (call it coverage). Below about 80% his
stats and clips have holes.

## Per-player packages (20-30 s)

1. **Player of the Round.** Cold open on his best moment at the hit with the
   category named ("SHARPSHOOTER 212 m"); the moment played out; his
   second-best from another category; an end card (name, kills, deaths,
   flags, the category). Categories: sharpshooter (distance), multi-kill,
   shutdown (ended someone's 5+ streak), air superiority, objective
   (defenders killed at a flag he took), decider (the last kill or capture of
   the round). Each normalised over all recordings, so one stat cannot win
   every time [1].
2. **The streak.** One life's kills, a counter ticking up on each hit, the
   best few shown when it is long; it ends on the death that stopped it
   ("ENDED BY X") or "UNBEATEN" at the round's end. Tiers in our own words.
3. **Nemesis.** Two players' encounters in order, each from the loser's
   side, a running score ("A 4 - 3 B"), the last one slowed. Ranked by
   encounters times closeness.
4. **The life of a tank (or plane).** Open on the wreck ("This Tiger
   lasted 6 min 12 s"), back to its spawn, each kill made from it with crew
   changes in a lower third, its death with the hit-and-pull-back hold.
5. **Your round in 30 s.** A Wrapped-style recap: the hardest hit as the
   hook, a stat card, three or four 4-5 s clips ("First blood", "Best kill",
   "Worst death", "Flag taken"), a personality label from simple rules
   (Pilot, Tanker, Taxi driver, Flag runner, Kamikaze, Most wanted), an end
   card that matches the opening.
6. **From spawn to flag**, **Taxi service** (teammates delivered and what
   they did within a minute of getting out) and **Revenge** (A kills B, B
   kills A within 60 s of respawning) are smaller packages from the same
   data.

## New single moments

| Moment | Detection | Tone |
|---|---|---|
| Multi-kill (double, triple, quad) | 2+ kill lines by one killer within 5 s | skill, common |
| Bazooka or AT gun on a plane | victim in a plane, killer on foot with an AT weapon | skill, rare (0 in 4 rounds) |
| Parachute snipe / LoopZook | killer left a plane seat within 10 s and killed from the air | legendary, very rare |
| Roadkill | the kill line's weapon is the vehicle he drives | meme |
| Teamkill fail | teamkill, best with a "sorry"/"wtf" in chat after | meme; check the chat |
| Kamikaze plane | a crash with an enemy dead within 2 s and 30 m of it | meme |
| Last stand on a flag | 3+ kills within 30 s near a flag that holds | clutch |
| Round decider | the last kill or capture before the round ends | every round |
| Long dogfight | two planes close for 20 s+ before the kill | skill |
| Grenade across the map | grenade kill at 30 m or more | skill |
| Knife or pistol on a crew just out | victim left a seat within 3 s, killer with a knife or pistol | meme |
| Chat callout | the victim says "hax", "lag", "camper" within 10 s of the kill | meme |

## Recommendation, payoff against effort

1. **Multi-kill.** Kill lines only, the existing camera, 7-20 a round; the
   counter caption is free.
2. **Player of the Round.** Reuses every kind as a category; a scorer and
   an end card. The flagship per-player package.
3. **Nemesis.** Pair counts are cheap; 0-6 a round; about people, so
   shared.
4. **The streak.** Best streaks of 8-25 kills a round; a counter overlay
   and a cut list.
5. **Your round in 30 s.** The most work (stat cards, labels), the most
   shareable; needs the coverage gate.

Craft rules for all of them: open on the payoff, name the category on
screen, 4-7 word captions, no shake or punch, the hit then pull back, end on
a card that matches the open.

## Sources

1. https://www.gamespot.com/articles/how-overwatch-picks-play-of-the-game-moments/1100-6440308/
2. https://www.thegamer.com/blizzard-overwatch-patent-play-of-the-game/
3. https://www.charlieintel.com/black-ops-cold-war/cold-war-players-want-best-play-scrapped-and-final-killcam-to-return-96883/
4. https://www.charlieintel.com/black-ops-cold-war/treyarch-dev-confirms-final-killcam-is-returning-to-black-ops-cold-war-75459/
5. https://www.halopedia.org/List_of_Halo_Infinite_medals
6. https://support.medal.tv/support/solutions/articles/48001167701
7. https://medal.tv/developer/auto-clipping
8. https://www.nvidia.com/en-us/geforce/news/shadowplay-highlights-tutorial
9. https://steelseries.com/blog/how-to-capture-pubg-clips-1170
10. https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-move
11. https://pr.nba.com/nba-wsc-sports-technologies-partnership
12. https://wsc-sports.com/blog/industry-insights/wsc-sports-the-automagical-highlights-behind-the-nba-playoffs/
13. https://www.fastcompany.com/91453511/spotify-wrapped-genius-marketing
14. https://uxdesign.cc/why-is-spotify-wrapped-so-popular-5c503e79a3ee
15. https://support.strava.com/hc/en-us/articles/22067973274509-Your-Year-in-Sport
16. https://blog.eklipse.gg/?p=42508
17. https://clip.dor.gg/en/blog/gaming-shorts-viral-pattern
18. https://opus.pro/blog/ideal-youtube-shorts-length-format-retention
19. https://socialk.it/en/blog/pov-content-format-guide
20. https://www.shacknews.com/article/150510/how-to-perform-a-rendezook-in-battlefield-6
21. https://mp1st.com/news/here-are-some-of-the-best-battlefield-moments-from-the-franchise
22. https://www.gamepro.de/artikel/battlefield-2042-geschichte-reveal-trailer,3371545.html
23. https://kotaku.com/battlefield-4-jet-swap-shows-everyone-how-teamwork-is-d-1471062419
24. https://gameinformer.com/blogs/editors/b/gibertz_blog/archive/2011/11/01/the-best-battlefield-3-moments.aspx
25. https://www.moddb.com/mods/xtreme-battlefield
26. https://www.ea.com/games/battlefield/news/wake-island-now-and-then
