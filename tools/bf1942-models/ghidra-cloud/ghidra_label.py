# Ghidra headless script to apply labels from bf42plus source code
# Usage: analyzeHeadless /path/to/project ProjectName -import BF1942.exe -postScript ghidra_label.py
# Or:   analyzeHeadless /path/to/project ProjectName -process BF1942.exe -postScript ghidra_label.py
#@category bf42plus

from ghidra.program.model.symbol import SourceType

def label(addr_int, name):
    addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(addr_int)
    sym = currentProgram.getSymbolTable().getPrimarySymbol(addr)
    if sym and sym.getName() == name:
        return
    try:
        currentProgram.getSymbolTable().createLabel(addr, name, SourceType.USER_DEFINED)
        println("Labeled 0x%08X -> %s" % (addr_int, name))
    except Exception as e:
        println("Failed to label 0x%08X -> %s: %s" % (addr_int, name, str(e)))

# ===== Global Data Pointers =====
label(0x0097D76C, "pPlayerManager")
label(0x0097D764, "pObjectManager")
label(0x0097D768, "pObjectTemplateManager")
label(0x009A99D4, "RendPCDX8_singleton")
label(0x009A99D8, "g_TextureManager")
label(0x00971EAC, "g_pSetup")
label(0x009A2170, "g_Locale")
label(0x009A2320, "g_debug_callback")
label(0x009A9428, "g_console_run_result")
label(0x009AB610, "ConsoleObjects_singleton")
label(0x009AB868, "pRenderView")
label(0x00973AB8, "BfMenu_singleton")
label(0x0095F8D4, "g_pIGame")
label(0x00957C30, "g_masterServerAddr1")
label(0x00957DF8, "g_masterServerAddr2")
label(0x00A5C630, "g_MainUI")
label(0x00A5F1A8, "SpawnScreen_singleton")
label(0x009A9390, "g_pGameClient")  # referenced heavily in the processEvent function

# ===== Game Functions =====
label(0x00502E60, "calcStringHashValueNoCase")
label(0x00473430, "MD5Digest")
label(0x00581520, "Locale__getAnsi")
label(0x005815B0, "Locale__getWide")
label(0x0040F660, "setRotation")
label(0x0040ECB0, "Game__addPlayerInput")
label(0x00443F10, "getStringFromRegistry")
label(0x006C5840, "getLandSeaSensitivity")
label(0x006C5800, "getInfantrySensitivity")
label(0x006C5820, "getLandSeaInvert")
label(0x006C57E0, "getInfantryInvert")

# ===== Renderer =====
label(0x004611D0, "Renderer__drawDebugText")
label(0x00440790, "convertWorldPosToScreenPos")
label(0x00543110, "SupplyDepot__isHealing")
label(0x005431B0, "SupplyDepot__isRepairing")
label(0x005431E0, "SupplyDepot__isReloading")

# ===== UI / BfMenu =====
label(0x0045CE60, "BfMenu__getLocalPlayer")
label(0x0045D1A0, "BfMenu__stringToWide")
label(0x006A8F10, "BfMenu__addGameInfoMessage")
label(0x006A8E10, "BfMenu__addPlayerChatMessage")
label(0x006A8F80, "BfMenu__addRadioChatMessage")
label(0x006A89C0, "BfMenu__addChatMessageInternal")
label(0x006A88E0, "BfMenu__setCenterKillMessage")
label(0x006A7D00, "BfMenu__outputConsole")
label(0x00468680, "BfMap__isPlayerIDInBuddyList")
label(0x0046A2A0, "BfMap__addPlayerToBuddyListByID")
label(0x006A7E90, "BfMenu__showDisconnectMessage")
label(0x006A7EE0, "BfMenu__hideDisconnectMessage")
label(0x006A76B0, "BfMenu__setInfoMessage")
label(0x006A87D0, "BfMenu__setServerMessage")
label(0x006A9340, ""
                  ""
                  ""
                  ""
                  
                  )
label(0x006A90B0, "BfMenu__removeFromIgnoreList")
label(0x006A7D80, "BfMenu__setStatusMessage")
label(0x006A7DD0, "BfMenu__clearStatusMessage")
label(0x006CCBC0, "SpawnScreen__setSpawnMessage")
label(0x006CCE20, "SpawnScreenStuff__setVisible")

# ===== GameEvent System =====
label(0x004B34B0, "GameEventManager__getNextRcvdEvent")
label(0x004A6290, "GameEvent__allocate")
label(0x004869D0, "GameEvent__deallocate")
label(0x004A7D70, "GameEvent__registerEventMaker")
label(0x004A7BD0, "GameEvent__getEventMaker")

# ===== GameClient Event Processing =====
label(0x004933D0, "GameClient__processEvent")
label(0x00493B07, "GameClient__processEvent_afterCreatePlayer")

# ===== Network / BitStream =====
label(0x00582610, "BitStream__readBits")
label(0x00582AB0, "BitStream__writeBool")
label(0x00582AF0, "BitStream__readBool")
label(0x005829C0, "BitStream__writeUnsigned")
label(0x005829E0, "BitStream__readUnsigned")
label(0x00582C90, "BitStream__writeFullVector")
label(0x00583180, "BitStream__readFullVector")

# ===== Console =====
label(0x005AC970, "GameConsole__func1")
label(0x005ACC30, "GameConsole__func2")
label(0x0044ABC0, "Console__patchTarget")

# ===== Debug =====
label(0x005821E0, "Debug__setDebugCallback")
label(0x00582470, "turnOffAllDebug")
label(0x005821A0, "Debug__logStream")
label(0x00582270, "Debug__logStreamEnd")

# ===== Object System =====
label(0x00541F50, "Projectile__resetProjectile")
label(0x00580EB0, "Object__getName")

# ===== System =====
label(0x00581D90, "System__getMHZ")
label(0x00601664, "MemoryPool__alloc")
label(0x006B0DB0, "__changeResolution")

# ===== Game Functions (decompiled processEvent cases) =====
label(0x00491980, "GameClient__getPlayerFromEvent")
label(0x004930D0, "GameClient__createObject")
label(0x00491180, "GameClient__createObject2")
label(0x00492BC0, "GameClient__processCase0xC")
label(0x004B4C20, "GameClient__processCase0x2B")
label(0x004B3C90, "GameClient__syncFunc")
label(0x00499C40, "GameClient__func_499C40")
label(0x00499CE0, "GameClient__func_499CE0")
label(0x00499CF0, "GameClient__func_499CF0")
label(0x00490750, "GameClient__func_490750")
label(0x004B7B70, "GameClient__func_4B7B70")
label(0x004B88E0, "GameClient__func_4B88E0")
label(0x004B8CE0, "GameClient__func_4B8CE0")
label(0x004B4800, "GameClient__func_4B4800")
label(0x00467C10, "GameClient__func_467C10")
label(0x00407600, "GameClient__func_407600")
label(0x00407660, "GameClient__func_407660")
label(0x0040BCF0, "GameClient__func_40BCF0")
label(0x00408F80, "GameClient__scoreFunc1")
label(0x00408FF0, "GameClient__scoreFunc2")
label(0x00409060, "GameClient__scoreFunc3")
label(0x00406A20, "GameClient__func_406A20")

# ===== Spawn/Death Screen =====
label(0x006D84A0, "SpawnScreen__func_6D84A0")
label(0x006D8060, "SpawnScreen__func_6D8060")
label(0x006D5340, "SpawnScreen__func_6D5340")
label(0x006D6450, "SpawnScreen__func_6D6450")
label(0x006D2790, "SpawnScreen__func_6D2790")
label(0x006D3400, "SpawnScreen__func_6D3400")

# ===== Loading Screen =====
label(0x006B42F0, "LoadingScreen__showDisconnectMessage")
label(0x006B4910, "LoadingScreen__func_6B4910")
label(0x006B4030, "LoadingScreen__func_6B4030")

# ===== Kill/Score Messages =====
label(0x006A9020, "BfMenu__addKillMessage")
label(0x006A88E0, "BfMenu__setCenterKillMessage")
label(0x006A9DE0, "BfMenu__func_6A9DE0")
label(0x006ACB60, "BfMenu__func_6ACB60")

# ===== STL / MSVC Runtime (in-binary CRT) =====
label(0x008C3520, "msvc_sprintf")
label(0x008C3134, "msvc_stl_func1")
label(0x008C3220, "msvc_stl_func2")

# ===== Patched Locations (for reference) =====
label(0x005389C9, "patch__Particle_handleUpdate_crashfix")
label(0x006DFB7E, "patch__scoreboard_axis_col_width1")
label(0x006DFB8B, "patch__scoreboard_axis_col_width2")
label(0x006DFAC0, "patch__scoreboard_allied_col_width1")
label(0x006DFACD, "patch__scoreboard_allied_col_width2")
label(0x006DFA7F, "patch__scoreboard_allied_col_width3")
label(0x006DFB3D, "patch__scoreboard_axis_col_width3")
label(0x004B6FFD, "patch__server_ping")
label(0x004B6F6C, "patch__ping_interval")
label(0x00490F4C, "patch__GameClient_disconnect_udp")
label(0x00490F00, "GameClient__disconnect")
label(0x00494DFA, "patch__empty_maplist_fix")
label(0x00632478, "patch__ForegroundLockTimeout")
label(0x004B77C7, "patch__mine_warning_fix")
label(0x004F85C7, "patch__glitchy_projectile_pickup_fix")
label(0x0048FFB6, "patch__debug_restart_code")
label(0x006D316D, "patch__radio_playvoice_crash_jmp")
label(0x006D310B, "patch__radio_playvoice_crash")
label(0x006CDE8A, "patch__healthbar_fix")
label(0x004931C5, "patch__CreateObjectEvent_crashfix1")
label(0x00493271, "patch__CreateObjectEvent_crashfix2")
label(0x004932D2, "patch__CreateObjectEvent_crashfix3")
label(0x004112BD, "patch__skip_static_objects_jmp")
label(0x00411170, "patch__Game_load_static_objects")
label(0x004B4045, "patch__network_error_debug")
label(0x004B403F, "patch__GameEvent_invalid_id_crashfix")

# ===== Nametag / HUD Patches =====
label(0x00440F90, "patch__lower_nametag_close")
label(0x004416CB, "patch__nametag_add_id_no_hp")
label(0x0044153A, "patch__nametag_add_id_with_hp")
label(0x004411D0, "patch__nametag_buddy_color")
label(0x006E082A, "patch__scoreboard_buddy_color")
label(0x006A8A54, "patch__chat_buddy_color")
label(0x006DFF74, "patch__scoreboard_add_buddy_btn")

# ===== Spawn Screen Patches =====
label(0x006D846B, "patch__skip_spawn_screen_jmp")
label(0x006D8461, "patch__skip_spawn_screen_join")
label(0x004946D4, "patch__skip_spawn_screen_death_jmp")
label(0x004946CA, "patch__skip_spawn_screen_death")
label(0x006CD610, "patch__skip_spawn_status_update")
label(0x006D8420, "patch__skip_briefing_jmp")
label(0x006D8740, "patch__skip_briefing")

# ===== Enemy Nametag Patches =====
label(0x00441B57, "patch__enemy_nametag_skip_jmp")
label(0x00441AA7, "patch__enemy_nametag_soldier")
label(0x00441AF0, "patch__enemy_nametag_pco")

# ===== Hit Indicator Patches =====
label(0x008D5A7C, "const_0_0333f")
label(0x00495A24, "patch__hit_indicator_time")
label(0x006AEBA8, "patch__hit_indicator_alpha")
label(0x006ADF69, "patch__force_spawn_text")
label(0x00495FD2, "patch__force_disconnect_msg")

# ===== Server Message Patches =====
label(0x006A88B1, "patch__server_msg_output_disable")
label(0x006A88CE, "patch__server_msg_output_disable_jmp")

# ===== Renderer Patches =====
label(0x004670A5, "patch__renderer_draw_hook")
label(0x00460A92, "patch__texture_handler_registration")
label(0x004676B4, "patch__screenshot_name")
label(0x004634B2, "patch__screenshot_counter_init_disable")

# ===== Resolution / Display Patches =====
label(0x0045FBD0, "patch__display_settings_string")
label(0x006B1083, "patch__screen_resolution_fix")
label(0x0063F00E, "RendPCDX8__getDisplaySettingID")
label(0x0063F018, "patch__screen_resolution_fix2")
label(0x0045DD69, "patch__menu_resolution")
label(0x0063F217, "patch__fpu_precision1")
label(0x0063F0C1, "patch__fpu_precision2")

# ===== Misc Patches =====
label(0x004904F0, "patch__drop_actions")
label(0x00462826, "patch__showfps_precision1")
label(0x004628E6, "patch__showfps_precision2")
label(0x0040CD5E, "patch__cdkey_validation1")
label(0x00459EED, "patch__cdkey_validation2")
label(0x0049510A, "patch__cdkey_validation3")
label(0x0045831D, "patch__cdkey_blacklist_disable")
label(0x0045F0C9, "patch__version_display_menu")
label(0x0069F4AE, "patch__serverlist_mod_column")
label(0x0069F971, "patch__serverlist_column_index")
label(0x00401784, "patch__serverlist_grey_version1")
label(0x004017CE, "patch__serverlist_grey_version2")

# ===== Server List =====
label(0x007D42A0, "meme_ListBoxData__addColumnNoWidth")
label(0x004B6FC0, "RestartServerPinger__init")

# ===== Other Functions =====
label(0x0045D110, "BfMenu__func_45D110")
label(0x004B6F30, "BfMenu__func_4B6F30")
label(0x005810A0, "String__func_5810A0")
label(0x005C1280, "File__CRC_func")
label(0x00459E20, "Map__validateFunc")
label(0x00454480, "Map__func_454480")
label(0x00454DD0, "Map__func_454DD0")
label(0x00447980, "Map__func_447980")
label(0x00401290, "Map__func_401290")
label(0x00580EF0, "String__func_580EF0")
label(0x0045A100, "Map__func_45A100")
label(0x00459850, "Map__func_459850")
label(0x00443200, "ModList__getList")
label(0x00444500, "Mod__checkFunc")
label(0x00445FA0, "Level__func_445FA0")
label(0x0046F4C0, "Level__func_46F4C0")
label(0x004A55E0, "Level__func_4A55E0")
label(0x004F7910, "LinkedList__getFirst")
label(0x004F7080, "Vehicle__func_4F7080")
label(0x0044C2B0, "Game__func_44C2B0")
label(0x004444C0, "Game__func_4444C0")
label(0x004452C0, "Game__func_4452C0")
label(0x004067C0, "Game__func_4067C0")
label(0x0081FA20, "Game__func_81FA20")
label(0x0048A710, "Player__func_48A710")
label(0x005467E0, "Packet__func_5467E0")
label(0x007444A0, "Packet__func_7444A0")
label(0x006E4290, "Player__setAliveState")
label(0x004F54A0, "Game__func_4F54A0")

# ===== DllMain / Entry =====
label(0x00804DA6, "WinMain_call_in_DllMain")

# ===== Return Address Checks (for context) =====
label(0x006AC21B, "ret__chatInput1")
label(0x006AC488, "ret__chatInput2")
label(0x00491C4D, "ret__GameClient_handleChatMessage")
label(0x0049469E, "ret__setCenterKillMessage")
label(0x00418DE4, "ret__removeFromIgnoreList")
label(0x0046B130, "ret__buddyColor_allied1")
label(0x0046B802, "ret__buddyColor_allied2")
label(0x0046B165, "ret__buddyColor_axis1")
label(0x0046B852, "ret__buddyColor_axis2")

# ===== Executable Range =====
label(0x00401000, "exe_text_start")
label(0x008C3000, "exe_text_end")

println("bf42plus labeling complete!")
