# The client's console commands

Every console command the retail 1.61 client (`BF1942.exe`) registers, read out of
its static-initialiser table by `tools/bf1942-models/surveys/census_console_registry.py`
(ledger CON-20). Generated: edit the script, not this file. The analysis is
`console.md` section 12.

2218 registrations, 2116 distinct names, on 73 objects. Viewer: 53 built, 77 would fit (follow-ups), 189 server or network, 1546 level or template script data, 353 engine or editor internals.

Columns: type (method, property = read/write, read-only), arguments `min-max (types)`,
return type, access bits (1 and 2 pass at the prompt; 4 only in an archive script, CON-22),
the viewer's verdict. `built` words are in `viewer/page-console.js` and
`viewer/console-commands.js`; `fits` words say what they would hook to.

## Console (23)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Console.bindKeyToConsoleScript` | method | 2-2 (int, std::string) | bool | 2 | engine |
| `Console.debugOutputOnlyToFile` | property | 0-1 (bool) | bool | 2 | engine |
| `Console.drawFpsGraph` | property | 0-1 (bool) | bool | 1 | fits: a frame-time graph under the FPS readout |
| `Console.echo` | property | 0-1 (bool) | bool | 2 | built |
| `Console.echoErrors` | property | 0-1 (bool) | bool | 2 | built |
| `Console.engineSpeed` | property | 0-1 (float) | float | 2 | built |
| `Console.getActiveMethods` | method | 1-1 (std::string) | std::string | 2 | built |
| `Console.getArgumentTypes` | method | 2-2 (std::string, std::string) | std::string | 2 | built |
| `Console.getReturnType` | method | 2-2 (std::string, std::string) | std::string | 2 | built |
| `Console.isDynamic` | method | 2-2 (std::string, std::string) | std::string | 2 | engine |
| `Console.listConstants` | method | 0-1 (std::string) | std::string | 2 | fits: needs the var/const keywords |
| `Console.listVariables` | method | 0-1 (std::string) | std::string | 2 | fits: needs the var/const keywords |
| `Console.maxCommandHistorySize` | property | 0-1 (int) | int | 2 | built |
| `Console.maxHistorySize` | property | 0-1 (int) | int | 2 | built |
| `Console.maxLineSize` | property | 0-1 (int) | int | 2 | fits: the 77-character edit buffer, a constant here |
| `Console.run` | method | 1-5 (std::string, std::string, std::string, std::string, std::string) | std::string | 2 | fits: fetch a .con file from the mod tree and run it line by line |
| `Console.showClientPredictionStatus` | property | 0-1 (bool) | bool | 2 | engine |
| `Console.showFPS` | property | 0-1 (bool) | bool | 1 | built |
| `Console.showNetGraph` | property | 0-1 (bool) | bool | 1 | fits: the relay's packet rates (net-relay.js) |
| `Console.showStats` | property | 0-1 (bool) | bool | 1 | built |
| `Console.useRelativePaths` | property | 0-1 (bool) | bool | 2 | engine |
| `Console.workingPath` | property | 0-1 (std::string) | std::string | 2 | engine |
| `Console.worldsize` | property | 0-1 (int) | int | 2 | engine |

## Game (325)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Game.addFirstNameOnTeam` | method | 2-2 (U32, std::string) | void | 2 | data |
| `Game.addLanguageRunTimeDirectory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.addLevel` | method | 3-3 (std::string, std::string, std::string) | void | 2 | data |
| `Game.addModPath` | method | 1-1 (std::string) | void | 2 | data |
| `Game.addModServerInfoIcon` | method | 2-2 (std::string, std::string) | void | 2 | server |
| `Game.addPlayerToBuddyList` | method | 1-1 (int) | bool | 1 | server |
| `Game.addPlayerToBuddyListByName` | method | 1-1 (std::string) | bool | 1 | server |
| `Game.addSecondNameOnTeam` | method | 2-2 (U32, std::string) | void | 2 | data |
| `Game.aiPathfindingDebuggingActive` | property | 0-1 (bool) | bool | 2 | data |
| `Game.aiSensingDebuggingActive` | property | 0-1 (bool) | bool | 2 | data |
| `Game.alliedChatColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Game.alliedRadioColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Game.ASEPort` | property | 0-1 (int) | int | 2 | server |
| `Game.assultTeam` | property | 0-1 (U8) | U8 | 2 | data |
| `Game.autoBalanceTeam` | property | 0-1 (bool) | bool | 2 | server |
| `Game.autoSpawnBots` | property | 0-1 (bool) | bool | 2 | data |
| `Game.axisChatColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Game.axisRadioColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Game.buddyList` | method | 0-0 | std::string | 1 | server |
| `Game.changePlayerName` | method | 1-1 (std::string) | bool | 1 | fits: the profile's name (profile-sync.js) |
| `Game.chatDstBlendFunc` | property | 0-1 (std::string) | std::string | 2 | engine |
| `Game.chatOutline` | property | 0-1 (bool) | bool | 2 | engine |
| `Game.chatSrcBlendFunc` | property | 0-1 (std::string) | std::string | 2 | engine |
| `Game.clearDebugLines` | method | 0-0 | void | 2 | data |
| `Game.clientPunkBuster` | property | 0-1 (bool) | bool | 1 | server |
| `Game.clientsidePrediction` | property | 0-1 (bool) | bool | 2 | server |
| `Game.clientsideSleepingPhysics` | property | 0-1 (bool) | bool | 2 | server |
| `Game.clientsideSleepingPhysicsDist` | property | 0-1 (float) | float | 2 | server |
| `Game.commandRate` | property | 0-1 (float) | float | 2 | server |
| `Game.connectionType` | property | 0-1 (ConnectionType) | ConnectionType | 2 | server |
| `Game.connectToServer` | method | 2-2 (std::string, std::string) | bool | 2 | server |
| `Game.connectToServer` | method | 1-4 (std::string, int, std::string, float) | ConnectResult | 2 | server |
| `Game.continueCampaign` | method | 4-4 (bool, std::string, int, bool) | void | 2 | engine |
| `Game.continueSkirmish` | method | 1-1 (bool) | void | 2 | engine |
| `Game.createAIPlayer` | method | 3-4 (std::string, int, KitType, dice::ref2::Pos3) | void | 2 | data |
| `Game.createBillboards` | method | 0-0 | void | 2 | data |
| `Game.createLocalPlayer` | method | 2-2 (std::string, int) | bool | 2 | data |
| `Game.createUnspawnedAIPlayer` | method | 2-2 (std::string, int) | void | 2 | data |
| `Game.crossHairRadius` | property | 0-1 (float) | float | 2 | fits: the crosshair element's radius |
| `Game.crossHairSize` | property | 0-1 (float) | float | 2 | fits: the crosshair element's size |
| `Game.customGameInfo` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.customGameName` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.customGameUrl` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.customGameVersion` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.damageForBeingOutSideWorld` | property | 0-1 (float) | float | 2 | engine |
| `Game.debugAddWeaponToSoldier` | method | 1-1 (std::string) | void | 2 | data |
| `Game.debugCallbackDisabled` | property | 0-1 (bool) | bool | 1 | server |
| `Game.debugDamage` | property | 0-1 (bool) | bool | 2 | data |
| `Game.debugShowAllVehicleNameTags` | method | 1-1 (bool) | void | 2 | fits: nametag-layer.js, every hull tagged |
| `Game.debugShowFullSoldier` | method | 1-1 (bool) | void | 2 | data |
| `Game.dedicatedServer` | property | 0-1 (bool) | bool | 2 | server |
| `Game.delayBeforeStartingGame` | property | 0-1 (float) | float | 2 | server |
| `Game.disconnect` | method | 0-0 | bool | 2 | built |
| `Game.drawDebug` | property | 0-1 (bool) | bool | 2 | built |
| `Game.dumpNetworkDebugStats` | property | 0-1 (bool) | bool | 1 | server |
| `Game.enableConFileCache` | property | 0-1 (bool) | bool | 2 | data |
| `Game.EnableFreeCamera` | property | 0-1 (bool) | bool | 1 | built |
| `Game.exitAtRestart` | property | 0-1 (bool) | bool | 2 | server |
| `Game.extrapolationTime` | property | 0-1 (U32) | U32 | 2 | server |
| `Game.fontRatio` | property | 0-1 (float) | float | 2 | data |
| `Game.forcePlayerToTeam` | property | 0-1 (bool) | bool | 2 | server |
| `Game.freeCameraBaseSpeed` | property | 0-1 (float) | float | 1 | fits: the replay free camera's speed |
| `Game.freeCameraFastSpeed` | property | 0-1 (float) | float | 1 | fits: the replay free camera's speed |
| `Game.freeCameraSlowSpeed` | property | 0-1 (float) | float | 1 | fits: the replay free camera's speed |
| `Game.gameLevelPath` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.gameMode` | property | 0-1 (BFGameMode) | BFGameMode | 2 | data |
| `Game.gameModeTest` | property | 0-1 (bool) | bool | 1 | server |
| `Game.gamePlayMode` | property | 0-1 (GamePlayMode) | GamePlayMode | 2 | data |
| `Game.gameSpyLANPort` | property | 0-1 (int) | int | 2 | server |
| `Game.gameSpyPort` | property | 0-1 (int) | int | 2 | server |
| `Game.getGameLevelPath` | method | 0-0 | std::string | 2 | data |
| `Game.getIp` | method | 0-0 | void | 1 | server |
| `Game.getLevelName` | method | 0-0 | void | 1 | fits: the level's name |
| `Game.getNameTagDistance` | method | 0-0 | void | 2 | fits: nametags.js distances (HUD-16) |
| `Game.getRandomNameForTeam` | method | 1-1 (U32) | std::string | 2 | data |
| `Game.getServerName` | method | 0-0 | void | 1 | server |
| `Game.getServerWelcomeMessage` | method | 1-1 (int) | void | 2 | server |
| `Game.getStatsGatheringEnabled` | method | 1-1 (int) | bool | 2 | server |
| `Game.globalPredictionMode` | property | 0-1 (PredictionMode) | PredictionMode | 2 | server |
| `Game.goToInterface` | method | 1-1 (int) | void | 2 | engine |
| `Game.hostServer` | method | 1-1 (bool) | void | 2 | server |
| `Game.intensityScale` | property | 0-1 (float) | float | 2 | fits: the light rig's intensity |
| `Game.interpolationTime` | property | 0-1 (U32) | U32 | 2 | server |
| `Game.isAiLevel` | property | 0-1 (bool) | bool | 2 | data |
| `Game.joinServer` | method | 2-2 (std::string, bool) | void | 2 | server |
| `Game.kickBack` | property | 0-1 (float) | float | 2 | server |
| `Game.kickBackOnSplash` | property | 0-1 (float) | float | 2 | server |
| `Game.kickBackOnSplash` | property | 0-1 (float) | float | 2 | server |
| `Game.killPlayer` | method | 1-1 (int) | void | 2 | data |
| `Game.listMaps` | method | 0-0 | std::string | 1 | built |
| `Game.listPlayers` | method | 0-0 | std::string | 1 | built |
| `Game.materialToGiveDamage` | property | 0-1 (U8) | U8 | 2 | data |
| `Game.maxNrOfPlayers` | property | 0-1 (int) | int | 2 | server |
| `Game.menuInGame` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.menuMain` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.menuMap` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.mouseLook` | property | 0-1 (bool) | bool | 2 | fits: page-input.js mouse look on/off |
| `Game.networkStatsGatheringEnabled` | property | 0-1 (float) | float | 2 | server |
| `Game.normalChatColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Game.nrOfRounds` | property | 0-1 (int) | int | 2 | server |
| `Game.numDeltasPerBaseLine` | property | 0-1 (uint) | uint | 2 | server |
| `Game.objectiveAttackerTicketsMod` | property | 0-1 (int) | int | 2 | server |
| `Game.packetDropRatio` | property | 0-1 (float) | float | 2 | server |
| `Game.playCTFSoundDebug` | method | 1-1 (int) | void | 2 | engine |
| `Game.playGamePlaySoundDebug` | method | 1-1 (int) | void | 2 | engine |
| `Game.randomNames` | property | 0-1 (bool) | bool | 2 | data |
| `Game.reconnect` | method | 0-0 | void | 2 | server |
| `Game.removePlayerFromBuddyList` | method | 1-1 (int) | void | 1 | server |
| `Game.restartBf1942exe` | method | 0-0 | void | 2 | server |
| `Game.restartMap` | method | 0-0 | void | 2 | server |
| `Game.restartServer` | method | 0-0 | void | 2 | server |
| `Game.roundDelayBeforeStartingGame` | property | 0-1 (float) | float | 2 | server |
| `Game.runNextLevel` | method | 0-0 | void | 2 | server |
| `Game.saveServerSettings` | method | 0-0 | void | 2 | server |
| `Game.sayAll` | method | 1-1 (std::string) | void | 1 | fits: comms.js chat send on the play page |
| `Game.scoreLimit` | property | 0-1 (unsigned int) | unsigned int | 2 | server |
| `Game.serverAlliedTeamRatio` | property | 0-1 (int) | int | 2 | server |
| `Game.serverAllowNoseCam` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverAutoBalanceTeams` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverAxisTeamRatio` | property | 0-1 (int) | int | 2 | server |
| `Game.serverBandwidthChokeLimit` | property | 0-1 (int) | int | 2 | server |
| `Game.serverContentCheck` | property | 0-1 (int) | int | 2 | server |
| `Game.serverCoopAiSkill` | property | 0-1 (int) | int | 2 | server |
| `Game.serverCoopCpu` | property | 0-1 (int) | int | 2 | server |
| `Game.serverCrossHairCenterPoint` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverDeathCameraType` | property | 0-1 (int) | int | 2 | server |
| `Game.serverDedicated` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverEventLogCompression` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverEventLogging` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverExternalViews` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverFreeCamera` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverGameRoundStartDelay` | property | 0-1 (int) | int | 2 | server |
| `Game.serverGameStartDelay` | property | 0-1 (int) | int | 2 | server |
| `Game.serverGameTime` | property | 0-1 (int) | int | 2 | server |
| `Game.serverHitIndication` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverInternet` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverIP` | property | 0-1 (std::string) | std::string | 2 | server |
| `Game.serverKickBack` | property | 0-1 (float) | float | 2 | server |
| `Game.serverKickBackOnSplash` | property | 0-1 (float) | float | 2 | server |
| `Game.serverMaxAllowedConnectionType` | property | 0-1 (ConnectionType) | ConnectionType | 2 | server |
| `Game.serverMaxPlayers` | property | 0-1 (int) | int | 2 | server |
| `Game.serverName` | property | 0-1 (std::string) | std::string | 2 | server |
| `Game.serverNameTagDistance` | property | 0-1 (int) | int | 2 | server |
| `Game.serverNameTagDistanceScope` | property | 0-1 (int) | int | 2 | server |
| `Game.serverNumberOfRounds` | property | 0-1 (int) | int | 2 | server |
| `Game.serverNumReservedSlots` | property | 0-1 (int) | int | 2 | server |
| `Game.serverOfficialStatsReporting` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverPassword` | property | 0-1 (std::string) | std::string | 2 | server |
| `Game.serverPort` | property | 0-1 (int) | int | 2 | server |
| `Game.serverPunkBuster` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverReservedPassword` | property | 0-1 (std::string) | std::string | 2 | server |
| `Game.serverScoreLimit` | property | 0-1 (int) | int | 2 | server |
| `Game.serverSoldierFriendlyFire` | property | 0-1 (int) | int | 2 | server |
| `Game.serverSoldierFriendlyFireOnSplash` | property | 0-1 (int) | int | 2 | server |
| `Game.serverSpawnDelay` | property | 0-1 (int) | int | 2 | server |
| `Game.serverSpawnTime` | property | 0-1 (int) | int | 2 | server |
| `Game.serverTicketRatio` | property | 0-1 (int) | int | 2 | server |
| `Game.serverTKPunishMode` | property | 0-1 (bool) | bool | 2 | server |
| `Game.serverUnpureMods` | property | 0-1 (std::string) | std::string | 2 | server |
| `Game.serverVehicleFriendlyFire` | property | 0-1 (int) | int | 2 | server |
| `Game.serverVehicleFriendlyFireOnSplash` | property | 0-1 (int) | int | 2 | server |
| `Game.setActiveCombatArea` | method | 4-4 (float, float, float, float) | void | 2 | data |
| `Game.setAirKeyboardSensitivity` | method | 1-1 (float) | void | 2 | data |
| `Game.setAirMouseInvert` | method | 1-1 (bool) | void | 2 | built |
| `Game.setAirMouseSensitivity` | method | 1-1 (float) | void | 2 | built |
| `Game.setAlliedCampaign` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedDebriefingMajorDefeat` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedDebriefingMajorVictory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedDebriefingMinorDefeat` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedDebriefingMinorVictory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedHints` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedObjectives` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAlliedSkirmish` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisCampaign` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisDebriefingMajorDefeat` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisDebriefingMajorVictory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisDebriefingMinorDefeat` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisDebriefingMinorVictory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisHints` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisObjectives` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setAxisSkirmish` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setBackgroundMusic` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setBeforeSpawnCameraPosition` | method | 2-2 (int, Vec3) | void | 2 | data |
| `Game.setCameraBlink` | method | 2-2 (float, float) | void | 2 | data |
| `Game.setCampaignAiSkill` | method | 1-1 (int) | void | 2 | data |
| `Game.setCampaignBotRatio` | method | 1-1 (int) | void | 2 | data |
| `Game.setCampaignDifficulty` | method | 1-1 (float) | void | 2 | data |
| `Game.setCampaignDifficulty` | method | 1-1 (int) | void | 2 | data |
| `Game.setCampaignLoseMusicFilename` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setCampaignNrOfLives` | method | 1-1 (int) | void | 2 | data |
| `Game.setCampaignPercentageOfBots` | method | 1-1 (int) | void | 2 | data |
| `Game.setCampaignPercentageOfCpu` | method | 1-1 (int) | void | 2 | data |
| `Game.setCampaignScores` | method | 1-1 (int) | void | 2 | data |
| `Game.setChannels` | method | 1-1 (int) | void | 2 | fits: sound settings work |
| `Game.setChineseYTextOffset` | method | 1-1 (float) | void | 2 | data |
| `Game.setCommonMouseSensitivity` | method | 1-1 (float) | void | 2 | built |
| `Game.setConnection` | method | 1-1 (int) | void | 2 | server |
| `Game.setCrossHairColor` | method | 3-3 (float, float, float) | void | 2 | fits: the crosshair's colour |
| `Game.setCurrentLevel` | method | 3-3 (std::string, std::string, std::string) | void | 2 | data |
| `Game.setCurrentNumberOfTickets` | method | 2-2 (U32, U32) | void | 2 | data |
| `Game.setCustomGameFilter` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setDebriefingMusicFilename` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setDedicatedOnlyFilter` | method | 1-1 (bool) | void | 2 | server |
| `Game.setDefaultIp` | method | 2-2 (std::string, int) | void | 2 | server |
| `Game.setDetailTexture` | method | 1-1 (int) | void | 2 | fits: terrain detail map (video settings work) |
| `Game.setDisableSound` | method | 1-1 (bool) | void | 2 | built |
| `Game.setEffectsQuality` | method | 1-1 (int) | void | 2 | fits: video settings work |
| `Game.setEnvironmentMapping` | method | 1-1 (bool) | void | 2 | fits: envmap.js (video settings work) |
| `Game.setGameDisplayMode` | method | 4-4 (int, int, int, int) | void | 2 | fits: video settings work |
| `Game.setGameTypeFilter` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setGodMode` | method | 1-1 (bool) | void | 2 | data |
| `Game.setGraphicsQuality` | method | 1-1 (int) | void | 2 | fits: video settings work |
| `Game.setHardware` | method | 1-1 (bool) | void | 2 | fits: sound settings work |
| `Game.setInfMouseInvert` | method | 1-1 (bool) | void | 2 | built |
| `Game.setInfMouseSensitivity` | method | 1-1 (float) | void | 2 | built |
| `Game.setJapaneseYTextOffset` | method | 1-1 (float) | void | 2 | data |
| `Game.setKit` | method | 3-3 (int, KitType, std::string) | void | 2 | data |
| `Game.setKoreanYTextOffset` | method | 1-1 (float) | void | 2 | data |
| `Game.setLandSeaKeyboardSensitivity` | method | 1-1 (float) | void | 2 | data |
| `Game.setLandSeaMouseInvert` | method | 1-1 (bool) | void | 2 | built |
| `Game.setLandSeaMouseSensitivity` | method | 1-1 (float) | void | 2 | built |
| `Game.setLightmaps` | method | 1-1 (bool) | void | 2 | fits: level-shading.js lightmaps (video settings work) |
| `Game.setLoadMusicFilename` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setLoadPicture` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setLocalized` | method | 1-1 (bool) | void | 2 | data |
| `Game.setLocalizedDialog` | method | 1-1 (bool) | void | 2 | data |
| `Game.setLoseMusicFilename` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setMajorVictory` | method | 1-1 (float) | void | 2 | data |
| `Game.setMapFilter` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setMapId` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setMasterVolume` | method | 1-1 (int) | void | 2 | built |
| `Game.setMaxNameTagDistance` | method | 2-2 (float, float) | void | 2 | fits: nametags.js distances (HUD-16) |
| `Game.setMenuMusicFilename` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setMenuMusicVolume` | method | 1-1 (int) | void | 2 | fits: sound settings work |
| `Game.setMenuViewdistance` | method | 1-1 (int) | void | 2 | fits: video settings work |
| `Game.setMinimapTransparency` | method | 1-1 (int) | void | 2 | built |
| `Game.setMinNrOfPlayers` | method | 1-1 (U32) | void | 2 | server |
| `Game.setMinorVictory` | method | 1-1 (float) | void | 2 | data |
| `Game.setMissionNr` | method | 1-1 (U32) | void | 2 | data |
| `Game.setMultiplayerBriefingMapType` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setMultiplayerBriefingObjectives` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setMusicOnOff` | method | 1-1 (int) | void | 2 | fits: sound settings work |
| `Game.setNameTagDistance` | method | 2-2 (float, float) | void | 2 | fits: nametags.js distances (HUD-16) |
| `Game.setNextLevel` | method | 3-3 (std::string, std::string, std::string) | void | 2 | server |
| `Game.setNonPasswordOnlyFilter` | method | 1-1 (bool) | void | 2 | server |
| `Game.setNumberOfTicketPerPlayer` | method | 2-2 (U32, U32) | void | 2 | data |
| `Game.setNumberOfTickets` | method | 2-2 (U32, U32) | void | 2 | data |
| `Game.setObjectiveAlliedDefeat` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setObjectiveAlliedVictory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setObjectiveAxisDefeat` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setObjectiveAxisVictory` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setObjectiveBriefing` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setPerformance` | method | 1-1 (int) | void | 2 | data |
| `Game.setPingFilter` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setPlayerBlink` | method | 2-2 (float, float) | void | 2 | data |
| `Game.setPlayerHitFlashTime` | method | 1-1 (float) | void | 2 | data |
| `Game.setPlayerName` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setPlayersFilter` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setProfile` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setQuality` | method | 1-1 (int) | void | 2 | data |
| `Game.setRadioFlashTime` | method | 1-1 (float) | void | 2 | data |
| `Game.setRadioTimeoutTime` | method | 1-1 (float) | void | 2 | data |
| `Game.setRadioToolTip` | method | 1-1 (bool) | void | 2 | built |
| `Game.setRadioToolTipColor` | method | 3-3 (float, float, float) | void | 2 | data |
| `Game.setRemoteConsoleCurrentLine` | method | 0-1 (std::string) | void | 1 | server |
| `Game.setRenderWhenSpawnMenu` | method | 1-1 (bool) | void | 2 | data |
| `Game.setRentAServerUrl` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setSavedSkirmishMap` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setServerFilter` | method | 1-1 (std::string) | void | 2 | server |
| `Game.setServerInfoIcon` | method | 1-1 (std::string) | void | 2 | data |
| `Game.setServerWelcomeMessage` | method | 2-2 (int, std::string) | void | 2 | server |
| `Game.setShadows` | method | 1-1 (bool) | void | 2 | fits: no shadows in the viewer yet (video settings work) |
| `Game.setSkirmishAiSkill` | method | 1-1 (int) | void | 2 | data |
| `Game.setSkirmishBotRatio` | method | 1-1 (int) | void | 2 | data |
| `Game.setSkirmishDifficulty` | method | 1-1 (int) | void | 2 | data |
| `Game.setSkirmishNrOfLives` | method | 1-1 (int) | void | 2 | data |
| `Game.setSkirmishPercentageOfBots` | method | 1-1 (int) | void | 2 | data |
| `Game.setSkirmishPercentageOfCpu` | method | 1-1 (int) | void | 2 | data |
| `Game.setSkirmishTeam` | method | 1-1 (int) | void | 2 | data |
| `Game.setSonarRotationSpeed` | method | 1-1 (float) | void | 2 | data |
| `Game.setSoundDetail` | method | 1-1 (int) | void | 2 | fits: sound settings work |
| `Game.setStaticMinimap` | method | 1-1 (bool) | void | 2 | built |
| `Game.setStatsGatheringEnabled` | method | 2-2 (int, bool) | void | 2 | server |
| `Game.setTeam` | method | 1-1 (int) | void | 2 | server |
| `Game.setTeamRatio` | method | 2-2 (U32, U32) | void | 2 | data |
| `Game.setTeamSkin` | method | 2-2 (int, std::string) | void | 2 | data |
| `Game.setTicketLostPerMin` | method | 2-2 (U32, float) | void | 2 | data |
| `Game.settingsPath` | property | 0-1 (std::string) | std::string | 2 | data |
| `Game.setToolTip` | method | 1-1 (bool) | void | 2 | data |
| `Game.setUseActiveCombatArea` | method | 1-1 (bool) | void | 2 | data |
| `Game.setWinMusicFilename` | method | 1-1 (std::string) | void | 2 | data |
| `Game.showAIStats` | property | 0-1 (bool) | bool | 2 | data |
| `Game.showNetworkInfo` | property | 0-1 (bool) | bool | 2 | server |
| `Game.showVersion` | method | 0-0 | void | 2 | fits: the viewer's build |
| `Game.soldierFFRatio` | property | 0-1 (float) | float | 2 | server |
| `Game.soldierFFRatioOnSplash` | property | 0-1 (float) | float | 2 | server |
| `Game.spawnAtCameraPosition` | property | 0-1 (bool) | bool | 2 | data |
| `Game.spawnDelay` | property | 0-1 (float) | float | 2 | data |
| `Game.spawnObject` | method | 1-1 (std::string) | bool | 2 | data |
| `Game.spawnObjectAt` | method | 3-3 (std::string, dice::ref2::Pos3, dice::ref2::Vec3) | bool | 2 | data |
| `Game.spawnPlayer` | method | 1-1 (int) | void | 2 | data |
| `Game.spawnPlayers` | property | 0-1 (bool) | bool | 2 | data |
| `Game.spawnTemplateName` | method | 2-2 (int, std::string) | void | 2 | data |
| `Game.spawnWaves` | property | 0-1 (bool) | bool | 2 | data |
| `Game.spawnWaveTime` | property | 0-1 (float) | float | 2 | server |
| `Game.startServer` | method | 0-2 (std::string, int) | bool | 2 | server |
| `Game.suicide` | method | 0-0 | void | 1 | fits: the deploy screen's SUICIDE button |
| `Game.team` | property | 0-1 (int) | int | 2 | data |
| `Game.ticketRatio` | property | 0-1 (float) | float | 2 | server |
| `Game.timeBeforeRestartMap` | property | 0-1 (float) | float | 2 | server |
| `Game.timeLimit` | property | 0-1 (unsigned int) | unsigned int | 2 | server |
| `Game.timeToNextWave` | property | 0-1 (float) | float | 2 | server |
| `Game.TKForgive` | method | 0-0 | void | 1 | server |
| `Game.TKPunish` | method | 0-0 | void | 1 | server |
| `Game.useAutoPingAdjust` | property | 0-1 (bool) | bool | 2 | server |
| `Game.useHud` | property | 0-1 (bool) | bool | 1 | built |
| `Game.useMenu` | property | 0-1 (bool) | bool | 2 | data |
| `Game.vehicleFFRatio` | property | 0-1 (float) | float | 2 | server |
| `Game.vehicleFFRatioOnSplash` | property | 0-1 (float) | float | 2 | server |
| `Game.viewDistance` | property | 0-1 (float) | float | 4 | built |
| `Game.voteKickPlayer` | method | 1-1 (int) | bool | 1 | server |
| `Game.voteKickTeamPlayer` | method | 1-1 (int) | bool | 1 | server |
| `Game.voteMap` | method | 1-1 (int) | bool | 1 | server |
| `Game.worldBorderFog` | property | 0-1 (bool) | bool | 2 | fits: level-sky.js far plane |
| `Game.writePrecache` | method | 0-0 | bool | 2 | data |

## Chat (16)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Chat.addToIgnoreList` | method | 1-1 (int) | void | 1 | fits: hide a player's chat lines (replay too) |
| `Chat.chatInfo` | method | 0-0 | std::string | 1 | built |
| `Chat.chatMessageSize` | property | 0-1 (int) | int | 1 | built |
| `Chat.gameInfoMessageSize` | property | 0-1 (int) | int | 1 | built |
| `Chat.getIgnoreRadioAudioAndText` | method | 0-0 | std::string | 1 | fits: comms.js radio |
| `Chat.ignoreList` | method | 0-0 | std::string | 1 | fits: hide a player's chat lines |
| `Chat.ignoreRadioAudio` | property | 0-1 (bool) | bool | 1 | fits: comms.js radio voices |
| `Chat.ignoreRadioText` | property | 0-1 (bool) | bool | 1 | fits: comms.js radio lines |
| `Chat.killMessageSize` | property | 0-1 (int) | int | 1 | built |
| `Chat.oldChatListHistory` | property | 0-1 (int) | int | 1 | fits: the pre-1.4 chat list |
| `Chat.oldChatListStyle` | property | 0-1 (bool) | bool | 1 | fits: the pre-1.4 chat list (not drawn by the viewer) |
| `Chat.removeFromIgnoreList` | method | 1-1 (int) | void | 1 | fits: hide a player's chat lines |
| `Chat.setChatHistory` | method | 3-3 (int, int, int) | void | 1 | built |
| `Chat.setIgnoreRadioAudioAndText` | method | 1-1 (bool) | void | 1 | fits: comms.js radio |
| `Chat.showPorts` | method | 0-0 | void | 1 | engine |
| `Chat.timeUntilMessageRemoved` | property | 0-1 (float) | float | 1 | built |

## Hud (5)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Hud.fullscreenMap` | property | 0-1 (bool) | bool | 2 | built |
| `Hud.toggleDebugMap` | method | 0-0 | void | 2 | fits: the map with debug marks |
| `Hud.toggleFullscreenMap` | method | 0-0 | void | 2 | built |
| `Hud.toggleUseThumbnailMap` | method | 0-0 | void | 2 | built |
| `Hud.useThumbnailMap` | property | 0-1 (bool) | bool | 2 | built |

## Renderer (51)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Renderer.allowAllRefreshRates` | property | 0-1 (bool) | bool | 2 | engine |
| `Renderer.ambientColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Renderer.animatedMeshAmbientColor` | method | 1-1 (Vec3) | void | 2 | engine |
| `Renderer.animatedMeshDiffuseFactor` | method | 1-1 (float) | void | 2 | engine |
| `Renderer.beginGlobalCluster` | method | 1-1 (std::string) | void | 2 | engine |
| `Renderer.coverPlaneRemovalHeight` | property | 0-1 (int) | int | 2 | engine |
| `Renderer.createBackBufferImage` | method | 0-0 | void | 2 | engine |
| `Renderer.deviceBehaviour` | property | 0-1 (DeviceBehaviourMode) | DeviceBehaviourMode | 2 | engine |
| `Renderer.diffuseColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Renderer.drawEnable` | property | 0-1 (bool) | bool | 2 | engine |
| `Renderer.drawObjects` | property | 0-1 (bool) | bool | 4 | built |
| `Renderer.drawOpaqueObjects` | property | 0-1 (bool) | bool | 4 | fits: a material pass filter |
| `Renderer.drawSky` | property | 0-1 (bool) | bool | 4 | built |
| `Renderer.drawTerrain` | property | 0-1 (bool) | bool | 4 | built |
| `Renderer.drawTranslucent` | property | 0-1 (bool) | bool | 4 | fits: a material pass filter |
| `Renderer.drawTransparentObjects` | property | 0-1 (bool) | bool | 4 | fits: a material pass filter |
| `Renderer.drawTrees` | property | 0-1 (bool) | bool | 4 | fits: tree-foliage.js cards and trunks |
| `Renderer.enableCenteredMultiSampling` | method | 1-1 (bool) | void | 2 | engine |
| `Renderer.endGlobalCluster` | method | 0-0 | void | 2 | engine |
| `Renderer.extrapolateFrame` | property | 0-1 (bool) | bool | 1 | engine |
| `Renderer.fieldOfView` | property | 0-1 (float) | float | 2 | fits: every view writes camera.fov per frame; needs a scale |
| `Renderer.fogColorVec` | property | 0-1 (Vec3) | Vec3 | 4 | built |
| `Renderer.fogEnd` | property | 0-1 (float) | float | 4 | built |
| `Renderer.fogStart` | property | 0-1 (float) | float | 4 | built |
| `Renderer.forceSwSkinning` | property | 0-1 (bool) | bool | 1 | engine |
| `Renderer.fullScreen` | property | 0-1 (bool) | bool | 2 | engine |
| `Renderer.gammaFactor` | property | 0-1 (float) | float | 1 | fits: renderer output (video settings work) |
| `Renderer.getVSyncEnabled` | method | 0-0 | bool | 1 | fits: video settings work |
| `Renderer.globalAmbientColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Renderer.globalLodPercent` | property | 0-1 (float) | float | 2 | fits: the LodObject distance |
| `Renderer.globalLodRadius` | property | 0-1 (float) | float | 2 | engine |
| `Renderer.globalLodRadiusScaleFactor` | property | 0-1 (float) | float | 2 | engine |
| `Renderer.hWProgramableTransformEnabled` | property | 0-1 (bool) | bool | 2 | engine |
| `Renderer.isMultiSamplingCentered` | method | 0-0 | bool | 2 | engine |
| `Renderer.lockFps` | property | 0-1 (float) | float | 1 | fits: a frame cap on the render loop |
| `Renderer.lodObjectDistanceLodFactor` | property | 0-1 (float) | float | 2 | fits: the LodObject distance (LOD-*) |
| `Renderer.mipMapBias` | property | 0-1 (float) | float | 1 | fits: texture LOD bias |
| `Renderer.multiSampleMode` | property | 0-1 (MultiSampleMode) | MultiSampleMode | 2 | fits: video settings work (antialias) |
| `Renderer.multiSamplePrefilter` | property | 0-1 (MultiSampleMode) | MultiSampleMode | 2 | engine |
| `Renderer.nearPlane` | property | 0-1 (float) | float | 2 | built |
| `Renderer.numBackbuffers` | property | 0-1 (uint) | uint | 2 | engine |
| `Renderer.numberOfActiveShadows` | property | 0-1 (int) | int | 2 | engine |
| `Renderer.playBink` | method | 2-2 (std::string, float) | void | 2 | engine |
| `Renderer.setVSyncEnabled` | method | 2-2 (bool, bool) | void | 1 | fits: video settings work |
| `Renderer.simplifyMeshes` | property | 0-1 (int) | int | 1 | engine |
| `Renderer.specularColor` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Renderer.useDynamicEnvmap` | property | 0-1 (bool) | bool | 2 | engine |
| `Renderer.useFrustumClipping` | property | 0-1 (bool) | bool | 2 | engine |
| `Renderer.useTrilinearFiltering` | property | 0-1 (bool) | bool | 2 | fits: texture filtering |
| `Renderer.vertexFogEnable` | property | 0-1 (bool) | bool | 4 | built |
| `Renderer.wireframe` | property | 0-1 (bool) | bool | 4 | built |

## Shadow (5)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Shadow.cullEpsilon` | property | 0-1 (float) | float | 2 | engine |
| `Shadow.numberOfActiveShadows` | property | 0-1 (int) | int | 2 | fits: no shadows in the viewer yet |
| `Shadow.setShadows` | method | 1-1 (bool) | void | 2 | fits: no shadows in the viewer yet |
| `Shadow.shadowColor` | property | 0-1 (Vec4) | Vec4 | 2 | fits: no shadows in the viewer yet |
| `Shadow.useFFPShadowGen` | property | 0-1 (bool) | bool | 2 | engine |

## Sound (22)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Sound.addRunTimeDirectory` | method | 2-2 (std::string, std::string) | void | 2 | engine |
| `Sound.disableSoundScript` | property | 0-1 (bool) | bool | 2 | engine |
| `Sound.distanceFactor` | property | 0-1 (float) | float | 2 | fits: page-audio.js gain law (sound settings work) |
| `Sound.dopplerFactor` | property | 0-1 (float) | float | 2 | fits: page-audio.js has no doppler (sound settings work) |
| `Sound.drawSoundObjects` | property | 0-1 (bool) | bool | 2 | fits: markers at every live voice |
| `Sound.hardwareVoiceLimit` | property | 0-1 (int) | int | 2 | engine |
| `Sound.maxVoices` | property | 0-1 (unsigned) | unsigned | 2 | fits: the rack's voice cap |
| `Sound.pitchChangeRate` | property | 0-1 (unsigned) | unsigned | 2 | engine |
| `Sound.playInAvailable` | method | 0-0 | void | 2 | engine |
| `Sound.playInHardware` | method | 0-0 | void | 2 | engine |
| `Sound.playInSoftware` | method | 0-0 | void | 2 | engine |
| `Sound.relaxHwReservations` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Sound.reloadSoundScript` | property | 0-1 (bool) | bool | 2 | engine |
| `Sound.reserve2dMonoChans` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Sound.reserve2dStereoChans` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `Sound.rolloffFactor` | property | 0-1 (float) | float | 2 | fits: page-audio.js gain law (sound settings work) |
| `Sound.setTemplateLevel` | method | 1-1 (std::string) | void | 2 | engine |
| `Sound.showSoundInfo` | property | 0-1 (bool) | bool | 2 | fits: the audio rack's state as text |
| `Sound.soundBufferCacheSize` | property | 0-1 (int) | int | 2 | engine |
| `Sound.soundStreamUpdateFrequency` | property | 0-1 (int) | int | 2 | engine |
| `Sound.startEngines` | property | 0-1 (bool) | bool | 2 | engine |
| `Sound.updateFrequency` | property | 0-1 (float) | float | 2 | engine |

## Debug (15)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Debug.animationTweakingEnabled` | method | 1-1 (bool) | void | 2 | engine |
| `Debug.debriefing` | method | 1-1 (int) | void | 1 | fits: the round-end debriefing screen |
| `Debug.debugOutputMessage` | method | 2-2 (std::string, int) | void | 1 | engine |
| `Debug.doNotDisplayErrorWindow` | property | 0-1 (bool) | bool | 1 | engine |
| `Debug.enableParticles` | property | 0-1 (bool) | bool | 2 | built |
| `Debug.outputLoadStats` | property | 0-1 (bool) | bool | 2 | engine |
| `Debug.outputServerMessage` | method | 1-1 (std::string) | void | 1 | engine |
| `Debug.resetLoadStats` | method | 0-0 | void | 2 | engine |
| `Debug.setDebugFreeCameraEnter` | method | 1-1 (bool) | void | 2 | engine |
| `Debug.speak` | method | 3-3 (int, std::string, std::string) | void | 2 | engine |
| `Debug.turnOffAllDebug` | method | 1-1 (int) | void | 2 | engine |
| `Debug.turnOffDebug` | method | 2-2 (int, std::string) | void | 2 | engine |
| `Debug.turnOnAllDebug` | method | 1-1 (int) | void | 2 | engine |
| `Debug.turnOnDebug` | method | 2-2 (int, std::string) | void | 2 | engine |
| `Debug.useFrustumGrid` | method | 1-1 (bool) | void | 2 | engine |

## Vars (3)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Vars.get` | method | 1-1 (std::string) | std::string | 2 | built |
| `Vars.list` | method | 0-0 | std::string | 2 | built |
| `Vars.set` | method | 2-2 (std::string, std::string) | void | 2 | built |

## Admin (61)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Admin.addAddressToBanList` | method | 1-2 (std::string, std::string) | void | 1 | server |
| `Admin.addKeyToBanList` | method | 1-2 (std::string, std::string) | void | 1 | server |
| `Admin.allowNoseCam` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.autoBalanceTeam` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.bandwidthChokeLimit` | property | 0-1 (int) | int | 1 | server |
| `Admin.banPlayer` | method | 1-2 (int, std::string) | void | 1 | server |
| `Admin.banPlayerKey` | method | 1-2 (int, std::string) | void | 1 | server |
| `Admin.banPlayerOnTKKick` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.changeMap` | method | 3-3 (std::string, std::string, std::string) | void | 1 | server |
| `Admin.changeMap` | method | 1-1 (int) | void | 1 | server |
| `Admin.clearBanList` | method | 0-0 | void | 1 | server |
| `Admin.collisionLatency` | property | 0-1 (float) | float | 2 | server |
| `Admin.crossHairCenterPoint` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.delayBeforeStartingGame` | property | 0-1 (float) | float | 1 | server |
| `Admin.disableConsoleInfoServer` | method | 0-0 | void | 1 | server |
| `Admin.disableRemoteAdmin` | method | 0-0 | bool | 1 | server |
| `Admin.disableRemoteConsole` | method | 0-0 | void | 1 | server |
| `Admin.enableConsoleInfoServer` | method | 0-0 | void | 1 | server |
| `Admin.enableKickPlayerVote` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.enableKickTeamPlayerVote` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.enableMapVote` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.enableRemoteAdmin` | method | 1-1 (std::string) | void | 1 | server |
| `Admin.enableRemoteConsole` | method | 2-3 (std::string, std::string, int) | void | 1 | server |
| `Admin.execRemoteCommand` | method | 1-1 (std::string) | bool | 1 | server |
| `Admin.externalViews` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.getRemoteConsoleEnabled` | method | 0-0 | bool | 1 | server |
| `Admin.kickBack` | property | 0-1 (float) | float | 1 | server |
| `Admin.kickBackOnSplash` | property | 0-1 (float) | float | 1 | server |
| `Admin.kickBackOnSplash` | property | 0-1 (float) | float | 1 | server |
| `Admin.kickPlayer` | method | 1-1 (int) | void | 1 | server |
| `Admin.kickPlayerByName` | method | 1-1 (std::string) | void | 1 | server |
| `Admin.listBannedAddresses` | method | 0-0 | std::string | 1 | server |
| `Admin.listBannedKeys` | method | 0-0 | std::string | 1 | server |
| `Admin.maxAllowedConnectionType` | property | 0-1 (ConnectionType) | ConnectionType | 1 | server |
| `Admin.nrOfTKToKick` | property | 0-1 (float) | float | 1 | server |
| `Admin.removeAddressFromBanList` | method | 1-1 (std::string) | void | 1 | server |
| `Admin.removeKeyFromBanList` | method | 1-1 (std::string) | void | 1 | server |
| `Admin.restartMap` | method | 0-0 | void | 1 | server |
| `Admin.roundDelayBeforeStartingGame` | property | 0-1 (float) | float | 1 | server |
| `Admin.runNextLevel` | method | 0-0 | void | 1 | server |
| `Admin.scoreLimit` | property | 0-1 (unsigned int) | unsigned int | 1 | server |
| `Admin.serverMessage` | method | 1-1 (std::string) | void | 1 | server |
| `Admin.setNextLevel` | method | 3-3 (std::string, std::string, std::string) | void | 1 | server |
| `Admin.setNrOfRounds` | method | 1-1 (int) | void | 1 | server |
| `Admin.setTicketRatio` | method | 1-1 (float) | void | 1 | server |
| `Admin.soldierFFRatio` | property | 0-1 (float) | float | 1 | server |
| `Admin.soldierFFRatioOnSplash` | property | 0-1 (float) | float | 1 | server |
| `Admin.spawnDelayPenaltyForTK` | property | 0-1 (float) | float | 1 | server |
| `Admin.spawnWaveTime` | property | 0-1 (float) | float | 1 | server |
| `Admin.tagPlayerId` | property | 0-1 (int) | int | 1 | server |
| `Admin.timeBeforeRestartMap` | property | 0-1 (float) | float | 1 | server |
| `Admin.timeLimit` | property | 0-1 (unsigned int) | unsigned int | 1 | server |
| `Admin.timeToNextWave` | property | 0-1 (float) | float | 1 | server |
| `Admin.TKPunishMode` | property | 0-1 (bool) | bool | 1 | server |
| `Admin.toggleGamePause` | method | 0-0 | void | 1 | built |
| `Admin.vehicleFFRatio` | property | 0-1 (float) | float | 1 | server |
| `Admin.vehicleFFRatioOnSplash` | property | 0-1 (float) | float | 1 | server |
| `Admin.voteKickPlayerMajority` | property | 0-1 (float) | float | 1 | server |
| `Admin.voteKickTeamPlayerMajority` | property | 0-1 (float) | float | 1 | server |
| `Admin.voteMapMajority` | property | 0-1 (float) | float | 1 | server |
| `Admin.votingTime` | property | 0-1 (float) | float | 1 | server |

## AI (104)

All data: addBot, addPlacement, addSAIStrategy, addSearchMap, addSearchType, addUnspawnedBot, aiMeshRendering, aiSystemQuotient, attachCamera, attachCameraCycle, botFlyTo, botGiveOrder, botMoveTo, botSetWaypoints_Patrol, botSetWaypoints_Patrol3d, botStatisticUpdateSpeed, checkStrategicPositionForAll, clearMaps, compileAIMeshes, createAllMaps, createAllSearchMaps, createAllSearchTypes, createMaps, createSAI, createSearchMaps, createSearchTypes, deactivateBot, debug, getActiveBehaviour, getActiveStrategy, getAllBots, getBehaviourInfo, getBotBehaviourList, getBotCount, getBotGoalPosition, getBotKit, getBotManagerQuotient, getBotPosition, getBotSide, getBotVehicle, getBotVitals, getBrush, getNSearchMaps, getNSearchTypes, getNumberOfActiveBots, getNumberOfDeactivedBots, getNVehicles, getRendCameraPosition, getRendCameraRotation, getSAIQuotient, getSearchMapMaxSlope, getSmoothing, getSmoothingLevel, getStrategyHeat, getVehicleLocalMapName, getVehicleName, getVehicleStrategicMapName, getWaterCutOffDepth, getWaterDepth, init, kill, killAllBots, killBotId, killBotName, listSAIStrategies, loadMaps, loadSearchMaps, loadSearchTypes, mapFloodingRendering, mapLandscapeRendering, mapObjectLocalRendering, mapObjectsRendering, mapTriRemovalRendering, numAStarResources, pathfindingDebugLevel, renderSide, reset, saiEnable, saiMapXDimension, saiMapYDimension, setAISystemComponentsQuotient, setBrush, setLocalLevelCost, setMapSpawnPoints, setSearchMapMaxSlope, setSmoothing, setSmoothingLevel, setWaterCutOffDepth, setWaterDepth, showAll, showBot, showBotSense, showBotSpawnCoord, showBotStats, showBotUrgencies, showSAIStats, showStrategic, showStrategicAreas, showStrategies, snoopBot, spawnBot, updateBot, validateDataStructuresEnabled, validateMaps.

## AIBotManager (27)

All data: enableBotScriptDebugger, getLodLevelFullPriority, getLodLevelFullTicks, getLodLevelLightPriority, getLodLevelLightTicks, getLodLevelMediumPriority, getLodLevelMediumTicks, getMemoryUpdateQuotient, getPlannedDecisionMakingInterleave, getPlannedDecisionMakingThresholdFull, getPlannedDecisionMakingThresholdLight, getPlannedDecisionMakingThresholdMedium, getSensingQuotient, getSystemDecisionMakingQuotient, getSystemPathfindingQuotient, getSystemSensingQuotient, getUnplannedDecisionMakingInterleave, getUnplannedDecisionMakingThresholdFull, getUnplannedDecisionMakingThresholdLight, getUnplannedDecisionMakingThresholdMedium, setDecisionMakingInterleave, setLodLevelPriority, setLodLevelTicks, setPlannedDecisionMakingThreshold, setSensingQuotient, setSystemQuotient, setUnplannedDecisionMakingThreshold.

## aiCheats (1)

All data: code.

## AILandingZone (6)

All data: activeZone, beachDirection, createLandingZone, listZones, maxCorner, minCorner.

## AIRadio (1)

All data: subscribeToMessage.

## aiSettings (47)

All data: activateDefaultInterpreter, activeBehaviourModifiers, addInterpreterEntry, addVehicleToVehicleGroup, createBehaviourModifiers, createLODManager, createUCConstant, createUCLinear, createUCXInverse, createVehicleGroup, getBehaviour, getBehaviourModifier, getBotSkill, getInformationGridDimension, getNSides, getNumberOfVehicleGroups, getSAIUpdateFrequency, getStatsViewDistance, getVehicle, getVehicleGroup, getVehicleGroupName, getViewDistance, isRespawnAllowed, listBehaviourModifiers, lodEnable, removeInterpreterEntry, setBasicBotWeights, setBasicLODDistance, setBehaviour, setBehaviourModifier, setBotSkill, setInformationGridDimension, setMaxNBots, setNBehaviours, setNSides, setNVehiclesTypes, setRespawnAllowed, setSAIUpdateFrequency, setStandardMoralAdmin, setStandardPersonality, setStatsViewDistance, setVehicle, setVehicleBehaviour, setVehicleDefaultBehaviour, setViewDistance, setWorldMapSize, showAISettings.

## AIStrategicArea (48)

All data: addAllowedUnit, addAllowedVehicleGroup, addExpelledUnit, addLandingZoneUnit, addNeighbour, addObjectTypeFlag, attachLandingZone, category, create, createNewCategory, drawVehicleSearchRadi, enableDebug, getActive, getBasicTemperature, getCategoryFromName, getCategoryName, getNeighbours, getNumberOfAssignedUnits, getNumberOfAvailableAttackers, getNumberOfAvailableDefenders, getNumberOfPresentUnits, getObjectTypeFlagMapping, getObjectTypeFlags, getPosition, getSide, getStatus, getTemperature, getTopLeftCorner, isTakeable, list, listLandingZones, listOrderPositions, removeAllNeighbours, removeAllObjectTypeFlags, removeObjectTypeFlag, saveAll, setActive, setAreaObjectiveRelation, setBasicTemperature, setObjectTypeFlags, setOrderPosition, setPosition, setSide, setStatus, setTakeable, setTopLeftCorner, showNeighbours, vehicleSearchRadius.

## aiStrategy (43)

All data: addCondition, addProhibitedPrecedingStrategy, addRequiredPrecedingStrategy, addSpecificObjectModifier, aggression, clearAllStrategicObjectsModifiers, completeConditions, completeStrategies, createAreaCondition, createConstantCondition, createHeterogeneousCondition, createHomogenousCondition, createPrerequisite, createStrategy, enableDebug, forceStrategy, getActiveConditionName, getActivePrerequisiteName, getActiveStrategyName, getConditionStrength, getPrerequisiteWeight, getStrategicObjectsModifier, getTreeModifier, getTreeModifierCombatStrength, isAbortCondition, listConditions, listPrerequisites, listStrategies, numberOfAttacks, numberOfDefences, setActiveCondition, setActivePrerequisite, setActiveStrategy, setConditionStrength, setIsAbortCondition, setPrerequisite, setPrerequisiteWeight, setStrategicObjectsModifier, setTreeModifier, setTreeModifierCombatStrength, targetValue, thresholdSpeed, timeLimit.

## AITemplate (10)

All data: active, addPlugIn, addType, allowedTimeDiff, basicTemp, commonKnowledge, create, degeneration, secondary, types.

## AITemplatePlugIn (59)

All data: active, aimControls, aimHorizontalControl, aimRollControl, aimThrottleControl, aimVerticalControl, avoidCollisionLookAhead, coverSearchRadius, coverValue, create, driveControls, drivePitchControl, driveRollControl, driveThrottleControl, driveTurnControl, equipmentType, getStrType, isTurnable, lodHeight, lookControls, lookHorizontalControl, lookHorizontalLookAhead, lookHorizontalScale, lookHorizontalSensitivity, lookVerticalControl, lookVerticalLookAhead, lookVerticalScale, lookVerticalSensitivity, maxClimbAngle, maxRollAngle, maxSpeed, maxSpeedBumpinessFallOff, pitchLookAhead, pitchScale, pitchSensitivity, rollLookAhead, rollScale, rollSensitivity, selectKey, setAlwaysTargetSoldier, setBattleStrength, setCameraRelativeMaxRotationDeg, setCameraRelativeMinRotationDeg, setHasExposedSoldier, setHearingProbability, setIsAntiAircraft, setSoundSphereRadius, setStrategicStrength, setStrType, setUseNoPathfindingToGetToObject, throttleLookAhead, throttleScale, throttleSensitivity, transparency, turnRadius, vehicleNumber, yawLookAhead, yawScale, yawSensitivity.

## AITools (6)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `AITools.pathfinding_localSearch` | method | 4-4 (int, float, ref2::Vec3, ref2::Vec3) | void | 2 | engine |
| `AITools.pathfindingGoalRadius` | property | 0-1 (float) | float | 2 | engine |
| `AITools.pathfindingMode` | property | 0-1 (ToolDebugPathfinding::Mode) | ToolDebugPathfinding::Mode | 2 | engine |
| `AITools.pathfindingTrigger` | method | 2-2 (ref2::Vec3, ref2::Vec3) | void | 2 | engine |
| `AITools.pathfindingVehicle` | property | 0-1 (int) | int | 2 | engine |
| `AITools.sensingMode` | property | 0-1 (int) | int | 2 | engine |

## AnimationStateMachine (42)

All data: addAnimation, addIdle, addRandomTransition, addSpeakConnectionSymbol, addToLatestTransition, addTransitionItem, addTransitionOne, addTransitionWhenDone, clearAllIdles, copyState, copyState2, createState, debugMode, init, list, removeXYZonAnimations, resetSkeleton, returnToState, saveAll, saveAnimationCache, set1pAnimationSpeed, set3pAnimationSpeed, setActiveState, setAnimationGroup, setAnimationInfo, setCameraShakeFadeIn, setCameraShakeFadeOut, setCameraShakeInOut, setCameraShakeLeftRight, setCameraShakeMinFactor, setCameraShakePitch, setCameraShakeRoll, setCameraShakeTimeToShake, setCameraShakeUpDown, setCameraShakeYaw, setFlag, setMorphFactor, setOtherState, setSoundTrigger, setSpeed, setUseRandomStartTime, writeAnimationSpeedChanges.

## BitStream (1)

All engine: relativeCompressionEnabled.

## Cloud (9)

All data: getTexScale, setDstBlend, setHeight, setName, setSpeed, setSrcBlend, setTexPos, setTexScale, setTexture.

## ConsoleProfiler (6)

All engine: enable, report, startGlobalTimer, startTimer, stopGlobalTimer, stopTimer.

## ControlMap (12)

All data: addAxisToAxisMapping, addAxisToTriggerMapping, addButtonAndKeyToAxisMapping, addButtonsToAxisMapping, addButtonToTriggerMapping, addKeyAndButtonToAxisMapping, addKeysToAxisMapping, AddKeyToTriggerMapping, create, deleteControlMap, setButtonFallTime, setButtonRiseTime.

## Editor (83)

All engine: createNewLayer, deleteAllLayers, deleteAllObjects, deleteObject, deleteTemplate, disable, disableChildEditing, enable, enableChildEditing, enableRandColor, enableRandOffset, enableRandPosition, enableRandRotation, enableRandScale, enableRandTilt, fixToGround, fixToGroundHeight, getActiveLayer, getActiveLayerId, getActiveObject, getActiveObjectTemplate, getPositionAxisDUR, getRotatingAxisYPR, getState, hideLayer, isStrafing, listAllVehicles, listLayers, listMeshes, listObjects, listObjectsOfTemplate, listTemplates, listTextures, loadAllObjects, loadAllTemplatesAndObjects, moveActiveObjectToCamera, moveAllObjects, moveCameraToActiveObject, printObjectCreationScript, printTemplateCreationScript, quickReloadActiveTemplate, quickReloadTemplate, randAllObjectsOfTemplate, randColorMax, randColorMin, randOffset, randPosVariance, randScaleHeight, randScaleWidth, randTilt, removeLayer, renameLayer, saveAllEffects, saveAllObjects, saveAllSpawners, saveAllTemplates, saveAllTemplatesAndObjects, saveAllUsedTemplates, saveFolderToArchive, saveSpawners, saveTemplateToFile, saveTemplateTreeStructure, saveVehicles, setActiveLayer, setActiveLayerId, setActiveObject, setActiveObjectTemplate, setCameraHeight, setCameraPosition, setForceCameraToGround, setPositionAxisDUR, setRotatingAxisYPR, setState, setStrafing, ShowEntryPoints, showLayer, showObjectEditorObjects, start, stop, updateAllTemplates, updateTemplate, viewMesh.

## EnvironmentSound (1)

All data: load.

## FileChangeManager (2)

All engine: delayTime, enable.

## FileManager (8)

All engine: addMergeDirectory, addPathOverload, copyFile, deleteFile, fileExists, moveFile, removeMergeDirectory, removePathOverload.

## GeometryTemplate (83)

All data: active, alphaLodDistance, alphaTestDistance, alphaTestValue, billboard, billboardDistance, billboardResolution, color, create, cullBackFaces, cullFactor, deleteAll, detailTexName, detailTexScale, file, getLodDistance, gradiantFactor, hasDynamicShadow, lightColor, lodDistance, lods, materialMap, materialSize, mergeable, mergeLightmaps, name, printScript, reload, reloadShader, saveAll, scale, seaFloorLevel, setLodDistance, setLodRange, setSkin, shader, shadowAmbient, shadowColor, shadowPrecision, specularColor, specularPower, swayDirection, swayEnable, swayForceLengthSeconds, swayForcePeriodSeconds, swayForceRangeDegrees, swayPeriodSeconds, swayRangeDegrees, swayWindFactor, targetTriCount, tesselation, texBaseName, texOffsetX, texOffsetY, textureFadeMaxDist, triangleSortLodDistance, type, waterLevel, waterTexName, waterTexScale, waveHeight, worldSize, yScale.

## InputDevices (2)

All data: setAxisScale, setInvertAxis.

## kitTemplate (9)

All data: active, allowedAllied, allowedAxis, create, getBattleStrength, getStrategicStrength, getType, setBattleStrength, setStrategicStrength.

## lensFlare (1)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `lensFlare.enable` | property | 0-1 (bool) | bool | 2 | fits: level.paintLensFlare |

## LodSelectorTemplate (22)

All data: active, addLodComparison, addLodDistance, create, deleteAll, getLodComparison, getLodDistance, getLodLevelCount, hasDestroyedLod, name, path, printScript, saveAll.

## MaterialManager (14)

All data: attGroup, damageMod, defGroup, dumpMaterialList, getDamageMod, material, materialAttGroup, materialDamage, materialDefGroup, materialElasticity, materialFriction, materialResistance, setCell, setEffectTemplate.

## Memory (11)

All engine: diceNewEnableBounderyChecking, info, listAllocations, listDiffAllocations, newEnableBounderyChecking, resetDiffAllocations, startTrace, stopTrace, systemMemoryReport, systemMemoryReportById, traceAllocations.

## Menu (4)

All engine: getIntroMoviePath, repeatRate, repeatStart, setIntroMoviePath.

## NetworkableInfo (7)

All engine: createNewInfo, deleteInfo, enableSpringFix, setBasePriority, setForceNetworkableId, setIsUnique, setPredictionMode.

## Object (60)

All data: absolutePosition, active, addAbsolutePoint, addItem, addKitByName, aiSide, create, defaultSaveFile, delete, deleteAll, geometry.applySway, geometry.applySwayForce, geometry.color, geometry.reload, geometry.scale, geometry.shader, geometry.template, geometry.tesselation, geometry.type, getGroundPos, getOSId, handleDamage, hasCollision, hasDynamicShadow, hasUpdate, info, initGrid, isInGrid, isInTweakMode, isSaveable, isVisible, isVisibleInEditor, list, listObjectsOfTemplate, loadAll, name, occlusionQuadVisible, printScript, renderLines, rotation, saveAll, setActive, setAnimationState, setFirstPerson, setIsDisabledRecursive, setIsInTweakModeRecursive, setIsSaveableRecursive, setIsVisibleRecursive, setObjectToGround, setOcclusionQuadWidthHeight, setOSId, setTeam, showAnimationStateInfo, spawnOffset, start, stop, team, template.

## ObjectAssembler (1)

All data: addModifiedTemplate.

## ObjectEditor (20)

All engine: addKeyDown, addKeyUp, addMouseLeft, addMousePos, addMouseRight, enableRandColor, enableRandRotation, enableRandScale, enableRandTilt, invertMouse, setLimits, setMouseSensitivity, setMouseSensitivityFast, setMouseSensitivitySlow, setRandMaxColor, setRandMaxScale, setRandMaxTilt, setRandMinColor, setRandMinScale, setToolSensitivity.

## ObjectGrid (4)

All engine: autoInit, getMinMaxObject, getMinMaxTrack, listObjectsOutsideMinMax.

## objectiveManager (5)

All data: attackerLoseTicketsOnDeath, defenderLoseTicketsOnDeath, registerObjectSpawner, setDefender, setRootObjectSpawner.

## ObjectTemplate (608)

All data: acceleration, active, activeEffectPersistance, activeHeatIncrement, addAmmoType, addArmorEffect, addChild, addEmitterSpeed, addFireArmsPosition, addLinePoint, addObjectiveSpawnerToComposite, addPcoPosId, addRootSpeed, addSkeletonIK, addTemplate, addToCollisionGroup, addToNegativeMask, addToPossitiveMask, addToProjectileList, addVehicleType, addWeaponIcon, addWorkOnMaterial, aiTemplate, allowReloadOnEmptyClipOnly, alphaOverTime, alphaTestRef, alphaTestRefOverTime, altFireOnce, altSoldierExitPosition, ammoBar, ammoBarFill, ammoBarPosX, ammoBarPosY, ammoBarSize, ammoBarTextPosX, ammoBarTextPosY, ammoIcon, ammoType, angleMod, animationSpeed, animationSpeedOverTime, areaValue, areaValueTeam1, areaValueTeam2, artPos, asynchronyFire, attachToListener, autoFire, automaticPitchStabilization, automaticReset, automaticYawStabilization, autoReload, bindToSkeletonPart, blastAmmoCount, boneName, buildSkeleton, buildSkin, burstFrequency, burstTime, cameraDelayDistance, cameraDelayTime, cameraId, canBeRepairedAndDestroyed, cantSelectWhenNoAmmo, center1pHands, centerOfMassOffset, changeWeaponWhenNoAmmo, clearTemplateList, colorRGBAOverTime, continousRotationSpeed, controlPointIcon, controlPointName, coolDownPerSec, coolingFactor, copyLinksCount, create, createInvisible, createNotInGrid, createSkeleton, createVisibleInEditor, criticalDamage, crossHairIcon, cullRadiusScale, CVMChase, CVMExternTrace, CVMFlyBy, CVMFrontChase, CVMInside, CVMTrace, damage, damageForBeingOutSideWorld, damageFromDeepWater, damageFromWater, damageMod, damageOwner, damageType, damageWhenLost, damping, deepWaterDamageDelay, deepWaterLevel, defaultEffectTemplate, defaultSaveFile, delay, delayToUse, delete, destBlendMode, destroyed, destroyOnExit, destroyVehicleWhenNoAmmo, detectionRadius, detonateOnWaterCollision, dieAfterColl, dieAtObjectHit, differential, dirBarRotate, dirBarXScale, dirBarYScaleAbove, dirBarYScaleBelow, dirBarYScaleMax, dirBarYScaleMin, disableIfEnemyInsideRadius, disableSpawnPointsOnEnter, disableWhenFired, disableWhenLosingControl, disarmMinesDistance, distance, distToMinDamage, distToStartLoseDamage, dontClearTeamOnExit, downAngleMultiplier, drag, dragOffset, dragOverTime, effectOnSpawn, ejectClipTime, emitterSpeedScale, enable, enableRadarMode, endEffectTemplate, engineType, exitSpeedMod, explodeNearEnemyDistance, explosionDamage, explosionForce, explosionForceMax, explosionForceMod, explosionMaterial, explosionRadius, fadeAtTimeToLiveAfterDeath, fadeOnDist, fireAllAtOnce, fireDelay, fireInCameraDof, fireingForce, fireOnce, flagTemplate, flareScaleDistance, forceOnExplosion, forwardMod, gearChangeTime, gearDown, gearDownEngineInput, gearDownHeight, gearUp, gearUpEngineInput, gearUpHeight, geometry, getGroup, getHeatBarType, getNumCoronas, getNumFlares, getPosition, getRotation, getSpawnId, getStartOnEffects, getStopOnEffects, getTemplate, getTotSprites, gravityModifier, gravityModifierOverTime, grip, GUIIndex, hasArmor, hasCollisionEffect, hasCollisionPhysics, hasDecalEmitter, hasDynamicShadow, hasMag, hasMobilePhysics, hasOnTimeEffect, hasOverDamage, hasPointPhysics, hasResponsePhysics, hasRestrictedExit, hasStaticColor, hasTurretIcon, headMaxAngleMultiplier, healDistance, healFactor, healthBarFullIcon, healthBarIcon, heatAddWhenFire, heatIncrement, hideDuringFireTime, hitPoints, holdObject, hpLostWhileCriticalDamage, hpLostWhileDamageFromDeepWater, hpLostWhileDamageFromWater, hpLostWhileUpSideDown, id, inertiaModifier, info, initAnimationFrame, initLensFlares, initRotation, inputFire, inputReload, inputToPitch, inputToRoll, inputToYaw, intensity, intensityAtSpeed, intensityOverTime, inverseHeatBar, invisible, invisibleAtEndEffect, isBundable, isNotSaveable, isPortalPassing, isSpawnEffect, isSticky, itemIndex, itemType, kitTeam, leftAngleMultiplier, lesserYawAtSpeed, list, listTemplateClasses, listTemplates, loadAll, loadSoundScript, lodDistance, lodSelector, looping, loseControlWhenEnemyClose, loseControlWhenNotClose, magSize, magType, mass, material, material2, maxDist, maxDistAlpha, maxDistanceUnderWaterSurface, maxHitPoints, maxNrOfObjectSpawned, maxRotation, maxSpawnDelay, maxSpeed, mesh, minDamage, minDist, minDistAlpha, minDistanceUnderWaterSurface, minimapIcon, minNrToTakeControl, minRotation, minSpawnDelay, moveToWaterSurface, name, nameTagOffset, networkableInfo, noCollisionAsDestroyed, noFFSound, noPhysics, noPropellerEffectAtSpeed, nrOfObjectToSpawn, numAnimationFrames, numberOfGears, numberOfWeaponIcons, numOfMag, objectiveDelay, objectiveName, objectSpawnerId, objectTemplate, onlyTakeableByTeam, outsideHudOffset, overrideAirMovementInhibitations, passiveHeatIncrement, pcoFlags, pcoId, physicsFrequency, PivotPosition, portalPassingPosition, positionalSpeedInDof, positionalSpeedInRight, positionalSpeedInUp, preCacheObject, primaryAmmoIcon, printScript, projectile2Template, projectilePosition, projectileTemplate, projectileType, ProximityFusePrimer, radioLanguage, radius, recoilSize, recoilSpeed, relativePositionInDof, relativePositionInRight, relativePositionInUp, reloadTime, rememberExcessInput, removeAtRestart, removeTemplate, repairDistance, repairFactor, resetWhenRemoved, rightAngleMultiplier, rotationalSpeed, rotationalSpeedInDof, rotationalSpeedInRight, rotationalSpeedInUp, rotationSpeed, rotationSpeedOverTime, roundOfFire, save, saveAll, saveInSeparateFile, scanForEnemySonars, scopeIcon, seatAnimationLowerBody, seatAnimationUpperBody, seatFlags, secondaryAmmoIcon, secondSpawnGroupId, selectInhibitLink, selfDestroy, selfHealFactor, set1pFov, setActivater, setActiveAcceleration, setActiveTemplate, setAIEnterOnSpawn, setAmbient, setAnimatedTextureSpeed, setAnimationState, setAreaValue, setAxisFixation, setBoneOriginOffset, setCharacterHeight, setCheckBoneDistance, setCoronaColor, setCoronaColor2, setCoronaCount, setCoronaFadeAngleFactor, setCoronaRot, setCoronaSize, setCoronaSize2, setCoronaTexture, setCrossHairType, setCrouchingAnims, setCrouchingFallbackAnimOverride, setDefaultAnims, setDefaultFallbackAnimOverride, setDevMod, setDragModifier, setEnterOnSpawn, setEntryRadius, setExplodePartAtDestroy, setFireCameraShakeAnimationState, setFireDev, setFlagLocation, setFlapLift, setFlareColor, setFlareColor2, setFlareFadeAngleFactor, setFlareRot, setFlareSize, setFlareSize2, setFlareTexture, setFloatMaxLift, setFloatMinLift, setGoBackOnRecoil, setGroup, setHasRecoilForce, setHasTarget, setHealth, setHeatBarType, setHudAmmoType, setHullHeight, setInAirAnims, setInAirFallbackAnimOverride, setIsFirstPersonPart, setIsSun, setKitActiveName, setKitIcon, setKitName, setLensFlareCount, setLiePointUpDownAngle, setLodDistance, setLodValue, setLyingAnims, setLyingFallbackAnimOverride, setMinDev, setMinimapIcon, setMinimapIconSize, setMinSpawnHeight, setMiscDev, setObjectiveCompletetionString1, setObjectTemplate, setParachuteDrag, setParachuteSpeed, setPassiveAcceleration, setPitchOffset, setPointUpDownAngle, setPoseCameraPos, setPosition, setPositionalFixation, setPositionOffset, setPrimaryAmmoBar, setRandomGeometries, setRecoilForceLeftRight, setRecoilForceUp, setRegulateToLift, setRotation, setSecondaryAmmoBar, setSkeletonCollisionBone, setSoldierExitLocation, setSpawnAsParaTroper, setSpawnDelay, setSpawnId, setSpawnPositionOffset, setSpawnPreventionDelay, setSpawnRotation, setSpeedDev, setStartOnEffects, setStopOnEffects, setTeamGeometry, setToolTipType, setTracerTemplate, setTrigger, setTurnDev, setTurnLeftRightAngle, setVehicleCategory, setVehicleType, setWaterHeight, setWingLift, setWingToRegulatorRatio, showInFirstPerson, showInThirdPerson, sightIcon, sinkInToLandAfterDeathSpeed, size, sizeModifier, sizeModifierX, sizeModifierY, sizeModifierZ, sizeOverTime, slowDownMod, sniperSight, soldierCameraPosition, soldierCrouchIcon, soldierProneIcon, soldierStandingIcon, soldierZoomFov, soldierZoomPosition, sonarPos, spawnDelay, spawnDelayAtStart, spawnGroupId, spawnOffset, speedMod, srcBlendMode, startAtCreation, startEffectTemplate, startProbability, startRotation, startUnloaded, stayAsDestroyed, stopAtEndEffect, strength, submarineData, submarineHudDepthModifier, submarineHudDirModifier, subPos, targetName, team, teamChange, teamFlagIcon, teamOnVehicle, template, templateHasBeenUsed, texture, ticketIcon, timeDelayOnOverHeat, timeLimit, timeToGetControl, timeToLive, timeToLiveAfterDeath, timeToLiveAftherDeath, timeToLoseControl, timeToNotAllowChange, timeToRemoveTK, timeToReSpawn, timeToStartFadeAfterDeath, toggleMouseLook, torque, tracerScaler, triggerRadius, turnsInMovingDirection, type, unableToChangeTeam, unZoomBetweenFireTime, upAngleMultiplier, update, updateAll, useAsBone, useButtonRadius, useCameraOrientation, useMipMaps, useMMOnEndEffect, useScope, useSkeletonPartAsMain, useUVRotation, vehicleCameraShake, vehicleFov, vehicleIcon, vehicleIconPos, velocity, velocityDependentOnHeat, visibleBarrelTemplate, visibleDummyProjectileTemplate, waterDamageDelay, weaponLink, workOnSoldiers, workOnVehicles, XYSizeRatio, XYSizeRatioOverTime, yawSpeed, YModOnExplosion, zoomFov.

## ParticleSystem (1)

All data: cullFactorScale.

## Physics (4)

All data: airDensityZeroAtHeight, gravity, listProperties, wind.

## Player (16)

All data: active, create, debugStats, isAi, isAlive, isNetwork, kit, list, listPlayerClasses, name, saveAll, setVehicleWithInputId, spawnGroup, team, vehicle, vehicleHp.

## PlayerStats (25)

All data: setAttacks, setBulletsFired, setBulletsGivingDamage, setCaptures, setDeaths, setDefences, setFirstPlace, setKills, setScore, setSecondPlace, setThirdPlace, setTKs, setTotAttacks, setTotBulletsFired, setTotBulletsGivingDamage, setTotCaptures, setTotDeaths, setTotDefences, setTotKills, setTotScore, setTotTKs, setTotVehicleDestroyed, setVehicleDestroyed, setVictoryType, setWinner.

## Portal (2)

All engine: debugLevel, showStats.

## Profiler (20)

All engine: disableAllTimers, disableGraphForTimer, disableTimer, disableTimerFromName, disableVTuneForTimer, disableVTuneForTimerFromName, enable, enableAllTimers, enableGraphForTimer, enableTimer, enableTimerFromName, enableVTune, enableVTuneForTimer, enableVTuneForTimerFromName, listTimers, report, reportFile, reportPerTimer, reset.

## RayTracer (23)

All engine: addIgnoreObject, addIgnoreObjectTemplate, ambientIntensity, blockSize, init, light.create, light.direction, light.fov, light.intensity, light.objectShadows, light.selfShadowing, light.shadowIntensity, light.softness, light.viewDistance, onlyNearest, removeIgnoreObject, removeIgnoreObjectTemplate, sampleOffset, shadowsNearCamera, startLightmap, traceActiveObject, traceAllObjects, traceObject.

## ResourceManager (2)

All engine: memoryLimit, tempPrintPriorityList.

## ScoreManager (8)

All data: attack, capture, death, defence, kill, Objective, ObjectiveTK, TK.

## ShaderManager (10)

All engine: disableStandardMeshShader, getFloatParam, getIntegerParam, getVectorParam, setDefaultShaderSolidColor, setFloatParam, setIntegerParam, setTextureParam, setVectorParam, unloadAll.

## skidMark (9)

All data: enable, numPatches, numSkidMarks, patchSize, setBumpTexture, setMaterialSkidMarkExtraWidth, setMaterialTrigLevels, setTexture, showBump.

## Sky (19)

All data: addCloud, changeOfsCloudDist, changeOfsCloudHeight, changeOfsRndTexPos, changeOfsSkyHeight, closeSky, getCloudbyName, getNClouds, initSky, removeAll, removeCloud, saveAll, setCloudFog, setRotAngle, setSkyTextures, setSun, setSunLightDirection, setTexture, sunLightDirectionVec.

## Soldier (4)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `Soldier.cameraShakeFactor` | property | 0-1 (float) | float | 1 | fits: the hit and fire shake (handweapon view, VIEW-*) |
| `Soldier.setForwardSpeed` | method | 3-3 (int, float, float) | void | 2 | engine |
| `Soldier.setStrafeSpeed` | method | 2-2 (int, float) | void | 2 | engine |
| `Soldier.setWalkSpeedFactor` | method | 1-1 (float) | void | 2 | engine |

## SoldierSound (16)

All data: addMaterialToSound, crawlFrequency, crouchFrequency, hitDamageFrequency, ladderFrequency, randomCrawlFrequency, randomCrouchFrequency, randomHitDamageFrequency, randomLadderFrequency, randomRunFrequency, randomSwimFrequency, randomWalkFrequency, runFrequency, standFrequency, swimFrequency, walkFrequency.

## SpawnPointManager (13)

All data: createLines, group, groupActive, groupEnableToChangeTeam, groupIcon, groupPos, groupTeam, listControlPoints, listObjectSpawners, listSpawnPoints, onlyForAI, onlyForHuman, showDummy.

## StandardMesh (5)

All data: drawCollisionLods, enable, lightmapEnable, loadLightmapPalette, reloadLightmaps.

## Terrain (10)

All data: debugRLEenabled, detailTexName, detailTexScale, refreshTerrainSampling, shadowAmbient, shadowBorderFadeTime, shadowSamplingCullY, shadowStaticObjectsCullBox, textureLodFactor, waterTexScale.

## TerrainEditor (20)

All engine: clearRoadMap, disable, enable, exportHeightMap, getFixToGround, getNoBrushes, initRoamTerrain, isStrafing, loadNewBrush, optimizeRoad2Markers, saveHeightMap, saveRoadMap, setBrushLevel, setBrushStrength, setCameraHeight, setEditMode, setFixToGround, setForceCameraToGround, setSnapToGrid, setStrafing.

## textureList (4)

All data: print, printLoaded, printNames, skipMipmap.

## TextureManager (10)

All engine: addAlternativePath, alternativePath, mipmapFilter, mipmaps, reload, reloadAll, setAlternativePath, skipMipmaps, unload, unloadAll.

## ToolBenchmark (9)

All engine: addSplinePoint, buildSpline, clearAllSplinePoints, save, setActive, setSpeed, showSpline, start, stop.

## ToolHandler (2)

All engine: setToolActive, unactivateAllTools.

## treeRenderer (10)

| command | type | args | returns | access | viewer |
|---|---|---|---|---|---|
| `treeRenderer.billboardDistanceScale` | property | 0-1 (float) | float | 2 | fits: tree-foliage.js |
| `treeRenderer.billboardFadeScale` | property | 0-1 (float) | float | 2 | engine |
| `treeRenderer.billboardLightScale` | property | 0-1 (Vec3) | Vec3 | 2 | engine |
| `treeRenderer.billboardPath` | property | 0-1 (std::string) | std::string | 2 | engine |
| `treeRenderer.enable` | property | 0-1 (bool) | bool | 2 | fits: tree-foliage.js |
| `treeRenderer.mipmapBias` | property | 0-1 (float) | float | 2 | engine |
| `treeRenderer.spritesEnable` | property | 0-1 (bool) | bool | 2 | fits: tree-foliage.js billboards |
| `treeRenderer.swayEnable` | property | 0-1 (bool) | bool | 2 | fits: tree-foliage.js sway |
| `treeRenderer.textureLodBias` | property | 0-1 (float) | float | 2 | engine |
| `treeRenderer.useNewBillboardFadeFunc` | property | 0-1 (bool) | bool | 2 | engine |

## Utils (13)

All engine: expr, getV3X, getV3Y, getV3Z, mathExprF, mathExprI, mathExprV2, mathExprV3, mathExprV4, modI, setV3X, setV3Y, setV3Z.

## Water (27)

All data: addBlendEnable, Color, deepColor, envmapColor, envMapEnable, lightDirection, normalmap, renderMethod, scrollDirection1, scrollDirection2, scrollDirectionNormalmap, scrollLayer1, scrollLayer2, scrollNormalmap, shallowColor, specularColor, specularEnable, specularStreakFactor, texLayer1, texLayer2, tileLayer1, tileLayer2, tileNormalmap, useATIWin98Fix, waterAlphaDepth, waterColorDepth, waterShallowAlpha.

## weaponTemplate (18)

All data: active, burst, create, deviation, deviationCorrectionTime, drag, exitVelocity, getStrength, healing, indirect, isThrown, maxRange, minRange, setStrength, soundSphereRadius, useAimerOnly, weaponActivate, weaponFire.

## Weather (5)

All data: crossFade, initWeather, removeAllWeather, removeLastWeather, saveAll.

## WPart (20)

All data: acceleration, active, centerAroundObject, close, color, displacement, fadeInValue, fadeZ, getTexture, numParticles, partSize, pointSpriteMaxSize, pointSpriteMinSize, radius, random, removeAll, scale, setTexture, speed, type.

