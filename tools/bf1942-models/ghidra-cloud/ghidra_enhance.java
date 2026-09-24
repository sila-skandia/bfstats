// Ghidra headless script to set function signatures, add comments, and apply data types
// Run AFTER ghidra_label.java and ghidra_types.java
// Usage: analyzeHeadless /path/to/project ProjectName -process BF1942.exe -noanalysis -postScript ghidra_enhance.java
//@category bf42plus

import ghidra.app.script.GhidraScript;
import ghidra.program.model.symbol.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.data.*;

public class ghidra_enhance extends GhidraScript {

    private Address addr(long a) {
        return currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
    }

    // ==================== FUNCTION SIGNATURES ====================

    private void setSig(long address, String signature) {
        try {
            // Parse and apply using ApplyFunctionSignatureCmd equivalent
            // For now, just set a plate comment with the signature for reference
            // and rename if needed
            Function func = getFunctionAt(addr(address));
            if (func == null) {
                func = createFunction(addr(address), null);
            }
            if (func != null) {
                func.setComment(signature);
            }
        } catch (Exception e) {
            println(String.format("Failed sig at 0x%08X: %s", address, e.getMessage()));
        }
    }

    private void setReturnType(long address, DataType dt) {
        try {
            Function func = getFunctionAt(addr(address));
            if (func == null) {
                func = createFunction(addr(address), null);
            }
            if (func != null) {
                func.setReturnType(dt, SourceType.USER_DEFINED);
            }
        } catch (Exception e) {
            println(String.format("Failed return type at 0x%08X: %s", address, e.getMessage()));
        }
    }

    private void setCallingConvention(long address, String convention) {
        try {
            Function func = getFunctionAt(addr(address));
            if (func == null) {
                func = createFunction(addr(address), null);
            }
            if (func != null) {
                func.setCallingConvention(convention);
            }
        } catch (Exception e) {
            println(String.format("Failed calling convention at 0x%08X: %s", address, e.getMessage()));
        }
    }

    // ==================== COMMENTS ====================

    private void plateComment(long address, String comment) {
        try {
            setPlateComment(addr(address), comment);
        } catch (Exception e) {
            println(String.format("Failed comment at 0x%08X: %s", address, e.getMessage()));
        }
    }

    private void eolComment(long address, String comment) {
        try {
            setEOLComment(addr(address), comment);
        } catch (Exception e) {
            // ignore
        }
    }

    // ==================== DATA TYPES AT GLOBALS ====================

    private void setGlobalType(long address, DataType dt) {
        try {
            clearListing(addr(address), addr(address + dt.getLength() - 1));
            createData(addr(address), dt);
        } catch (Exception e) {
            println(String.format("Failed data type at 0x%08X: %s", address, e.getMessage()));
        }
    }

    @Override
    public void run() throws Exception {
        DataTypeManager dtm = currentProgram.getDataTypeManager();
        DataType PTR = PointerDataType.dataType;
        DataType UINT32 = AbstractIntegerDataType.getUnsignedDataType(4, dtm);
        DataType INT32 = AbstractIntegerDataType.getSignedDataType(4, dtm);
        DataType BOOL = BooleanDataType.dataType;
        DataType VOID = VoidDataType.dataType;
        DataType FLOAT = FloatDataType.dataType;

        // Look up our custom types
        DataType bfplayerPtr = new PointerDataType(dtm.getDataType("/bf42plus/BFPlayer"));
        DataType gameEventPtr = new PointerDataType(dtm.getDataType("/bf42plus/GameEvent"));
        DataType ptrType = new PointerDataType(DataType.DEFAULT, 4);

        println("=== Setting function signatures ===");

        // ----- GameEvent System -----
        setCallingConvention(0x004B34B0L, "__thiscall");
        setReturnType(0x004B34B0L, gameEventPtr);
        setSig(0x004B34B0L, "GameEvent* __thiscall GameEventManager::getNextRcvdEvent()");

        setCallingConvention(0x004A6290L, "__fastcall");
        setReturnType(0x004A6290L, ptrType);
        setSig(0x004A6290L, "void* __fastcall GameEvent_allocate(size_t size)");

        setCallingConvention(0x004869D0L, "__fastcall");
        setReturnType(0x004869D0L, ptrType);
        setSig(0x004869D0L, "void* __fastcall GameEvent_deallocate(void* ptr)");

        setCallingConvention(0x004A7D70L, "__fastcall");
        setReturnType(0x004A7D70L, BOOL);
        setSig(0x004A7D70L, "bool __fastcall GameEvent_registerEventMaker(GameEventID id, GameEventMaker* maker)");

        setCallingConvention(0x004A7BD0L, "__fastcall");
        setReturnType(0x004A7BD0L, ptrType);
        setSig(0x004A7BD0L, "GameEventMaker* __fastcall GameEvent_getEventMaker(GameEventID id)");

        // ----- GameClient -----
        setCallingConvention(0x004933D0L, "__thiscall");
        setReturnType(0x004933D0L, UINT32);
        setSig(0x004933D0L, "bool __thiscall GameClient::processEvent(GameEvent* event)");

        setCallingConvention(0x00491980L, "__thiscall");
        setReturnType(0x00491980L, bfplayerPtr);
        setSig(0x00491980L, "BFPlayer* __thiscall GameClient::getPlayerFromEvent(uint8_t playerId)");

        setCallingConvention(0x00490F00L, "__thiscall");
        setReturnType(0x00490F00L, VOID);
        setSig(0x00490F00L, "void __thiscall GameClient::disconnect()");

        // ----- BitStream -----
        setCallingConvention(0x00582610L, "__thiscall");
        setReturnType(0x00582610L, BOOL);
        setSig(0x00582610L, "bool __thiscall BitStream::readBits(void* ptr, uint32_t bits)");

        setCallingConvention(0x00582AB0L, "__thiscall");
        setReturnType(0x00582AB0L, VOID);
        setSig(0x00582AB0L, "void __thiscall BitStream::writeBool(bool value)");

        setCallingConvention(0x00582AF0L, "__thiscall");
        setReturnType(0x00582AF0L, BOOL);
        setSig(0x00582AF0L, "bool __thiscall BitStream::readBool()");

        setCallingConvention(0x005829C0L, "__thiscall");
        setReturnType(0x005829C0L, VOID);
        setSig(0x005829C0L, "void __thiscall BitStream::writeUnsigned(uint32_t value, int bits)");

        setCallingConvention(0x005829E0L, "__thiscall");
        setReturnType(0x005829E0L, UINT32);
        setSig(0x005829E0L, "uint32_t __thiscall BitStream::readUnsigned(int bits)");

        setCallingConvention(0x00582C90L, "__thiscall");
        setReturnType(0x00582C90L, VOID);
        setSig(0x00582C90L, "void __thiscall BitStream::writeFullVector(const Vec3& vector)");

        setCallingConvention(0x00583180L, "__thiscall");
        setReturnType(0x00583180L, ptrType);
        setSig(0x00583180L, "Vec3 __thiscall BitStream::readFullVector()");

        // ----- BfMenu -----
        setCallingConvention(0x0045CE60L, "__thiscall");
        setReturnType(0x0045CE60L, bfplayerPtr);
        setSig(0x0045CE60L, "BFPlayer* __thiscall BfMenu::getLocalPlayer()");

        setCallingConvention(0x0045D1A0L, "__thiscall");
        setReturnType(0x0045D1A0L, ptrType);
        setSig(0x0045D1A0L, "bfs::wstring* __thiscall BfMenu::stringToWide(bfs::wstring* out, const bfs::string* in)");

        setCallingConvention(0x006A8F10L, "__thiscall");
        setReturnType(0x006A8F10L, VOID);
        setSig(0x006A8F10L, "void __thiscall BfMenu::addGameInfoMessage(bfs::wstring message, int team)");

        setCallingConvention(0x006A8E10L, "__thiscall");
        setReturnType(0x006A8E10L, VOID);
        setSig(0x006A8E10L, "void __thiscall BfMenu::addPlayerChatMessage(bfs::wstring message, BFPlayer* player, int team)");

        setCallingConvention(0x006A8F80L, "__thiscall");
        setReturnType(0x006A8F80L, VOID);
        setSig(0x006A8F80L, "void __thiscall BfMenu::addRadioChatMessage(bfs::wstring message, BFPlayer* player, int team)");

        setCallingConvention(0x006A89C0L, "__thiscall");
        setReturnType(0x006A89C0L, VOID);
        setSig(0x006A89C0L, "void __thiscall BfMenu::addChatMessageInternal(bfs::wstring msg, int team, int firstLinePos, int* numMessages, int maxLines, int* age, int type, bool isBuddy)");

        setCallingConvention(0x006A88E0L, "__thiscall");
        setReturnType(0x006A88E0L, VOID);
        setSig(0x006A88E0L, "void __thiscall BfMenu::setCenterKillMessage(bfs::wstring message)");

        setCallingConvention(0x006A7D00L, "__thiscall");
        setReturnType(0x006A7D00L, VOID);
        setSig(0x006A7D00L, "void __thiscall BfMenu::outputConsole(bfs::string message)");

        setCallingConvention(0x006A7E90L, "__thiscall");
        setReturnType(0x006A7E90L, VOID);
        setSig(0x006A7E90L, "void __thiscall BfMenu::showDisconnectMessage(bfs::wstring message)");

        setCallingConvention(0x006A7EE0L, "__thiscall");
        setReturnType(0x006A7EE0L, VOID);
        setSig(0x006A7EE0L, "void __thiscall BfMenu::hideDisconnectMessage()");

        setCallingConvention(0x006A76B0L, "__thiscall");
        setReturnType(0x006A76B0L, VOID);
        setSig(0x006A76B0L, "void __thiscall BfMenu::setInfoMessage(bfs::string message)");

        setCallingConvention(0x006A87D0L, "__thiscall");
        setReturnType(0x006A87D0L, VOID);
        setSig(0x006A87D0L, "void __thiscall BfMenu::setServerMessage(bfs::string message)");

        setCallingConvention(0x006A9340L, "__thiscall");
        setReturnType(0x006A9340L, VOID);
        setSig(0x006A9340L, "void __thiscall BfMenu::addToIgnoreList(int playerid)");

        setCallingConvention(0x006A90B0L, "__thiscall");
        setReturnType(0x006A90B0L, VOID);
        setSig(0x006A90B0L, "void __thiscall BfMenu::removeFromIgnoreList(int playerid)");

        setCallingConvention(0x006A7D80L, "__thiscall");
        setReturnType(0x006A7D80L, VOID);
        setSig(0x006A7D80L, "void __thiscall BfMenu::setStatusMessage(bfs::wstring message)");

        setCallingConvention(0x006A7DD0L, "__thiscall");
        setReturnType(0x006A7DD0L, BOOL);
        setSig(0x006A7DD0L, "bool __thiscall BfMenu::clearStatusMessage()");

        setCallingConvention(0x006A9020L, "__thiscall");
        setReturnType(0x006A9020L, VOID);
        setSig(0x006A9020L, "void __thiscall BfMenu::addKillMessage(bfs::wstring message)");

        // ----- meme::BfMap -----
        setCallingConvention(0x00468680L, "__thiscall");
        setReturnType(0x00468680L, BOOL);
        setSig(0x00468680L, "bool __thiscall BfMap::isPlayerIDInBuddyList(int playerid)");

        setCallingConvention(0x0046A2A0L, "__thiscall");
        setReturnType(0x0046A2A0L, BOOL);
        setSig(0x0046A2A0L, "bool __thiscall BfMap::addPlayerToBuddyListByID(int playerid)");

        // ----- Utility Functions -----
        setCallingConvention(0x00502E60L, "__fastcall");
        setReturnType(0x00502E60L, UINT32);
        setSig(0x00502E60L, "uint32_t __fastcall calcStringHashValueNoCase(const bfs::string& str)");

        setCallingConvention(0x00473430L, "__fastcall");
        setReturnType(0x00473430L, VOID);
        setSig(0x00473430L, "void __fastcall MD5Digest(const void* data, uint length, char* outputHex)");

        setCallingConvention(0x0040F660L, "__fastcall");
        setReturnType(0x0040F660L, ptrType);
        setSig(0x0040F660L, "Mat4& __fastcall setRotation(Mat4& m, const Vec3& rotation)");

        setCallingConvention(0x0040ECB0L, "__thiscall");
        setReturnType(0x0040ECB0L, VOID);
        setSig(0x0040ECB0L, "void __thiscall Game::addPlayerInput(int playerid, PlayerInput* input)");

        setCallingConvention(0x00443F10L, "__stdcall");
        setReturnType(0x00443F10L, BOOL);
        setSig(0x00443F10L, "bool __stdcall getStringFromRegistry(const char* key, const char* valueName, char* output, size_t* outlength)");

        // ----- Renderer -----
        setCallingConvention(0x004611D0L, "__thiscall");
        setReturnType(0x004611D0L, VOID);
        setSig(0x004611D0L, "void __thiscall Renderer::drawDebugText(int x, int y, const bfs::string& str)");

        setCallingConvention(0x00543110L, "__fastcall");
        setReturnType(0x00543110L, BOOL);
        setSig(0x00543110L, "bool __fastcall SupplyDepot_isHealing(IObject* depot)");

        setCallingConvention(0x005431B0L, "__fastcall");
        setReturnType(0x005431B0L, BOOL);
        setSig(0x005431B0L, "bool __fastcall SupplyDepot_isRepairing(IObject* depot)");

        setCallingConvention(0x005431E0L, "__fastcall");
        setReturnType(0x005431E0L, BOOL);
        setSig(0x005431E0L, "bool __fastcall SupplyDepot_isReloading(IObject* depot)");

        // ----- SpawnScreen -----
        setCallingConvention(0x006CCBC0L, "__stdcall");
        setReturnType(0x006CCBC0L, VOID);
        setSig(0x006CCBC0L, "void __stdcall SpawnScreen_setSpawnMessage(const bfs::wstring message)");

        // ----- Object System -----
        setCallingConvention(0x00541F50L, "__thiscall");
        setReturnType(0x00541F50L, VOID);
        setSig(0x00541F50L, "void __thiscall Projectile::resetProjectile()");

        // ----- Console -----
        setCallingConvention(0x005AC970L, "__thiscall");
        setReturnType(0x005AC970L, BOOL);
        setSig(0x005AC970L, "bool __thiscall ConsoleObjects::registerConsoleObjects(bfs::list<ConsoleObject*>& list)");

        setCallingConvention(0x005ACC30L, "__thiscall");
        setReturnType(0x005ACC30L, ptrType);
        setSig(0x005ACC30L, "bfs::string __thiscall ConsoleObject::execute(bfs::string* argv, int argc)");

        // ----- Debug -----
        setCallingConvention(0x005821A0L, "__cdecl");
        setReturnType(0x005821A0L, ptrType);
        setSig(0x005821A0L, "ostream& Debug::logStream()");

        setCallingConvention(0x00582270L, "__cdecl");
        setReturnType(0x00582270L, VOID);
        setSig(0x00582270L, "void Debug::logStreamEnd()");

        // ----- Memory -----
        setCallingConvention(0x0045BAF0L, "__cdecl");
        setReturnType(0x0045BAF0L, ptrType);
        setSig(0x0045BAF0L, "void* operator_new(size_t size)");

        setCallingConvention(0x0045BB60L, "__cdecl");
        setReturnType(0x0045BB60L, VOID);
        setSig(0x0045BB60L, "void operator_delete(void* ptr)");

        // ----- Sensitivity/Invert -----
        setCallingConvention(0x006C5840L, "__thiscall");
        setReturnType(0x006C5840L, FLOAT);
        setSig(0x006C5840L, "float __thiscall getLandSeaSensitivity()");

        setCallingConvention(0x006C5800L, "__thiscall");
        setReturnType(0x006C5800L, FLOAT);
        setSig(0x006C5800L, "float __thiscall getInfantrySensitivity()");

        setCallingConvention(0x006C5820L, "__thiscall");
        setReturnType(0x006C5820L, BOOL);
        setSig(0x006C5820L, "bool __thiscall getLandSeaInvert()");

        setCallingConvention(0x006C57E0L, "__thiscall");
        setReturnType(0x006C57E0L, BOOL);
        setSig(0x006C57E0L, "bool __thiscall getInfantryInvert()");

        // ----- System -----
        setCallingConvention(0x00581D90L, "__cdecl");
        setReturnType(0x00581D90L, UINT32);
        setSig(0x00581D90L, "uint32_t System::getMHZ()");

        // ----- STL string functions -----
        setSig(0x008C3134L, "bfs::string::string(const char*)");
        setSig(0x008C3220L, "bfs::string::string(const char*, size_t)");
        setSig(0x008C3114L, "bfs::string::string(const string&)");
        setSig(0x008C3048L, "bfs::string::string(const string&, size_t, size_t)");
        setSig(0x008C30BCL, "bfs::string::string(size_t, char)");
        setSig(0x008C3244L, "bfs::string::string()");
        setSig(0x008C311CL, "bfs::string::~string()");
        setSig(0x008C30DCL, "const char* bfs::string::c_str()");
        setSig(0x008C3160L, "bfs::string::replace(size_t, size_t, const string&)");
        setSig(0x008C30C8L, "bfs::string::append(const char*)");
        setSig(0x008C30F0L, "int bfs::string::compare(const char*)");
        setSig(0x008C3170L, "bfs::wstring::wstring(const wstring&)");
        setSig(0x008C30D8L, "bfs::wstring::wstring(const wchar_t*)");
        setSig(0x008C3184L, "bfs::wstring::wstring()");
        setSig(0x008C3178L, "bfs::wstring::~wstring()");
        setSig(0x008C3028L, "const wchar_t* bfs::wstring::c_str()");
        setSig(0x008C329CL, "bfs::wstring::replace(size_t, size_t, const wstring&)");
        setSig(0x008C323CL, "bfs::wstring::replace(size_t, size_t, const wchar_t*)");
        setSig(0x008C30C4L, "bfs::wstring::append(const wchar_t*)");
        setSig(0x008C30CCL, "bfs::wstring::operator=(const wstring&)");

        println("=== Setting function signatures done ===");

        // ==================== PLATE COMMENTS AT PATCH SITES ====================
        println("=== Adding patch comments ===");

        // Crash fixes
        plateComment(0x005389C9L,
            "[bf42plus] Particle::handleUpdate crash fix\n" +
            "Fix crash when game is minimized - integer index overflow.\n" +
            "Clamps particle index to 99.");

        plateComment(0x00601664L,
            "[bf42plus] MemoryPool::alloc crash fix\n" +
            "Check if pool has buffer before allocating, prevents crash on loading.");

        plateComment(0x004B403FL,
            "[bf42plus] Invalid GameEvent ID crash fix\n" +
            "Changed conditional jump so unknown event IDs don't crash the game.\n" +
            "Original: jz -> Changed to: je (skip invalid event)");

        plateComment(0x004931C5L,
            "[bf42plus] CreateObjectEvent crash fix (1/3)\n" +
            "Handle non-networked template IDs gracefully.\n" +
            "Disconnects with DATA_CORRUPT instead of crashing.");
        plateComment(0x00493271L,
            "[bf42plus] CreateObjectEvent crash fix (2/3)\n" +
            "Handle unknown template IDs gracefully.");
        plateComment(0x004932D2L,
            "[bf42plus] CreateObjectEvent crash fix (3/3)\n" +
            "Handle failed object creation gracefully.");

        plateComment(0x006D310BL,
            "[bf42plus] Radio playvoice crash fix\n" +
            "Fix crash when playing radio message for non-BFSoldier vehicle.");

        // Scoreboard
        plateComment(0x006DFB7EL,
            "[bf42plus] Scoreboard column width fix\n" +
            "Widen ping column from 30 to 35 pixels for 3-digit pings.");
        plateComment(0x006DFAC0L,
            "[bf42plus] Scoreboard column width fix (allied side)\n" +
            "Widen ping column from 30 to 35 pixels.");

        // Network/Server
        plateComment(0x004B6FFDL,
            "[bf42plus] Faster server pinging on restart\n" +
            "Set initial ping delay to 1.0s instead of 16.0s\n" +
            "Controlled by g_serverSettings.UI.allowFasterRestart");
        plateComment(0x004B6F6CL,
            "[bf42plus] Ping interval patch\n" +
            "Part of faster server restart pinging.");
        plateComment(0x00490F4CL,
            "[bf42plus] GameClient::disconnect UDP socket fix\n" +
            "Fix UDP socket handling during disconnect.");

        // Resolution/Display
        plateComment(0x0045FBD0L,
            "[bf42plus] Display settings string fix\n" +
            "Fix UserInterface::parseDisplaySettings command name.");
        plateComment(0x006B1083L,
            "[bf42plus] Screen resolution fix\n" +
            "Copy loaded resolution info to active resolution before changeResolution().");
        plateComment(0x0063F00EL,
            "[bf42plus] Display setting ID fix\n" +
            "Part of resolution fix chain.");
        plateComment(0x0045DD69L,
            "[bf42plus] Menu resolution patch\n" +
            "Fix menu rendering at non-standard resolutions.");

        // Master server
        plateComment(0x00957C30L,
            "[bf42plus] Master server address 1\n" +
            "Updated to master.bf1942.org");
        plateComment(0x00957DF8L,
            "[bf42plus] Master server address 2\n" +
            "Updated to master.bf1942.org");

        // Version display
        plateComment(0x0045F0C9L,
            "[bf42plus] Version display in menu\n" +
            "Show mod version string in game menu.");

        // Server list
        plateComment(0x0069F4AEL,
            "[bf42plus] Server list mod column\n" +
            "Add two zero-width columns for gameId.");
        plateComment(0x0069F971L,
            "[bf42plus] Server list column index fix\n" +
            "Read gameId from column 15 instead of 18.");
        plateComment(0x00494DFAL,
            "[bf42plus] Empty maplist fix\n" +
            "Disable faulty bool check that causes maplist to sometimes be empty.");
        plateComment(0x00401784L,
            "[bf42plus] Server list version check bypass\n" +
            "Ignore server version check in BfMultiplayerLobby::getServerColor\n" +
            "Shows all servers instead of greying out different versions.");

        // Gameplay
        plateComment(0x00440F90L,
            "[bf42plus] Lower nametags when close\n" +
            "Make nametags lower as player approaches.\n" +
            "Starts at 20 units, fully lowered at 0.\n" +
            "Controlled by g_settings.lowerNametags");
        plateComment(0x004904F0L,
            "[bf42plus] Drop actions on death\n" +
            "Hook GameClient::registerPlayerAction to drop input actions when player dies.\n" +
            "Reduces input delay/rubber-banding on death.");
        plateComment(0x004B77C7L,
            "[bf42plus] Mine warning fix\n" +
            "Call Projectile::resetProjectile when projectile is disabled\n" +
            "so mine warning icon goes away properly.");
        plateComment(0x004F85C7L,
            "[bf42plus] Glitchy projectile pickup fix\n" +
            "Fix flashing projectile bug by not calling resetProjectile on servers.");

        // Nametag patches
        plateComment(0x004416CBL,
            "[bf42plus] Add player ID to nametag (no HP variant)\n" +
            "Prepend player ID number to nametag display.\n" +
            "Controlled by g_settings.showIDInNametags");
        plateComment(0x0044153AL,
            "[bf42plus] Add player ID to nametag (with HP variant)\n" +
            "Prepend player ID number to nametag display.");
        plateComment(0x004411D0L,
            "[bf42plus] Buddy nametag color\n" +
            "Change nametag color for players on buddy list.");
        plateComment(0x006E082AL,
            "[bf42plus] Buddy scoreboard color\n" +
            "Change scoreboard row color for buddies (RGBF32).");
        plateComment(0x006A8A54L,
            "[bf42plus] Buddy chat color\n" +
            "Change chat text color for buddy messages.");

        // Spawn screen patches
        plateComment(0x006D8461L,
            "[bf42plus] Skip spawn screen on join\n" +
            "Controlled by g_serverSettings.UI.openSpawnScreenOnJoin");
        plateComment(0x004946CAL,
            "[bf42plus] Skip spawn screen on death\n" +
            "Controlled by g_serverSettings.UI.openSpawnScreenOnDeath");
        plateComment(0x006CD610L,
            "[bf42plus] Skip spawn text update\n" +
            "Skip spawn text timeout logic when spawn screen is disabled.");
        plateComment(0x006D8740L,
            "[bf42plus] Skip briefing window\n" +
            "Controlled by g_serverSettings.UI.skipBriefingWindow");

        // Enemy nametags
        plateComment(0x00441AA7L,
            "[bf42plus] Enemy nametag visibility (BFSoldier)\n" +
            "Show/hide nametags for enemy soldiers.\n" +
            "Controlled by g_serverSettings.UI.showEnemyNametags");
        plateComment(0x00441AF0L,
            "[bf42plus] Enemy nametag visibility (PlayerControlObject)\n" +
            "Show/hide nametags for enemy vehicles.\n" +
            "Controlled by g_serverSettings.UI.showEnemyNametags");

        // Hit indicator
        plateComment(0x00495A24L,
            "[bf42plus] Custom hit indicator time\n" +
            "Override BFPlayer.HitIndicationTime value.\n" +
            "Controlled by g_settings.hitIndicatorTime");
        plateComment(0x006AEBA8L,
            "[bf42plus] Hit indicator alpha adjustment\n" +
            "Divide hit indication time for BfMenu.\n" +
            "Controlled by g_settings.hitIndicatorTime");

        // FPU precision
        plateComment(0x0063F217L,
            "[bf42plus] Higher precision FPU (1/2)\n" +
            "Enable D3DCREATE_FPU_PRESERVE flag.\n" +
            "Improves frame timing and simulation accuracy using double precision.");
        plateComment(0x0063F0C1L,
            "[bf42plus] Higher precision FPU (2/2)\n" +
            "Part of FPU precision improvement.");

        // FPS display
        plateComment(0x00462826L,
            "[bf42plus] ShowFPS more decimal places (1/2)\n" +
            "Increase average FPS display from 1 to 3 decimal places.");
        plateComment(0x004628E6L,
            "[bf42plus] ShowFPS more decimal places (2/2)");

        // CD Key
        plateComment(0x0040CD5EL,
            "[bf42plus] CD key validation bypass (1/3)\n" +
            "Allow game to work without CD key registry entries.\n" +
            "Changed jnz to jmp for graceful failure.");
        plateComment(0x00459EEDL,
            "[bf42plus] CD key validation bypass (2/3)");
        plateComment(0x0049510AL,
            "[bf42plus] CD key validation bypass (3/3)");
        plateComment(0x0045831DL,
            "[bf42plus] CD key blacklist disable\n" +
            "Disable broken key blacklist function.");

        // CPU/Performance
        plateComment(0x00581D90L,
            "[bf42plus] Disable CPU clock measurement\n" +
            "Skip 500ms CPU speed measurement at startup.\n" +
            "Set fixed clock of 2200MHz.");
        plateComment(0x00632478L,
            "[bf42plus] ForegroundLockTimeout fix\n" +
            "Reduce delay by not updating ForegroundLockTimeout in registry.");

        // Healthbar
        plateComment(0x006CDE8AL,
            "[bf42plus] Hide broken healthbar\n" +
            "Hide soldier HUD if healthbar texture name is empty (no kit).");

        // Static objects
        plateComment(0x00411170L,
            "[bf42plus] Skip loading StaticObjects.con\n" +
            "Skip loading static objects from map file if server sent them.\n" +
            "Controlled by g_skipLoadingStaticObjects");

        // Debug
        plateComment(0x004B4045L,
            "[bf42plus] Network error debug logging\n" +
            "Add debug output when GameEvent::deSerialize fails.");
        plateComment(0x0048FFB6L,
            "[bf42plus] Debug restart code patch");

        // Disconnect message
        plateComment(0x006ADF69L,
            "[bf42plus] Force spawn text to show\n" +
            "Override spawn text visibility check.");
        plateComment(0x00495FD2L,
            "[bf42plus] Force disconnect message to show\n" +
            "Override disconnect message visibility check.");

        // Server message
        plateComment(0x006A88B1L,
            "[bf42plus] Disable server message console output\n" +
            "Prevent original server message from being output to console.");

        // Renderer
        plateComment(0x004670A5L,
            "[bf42plus] Renderer draw hook\n" +
            "Hook around nametag rendering for custom text drawing.");
        plateComment(0x00460A92L,
            "[bf42plus] Texture handler registration hook\n" +
            "Add PNG and JPEG texture handler support.");
        plateComment(0x004676B4L,
            "[bf42plus] Screenshot name generation\n" +
            "Replace screenshot filename generation with custom path/format.");
        plateComment(0x004634B2L,
            "[bf42plus] Screenshot counter init disable\n" +
            "Don't reset screenshot counter when window is created.");

        // CreatePlayerEvent callback
        plateComment(0x00493B07L,
            "[bf42plus] Player created callback\n" +
            "Called after GameClient finishes processing CreatePlayerEvent.\n" +
            "Handles auto-ignore and 'connecting' chat messages.");

        println("=== Adding patch comments done ===");

        // ==================== GLOBAL DATA TYPES ====================
        println("=== Applying global data types ===");

        DataType ptr4 = new PointerDataType(DataType.DEFAULT, 4);

        setGlobalType(0x0097D76CL, ptr4);  // pPlayerManager
        setGlobalType(0x0097D764L, ptr4);  // pObjectManager
        setGlobalType(0x0097D768L, ptr4);  // pObjectTemplateManager
        setGlobalType(0x009A99D4L, ptr4);  // RendPCDX8 singleton
        setGlobalType(0x009A99D8L, ptr4);  // g_TextureManager
        setGlobalType(0x00971EACL, ptr4);  // g_pSetup
        setGlobalType(0x009A2170L, ptr4);  // g_Locale
        setGlobalType(0x00973AB8L, ptr4);  // BfMenu singleton
        setGlobalType(0x0095F8D4L, ptr4);  // g_pIGame
        setGlobalType(0x00A5C630L, ptr4);  // g_MainUI
        setGlobalType(0x00A5F1A8L, ptr4);  // SpawnScreen singleton
        setGlobalType(0x009A9390L, ptr4);  // g_pGameClient
        setGlobalType(0x009AB610L, ptr4);  // ConsoleObjects singleton
        setGlobalType(0x009AB868L, ptr4);  // pRenderView
        setGlobalType(0x009A9428L, ptr4);  // g_console_run_result

        println("=== Applying global data types done ===");
        println("");
        println("Enhancement complete! Function signatures, comments, and global types applied.");
    }
}
