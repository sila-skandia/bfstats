// Ghidra headless script to create data types from bf42plus source code
// Usage: analyzeHeadless /path/to/project ProjectName -process BF1942.exe -noanalysis -postScript ghidra_types.java
//@category bf42plus

import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.*;

public class ghidra_types extends GhidraScript {

    private DataTypeManager dtm;
    private CategoryPath cat;
    private DataType PTR;
    private DataType VOID;
    private DataType UINT8;
    private DataType UINT16;
    private DataType UINT32;
    private DataType INT32;
    private DataType FLOAT;
    private DataType BOOL;
    private DataType CHAR;
    private DataType WCHAR;

    // Helper: create a function definition for a vtable entry (thiscall: this in ecx)
    private FunctionDefinitionDataType vfunc(String name, DataType returnType, DataType... paramTypes) {
        FunctionDefinitionDataType fn = new FunctionDefinitionDataType(cat, name);
        fn.setReturnType(returnType);
        ParameterDefinition[] params = new ParameterDefinition[paramTypes.length + 1];
        params[0] = new ParameterDefinitionImpl("this", PTR, null);
        for (int i = 0; i < paramTypes.length; i++) {
            params[i + 1] = new ParameterDefinitionImpl("param_" + (i + 1), paramTypes[i], null);
        }
        fn.setArguments(params);
        fn.setGenericCallingConvention(GenericCallingConvention.thiscall);
        return fn;
    }

    // Helper: add a function pointer to a vtable struct at the next offset
    private void addVFunc(StructureDataType vtable, String name, DataType returnType, DataType... paramTypes) {
        FunctionDefinitionDataType fn = vfunc(name, returnType, paramTypes);
        vtable.add(new PointerDataType(fn), 4, name, null);
    }

    private StructureDataType createVec3() {
        StructureDataType s = new StructureDataType(cat, "Vec3", 0);
        s.add(FLOAT, "x", null);
        s.add(FLOAT, "y", null);
        s.add(FLOAT, "z", null);
        return s;
    }

    private StructureDataType createVec2() {
        StructureDataType s = new StructureDataType(cat, "Vec2", 0);
        s.add(FLOAT, "x", null);
        s.add(FLOAT, "y", null);
        return s;
    }

    private StructureDataType createVec4() {
        StructureDataType s = new StructureDataType(cat, "Vec4", 0);
        s.add(FLOAT, "x", null);
        s.add(FLOAT, "y", null);
        s.add(FLOAT, "z", null);
        s.add(FLOAT, "w", null);
        return s;
    }

    private StructureDataType createMat4(DataType vec4) {
        StructureDataType s = new StructureDataType(cat, "Mat4", 0);
        s.add(vec4, "a", null);
        s.add(vec4, "b", null);
        s.add(vec4, "c", null);
        s.add(vec4, "position", null);
        return s;
    }

    private StructureDataType createPlayerInput() {
        StructureDataType s = new StructureDataType(cat, "PlayerInput", 0);
        s.add(new ArrayDataType(FLOAT, 55, 4), "controls", null);
        s.add(UINT32, "mask_lo", null);
        s.add(UINT32, "mask_hi", null);
        s.add(INT32, "unk1", null);
        s.add(INT32, "unk2", null);
        // static_assert: 0xF0
        return s;
    }

    private StructureDataType createBfsString() {
        StructureDataType s = new StructureDataType(cat, "bfs_string", 0);
        s.add(UINT32, "allocator", null);
        s.add(new ArrayDataType(CHAR, 16, 1), "internal_buffer", null);
        s.add(UINT32, "length", null);
        s.add(UINT32, "buffersize", null);
        // total: 0x1C
        return s;
    }

    private StructureDataType createBfsWString() {
        StructureDataType s = new StructureDataType(cat, "bfs_wstring", 0);
        s.add(UINT32, "allocator", null);
        s.add(new ArrayDataType(WCHAR, 8, 2), "internal_buffer", null);
        s.add(UINT32, "length", null);
        s.add(UINT32, "buffersize", null);
        // total: 0x1C
        return s;
    }

    // ======================== VTABLES ========================

    private StructureDataType createIBaseVtable() {
        StructureDataType vt = new StructureDataType(cat, "IBase_vtable", 0);
        addVFunc(vt, "addRef", VOID);
        addVFunc(vt, "release", VOID);
        addVFunc(vt, "queryInterface", PTR, UINT32);
        return vt;
    }

    private StructureDataType createBFPlayerVtable() {
        StructureDataType vt = new StructureDataType(cat, "BFPlayer_vtable", 0);
        // IBase (slots 0-2)
        addVFunc(vt, "addRef", VOID);
        addVFunc(vt, "release", VOID);
        addVFunc(vt, "queryInterface", PTR, UINT32);
        // BFPlayer (slots 3+)
        addVFunc(vt, "GetClassID", INT32);
        addVFunc(vt, "destructor", VOID);
        addVFunc(vt, "setName", VOID, PTR); // const bfs::string&
        addVFunc(vt, "getName", PTR);        // returns const bfs::string&
        addVFunc(vt, "setFlags", VOID, PTR);
        addVFunc(vt, "testFlags", BOOL, PTR);
        addVFunc(vt, "handleUpdate", VOID, FLOAT, UINT32);
        addVFunc(vt, "getUpdateFrequencyType", INT32);
        addVFunc(vt, "setUpdateFrequencyType", VOID, INT32);
        addVFunc(vt, "handleInput", VOID, PTR, FLOAT); // PlayerInput*
        addVFunc(vt, "getCamera", PTR);
        addVFunc(vt, "getVehicle", PTR);     // returns IObject*
        addVFunc(vt, "setVehicle", BOOL, PTR, INT32);
        addVFunc(vt, "getInputId", INT32);
        addVFunc(vt, "getId", INT32);        // offset 0x44
        addVFunc(vt, "setId", VOID, INT32);
        addVFunc(vt, "setIsRemote", VOID);
        addVFunc(vt, "getIsRemote", BOOL);
        addVFunc(vt, "setIsAIPlayer", VOID);
        addVFunc(vt, "getIsAIPlayer", BOOL);
        addVFunc(vt, "setCamera", VOID, PTR); // IObject*
        return vt;
    }

    private StructureDataType createIObjectVtable() {
        StructureDataType vt = new StructureDataType(cat, "IObject_vtable", 0);
        // IBase (slots 0-2) — but IObject redeclares destructor as slot 0
        // Actually IObject inherits IBase, so IBase vtable comes first
        addVFunc(vt, "addRef", VOID);
        addVFunc(vt, "release", VOID);
        addVFunc(vt, "queryInterface", PTR, UINT32);
        // IObject (slots 3+)
        addVFunc(vt, "destructor", VOID);
        addVFunc(vt, "init", VOID);
        addVFunc(vt, "destroy", VOID);
        addVFunc(vt, "immediateDestroy", VOID);
        addVFunc(vt, "isObjectDestroyed", BOOL);
        addVFunc(vt, "setComponent", BOOL, INT32, PTR);
        addVFunc(vt, "queryComponent", PTR, UINT32, UINT32);
        addVFunc(vt, "updateFlags", VOID, UINT32, UINT32);
        addVFunc(vt, "getName", PTR);
        addVFunc(vt, "setName", VOID, PTR);
        addVFunc(vt, "getAbsolutePosition", PTR);
        addVFunc(vt, "setAbsolutePosition", VOID, PTR);
        addVFunc(vt, "getAbsoluteTransformation", PTR);
        addVFunc(vt, "setAbsoluteTransformation", VOID, PTR);
        addVFunc(vt, "getBoundingRadius", FLOAT);
        addVFunc(vt, "handleVisualUpdate", VOID, FLOAT, FLOAT);
        addVFunc(vt, "handleFrameUpdate", VOID, FLOAT);
        addVFunc(vt, "handleUpdate", VOID, FLOAT, UINT32);
        addVFunc(vt, "handleCollision", VOID, PTR, PTR, PTR, PTR, INT32, INT32);
        addVFunc(vt, "updateComponents", VOID);
        addVFunc(vt, "getUpdateFrequency", INT32);
        addVFunc(vt, "getUpdateFrequencyType", INT32);
        addVFunc(vt, "setUpdateFrequencyType", INT32, INT32);
        addVFunc(vt, "getRelativePosition", PTR);
        addVFunc(vt, "setRelativePosition", VOID, PTR);
        addVFunc(vt, "getRelativeTransformation", PTR);
        addVFunc(vt, "setRelativeTransformation", VOID, PTR);
        addVFunc(vt, "getChild", PTR);
        addVFunc(vt, "addChild", VOID, PTR);
        addVFunc(vt, "removeChild", VOID, PTR);
        addVFunc(vt, "addSibling", VOID, PTR);
        addVFunc(vt, "removeSibling", VOID, PTR);
        addVFunc(vt, "setParent", VOID, PTR);
        addVFunc(vt, "resetCachedRootParents", VOID);
        addVFunc(vt, "handlePlayerInput", VOID, PTR, PTR, FLOAT);
        addVFunc(vt, "handleMessage", VOID, INT32, PTR);
        addVFunc(vt, "getInputId", CHAR);
        addVFunc(vt, "setInputId", VOID, CHAR);
        addVFunc(vt, "getChildId", CHAR);
        addVFunc(vt, "setChildId", VOID, CHAR);
        addVFunc(vt, "internalRelease", VOID);
        return vt;
    }

    private StructureDataType createObjectTemplateVtable() {
        StructureDataType vt = new StructureDataType(cat, "ObjectTemplate_vtable", 0);
        // IBase
        addVFunc(vt, "addRef", VOID);
        addVFunc(vt, "release", VOID);
        addVFunc(vt, "queryInterface", PTR, UINT32);
        // ObjectTemplate
        addVFunc(vt, "getClassID", INT32);
        addVFunc(vt, "setName", VOID, PTR);
        addVFunc(vt, "getName", PTR);
        addVFunc(vt, "setId", VOID, UINT32);
        addVFunc(vt, "getId", UINT32);
        addVFunc(vt, "getFlags", UINT32);
        addVFunc(vt, "updateFlags", VOID, UINT32, UINT32);
        addVFunc(vt, "queryImplementation", PTR, UINT32);
        addVFunc(vt, "createObject", PTR);
        addVFunc(vt, "setComponent", VOID, UINT32, PTR);
        addVFunc(vt, "queryComponent", PTR, UINT32, UINT32);
        addVFunc(vt, "preCache", VOID);
        addVFunc(vt, "setCullRadiusScale", VOID, FLOAT);
        addVFunc(vt, "getCullRadiusScale", FLOAT);
        addVFunc(vt, "destructor", VOID);
        addVFunc(vt, "setNetworkableInfo", VOID, PTR);
        addVFunc(vt, "getNetworkableInfo", PTR);
        return vt;
    }

    private StructureDataType createGameEventVtable() {
        StructureDataType vt = new StructureDataType(cat, "GameEvent_vtable", 0);
        addVFunc(vt, "getType", INT32);
        addVFunc(vt, "destructor", VOID);
        addVFunc(vt, "logInfo", VOID, BOOL, INT32);
        addVFunc(vt, "eventReceivedByRemote", VOID, PTR);
        addVFunc(vt, "deSerialize", BOOL, PTR); // BitStream*
        addVFunc(vt, "serialize", BOOL, PTR);   // BitStream*
        return vt;
    }

    // ======================== STRUCTS ========================

    private StructureDataType createBFPlayer(DataType vtablePtr) {
        StructureDataType s = new StructureDataType(cat, "BFPlayer", 0);
        s.add(vtablePtr, "vtable", null);
        // We don't know the full layout, but we know offset 0xAC is team
        // Pad to 0xAC
        s.add(new ArrayDataType(UINT8, 0xA8, 1), "unknown_04", null);
        s.add(INT32, "team", null); // offset 0xAC
        return s;
    }

    private StructureDataType createIObject(DataType vtablePtr, DataType objTmplPtr) {
        StructureDataType s = new StructureDataType(cat, "IObject", 0);
        s.add(vtablePtr, "vtable", null);       // 0x00
        s.add(UINT32, "flags", null);            // 0x04
        s.add(new ArrayDataType(UINT8, 52, 1), "unknown_08", null); // 0x08-0x3B
        s.add(INT32, "unknown_3C", null);        // 0x3C
        s.add(new ArrayDataType(UINT8, 8, 1), "unknown_40", null); // 0x40-0x47
        s.add(INT32, "gridid", null);            // 0x48
        s.add(objTmplPtr, "tmpl", null);         // 0x4C
        s.add(PTR, "parent", null);              // 0x50 - IObject*
        s.add(PTR, "nextSibling", null);         // 0x54 - IObject*
        s.add(PTR, "AIObject", null);            // 0x58
        s.add(PTR, "geometry", null);            // 0x5C
        s.add(PTR, "physicsNode", null);         // 0x60
        s.add(PTR, "responsePhysics", null);     // 0x64
        s.add(PTR, "networkable", null);         // 0x68 - NetworkableBase*
        // total: 0x6C
        return s;
    }

    private StructureDataType createObjectTemplate(DataType vtablePtr, DataType bfsStr) {
        StructureDataType s = new StructureDataType(cat, "ObjectTemplate", 0);
        s.add(vtablePtr, "vtable", null);        // 0x00 (vtable pointer, IBase part)
        // IConsoleSaveable vtable pointer (multiple inheritance)
        s.add(PTR, "vtable_IConsoleSaveable", null); // 0x04
        s.add(bfsStr, "name", null);             // 0x08 - bfs::string (0x1C bytes)
        s.add(bfsStr, "networkableInfo", null);  // 0x24 - bfs::string (0x1C bytes)
        s.add(INT32, "id", null);                // 0x40
        s.add(UINT32, "flags", null);            // 0x44
        // bfs::map is 0x0C bytes
        s.add(new ArrayDataType(UINT8, 12, 1), "components", null); // 0x48 - bfs::map
        s.add(FLOAT, "cullRadiusScale", null);   // 0x54
        // total: 0x58
        return s;
    }

    private StructureDataType createGameEvent(DataType vtablePtr) {
        StructureDataType s = new StructureDataType(cat, "GameEvent", 0);
        s.add(vtablePtr, "vtable", null);        // 0x00
        s.add(UINT32, "sequenceNumber", null);   // 0x04
        s.add(PTR, "nextEvent", null);           // 0x08 - GameEvent*
        return s;
    }

    // Pack 1 event structs
    private StructureDataType createCreatePlayerEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "CreatePlayerEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        // GameEvent base
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        // CreatePlayerEvent fields (pack 1)
        s.add(UINT8, "team", null);
        s.add(UINT8, "spawngroup", null);
        s.add(BOOL, "isRemote", null);
        s.add(new ArrayDataType(CHAR, 32, 1), "name", null);
        s.add(UINT8, "playerID", null);
        s.add(UINT16, "playerNetworkID", null);
        s.add(UINT16, "vehicleNetworkID", null);
        s.add(UINT16, "cameraNetworkID", null);
        s.add(UINT16, "kitNetworkID", null);
        s.add(BOOL, "isAI", null);
        // total: 0x39
        return s;
    }

    private StructureDataType createScoreMsgEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "ScoreMsgEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT32, "eventid", null);  // ScoreEventID
        s.add(UINT8, "playerid", null);
        s.add(UINT8, "victimpid", null);
        s.add(INT32, "weapon", null);
        s.add(INT32, "bodypart", null);
        // total: 0x1A
        return s;
    }

    private StructureDataType createDestroyPlayerEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "DestroyPlayerEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT8, "playerid", null);
        // total: 0x0D
        return s;
    }

    private StructureDataType createSetTeamEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "SetTeamEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT8, "playerid", null);
        s.add(UINT8, "teamid", null);
        // total: 0x0E
        return s;
    }

    private StructureDataType createVoteEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "VoteEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT8, "target", null);
        s.add(UINT8, "yesCount", null);
        s.add(UINT8, "noCount", null);
        s.add(UINT8, "votesRequired", null);
        s.add(UINT8, "playerID", null);
        s.add(FLOAT, "voteTime", null);
        s.add(UINT32, "action", null);  // VoteAction
        s.add(UINT32, "type", null);    // VoteType
        // total: 0x1D
        return s;
    }

    private StructureDataType createChatFragmentEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "ChatFragmentEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(BOOL, "firstFragment", null);
        s.add(BOOL, "consoleMessage", null);
        s.add(BOOL, "broadcast", null);
        s.add(BOOL, "serverMessage", null);
        s.add(INT32, "senderID", null);
        s.add(UINT8, "totalLength", null);
        s.add(UINT8, "textLength", null);
        s.add(new ArrayDataType(CHAR, 16, 1), "text", null);
        // total: 0x26
        return s;
    }

    private StructureDataType createRadioMessageEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "RadioMessageEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT16, "messageID", null);
        s.add(BOOL, "broadcast", null);
        s.add(UINT8, "playerid", null);
        // total: 0x10
        return s;
    }

    private StructureDataType createGameStatusEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "GameStatusEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT8, "newStatus", null);  // GameStatus
        s.add(new ArrayDataType(CHAR, 5, 1), "reconnectPassword", null);
        s.add(UINT8, "nextMapModnameLength", null);
        s.add(new ArrayDataType(CHAR, 32, 1), "nextMapModname", null);
        // total: 0x33
        return s;
    }

    private StructureDataType createWelcomeMsgEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "WelcomeMsgEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(INT32, "id", null);
        s.add(new ArrayDataType(CHAR, 64, 1), "message", null);
        s.add(UINT32, "length", null);
        // total: 0x54
        return s;
    }

    private StructureDataType createSpecialGameEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "SpecialGameEvent", 0);
        s.setPackingEnabled(true);
        s.setExplicitMinimumAlignment(1);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT8, "action", null);
        // total: 0x0D
        return s;
    }

    private StructureDataType createHUDTextEvent(DataType gameEventVtablePtr) {
        StructureDataType s = new StructureDataType(cat, "HUDTextEvent", 0);
        s.add(gameEventVtablePtr, "vtable", null);
        s.add(UINT32, "sequenceNumber", null);
        s.add(PTR, "nextEvent", null);
        s.add(UINT32, "type", null);   // HUDTextType
        s.add(UINT32, "length", null);
        s.add(new ArrayDataType(CHAR, 128, 1), "text", null);
        return s;
    }

    private StructureDataType createGameClient(DataType bfplayerPtr) {
        // Partial struct — only known offsets filled in
        StructureDataType s = new StructureDataType(cat, "GameClient", 0);
        // 0x000 - 0x16F: unknown
        s.add(new ArrayDataType(UINT8, 0x170, 1), "unknown_000", null);
        s.add(bfplayerPtr, "cachedPlayer", null);  // 0x170 - BFPlayer*
        // 0x174 - 0x183: unknown
        s.add(new ArrayDataType(UINT8, 0x10, 1), "unknown_174", null);
        s.add(PTR, "playerListEnd", null);          // 0x184 - end sentinel for player lookup
        return s;
    }

    private StructureDataType createNetworkableBase() {
        StructureDataType s = new StructureDataType(cat, "NetworkableBase", 0);
        s.add(PTR, "vtable", null);              // 0x00
        s.add(UINT16, "networkID", null);        // 0x04
        s.add(new ArrayDataType(UINT8, 2, 1), "pad_06", null);
        s.add(PTR, "networkInfo", null);         // 0x08
        s.add(UINT8, "unkC", null);              // 0x0C
        s.add(new ArrayDataType(UINT8, 3, 1), "pad_0D", null);
        s.add(FLOAT, "basePriority", null);      // 0x10
        s.add(UINT8, "unk14", null);             // 0x14
        s.add(new ArrayDataType(UINT8, 3, 1), "pad_15", null);
        s.add(PTR, "pINetworkableObject", null); // 0x18
        s.add(BOOL, "allocatedFromMemoryPool", null); // 0x1C
        s.add(new ArrayDataType(UINT8, 3, 1), "pad_1D", null);
        s.add(UINT32, "unk20", null);            // 0x20
        s.add(UINT32, "unk24", null);            // 0x24
        s.add(INT32, "updateIndex", null);       // 0x28
        s.add(UINT32, "unk2C", null);            // 0x2C
        s.add(INT32, "bsStartPosition", null);   // 0x30
        // total: 0x34
        return s;
    }

    // ======================== ENUMS ========================

    private EnumDataType createGameEventID() {
        EnumDataType e = new EnumDataType(cat, "GameEventID", 4);
        e.add("BF_HUDTextEvent", 0x01);
        e.add("BF_CreatePlayerEvent", 0x08);
        e.add("BF_DestroyPlayerEvent", 0x0C);
        e.add("BF_VoteEvent", 0x12);
        e.add("BF_WelcomeMsgEvent", 0x17);
        e.add("BF_CreateStaticObjectEvent", 0x1C);
        e.add("BF_UpdateStaticObjectEvent", 0x1D);
        e.add("BF_GameStatusEvent", 0x24);
        e.add("BF_SpecialGameEvent", 0x27);
        e.add("BF_ChatFragmentEvent", 0x28);
        e.add("BF_ScoreMsgEvent", 0x2A);
        e.add("BF_DataBaseCompleteEvent", 0x34);
        e.add("BF_SetLevelEvent", 0x36);
        e.add("BF_SetTeamEvent", 0x39);
        e.add("BF_RadioMessageEvent", 0x3A);
        return e;
    }

    private EnumDataType createScoreEventID() {
        EnumDataType e = new EnumDataType(cat, "ScoreEventID", 4);
        e.add("SE_FLAGCAPTURE", 0);
        e.add("SE_ATTACK", 1);
        e.add("SE_DEFENCE", 2);
        e.add("SE_KILL", 3);
        e.add("SE_DEATH", 4);
        e.add("SE_DEATHNOMSG", 5);
        e.add("SE_TK", 6);
        e.add("SE_SPAWNED", 7);
        e.add("SE_OBJECTIVE", 8);
        e.add("SE_OBJECTIVETK", 9);
        return e;
    }

    private EnumDataType createVoteAction() {
        EnumDataType e = new EnumDataType(cat, "VoteAction", 4);
        e.add("VA_START", 0);
        e.add("VA_FAILED", 1);
        e.add("VA_PASSED", 2);
        e.add("VA_UPDATE", 3);
        return e;
    }

    private EnumDataType createVoteType() {
        EnumDataType e = new EnumDataType(cat, "VoteType", 4);
        e.add("VT_MAP", 0);
        e.add("VT_KICK", 1);
        e.add("VT_TEAMKICK", 2);
        return e;
    }

    private EnumDataType createGameStatus() {
        EnumDataType e = new EnumDataType(cat, "GameStatus", 1);
        e.add("GS_PLAYING", 1);
        e.add("GS_ENDGAME", 2);
        e.add("GS_PREGAME", 3);
        e.add("GS_PAUSED", 4);
        e.add("GS_ENDMAP", 5);
        return e;
    }

    private EnumDataType createHUDTextType() {
        EnumDataType e = new EnumDataType(cat, "HUDTextType", 4);
        e.add("HTT_CENTERTOP2", 0);
        e.add("HTT_CENTERTOP3", 1);
        e.add("HTT_DEATHMESSAGE", 2);
        e.add("HTT_CENTERYELLOW", 3);
        return e;
    }

    @Override
    public void run() throws Exception {
        dtm = currentProgram.getDataTypeManager();
        cat = new CategoryPath("/bf42plus");

        // Primitive types
        PTR = new PointerDataType(DataType.DEFAULT, 4);
        VOID = VoidDataType.dataType;
        UINT8 = AbstractIntegerDataType.getUnsignedDataType(1, dtm);
        UINT16 = AbstractIntegerDataType.getUnsignedDataType(2, dtm);
        UINT32 = AbstractIntegerDataType.getUnsignedDataType(4, dtm);
        INT32 = AbstractIntegerDataType.getSignedDataType(4, dtm);
        FLOAT = FloatDataType.dataType;
        BOOL = BooleanDataType.dataType;
        CHAR = CharDataType.dataType;
        WCHAR = WideCharDataType.dataType;

        int id = dtm.startTransaction("bf42plus types");
        try {
            // Basic types
            DataType vec2 = dtm.addDataType(createVec2(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType vec3 = dtm.addDataType(createVec3(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType vec4 = dtm.addDataType(createVec4(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType mat4 = dtm.addDataType(createMat4(vec4), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType playerInput = dtm.addDataType(createPlayerInput(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType bfsStr = dtm.addDataType(createBfsString(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType bfsWStr = dtm.addDataType(createBfsWString(), DataTypeConflictHandler.REPLACE_HANDLER);

            // Enums
            dtm.addDataType(createGameEventID(), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createScoreEventID(), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createVoteAction(), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createVoteType(), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createGameStatus(), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createHUDTextType(), DataTypeConflictHandler.REPLACE_HANDLER);

            // Vtables
            DataType ibaseVt = dtm.addDataType(createIBaseVtable(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType bfplayerVt = dtm.addDataType(createBFPlayerVtable(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType iobjectVt = dtm.addDataType(createIObjectVtable(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType objTmplVt = dtm.addDataType(createObjectTemplateVtable(), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType gameEventVt = dtm.addDataType(createGameEventVtable(), DataTypeConflictHandler.REPLACE_HANDLER);

            DataType bfplayerVtPtr = new PointerDataType(bfplayerVt);
            DataType iobjectVtPtr = new PointerDataType(iobjectVt);
            DataType objTmplVtPtr = new PointerDataType(objTmplVt);
            DataType gameEventVtPtr = new PointerDataType(gameEventVt);

            // Structs
            DataType bfplayer = dtm.addDataType(createBFPlayer(bfplayerVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType iobject = dtm.addDataType(createIObject(iobjectVtPtr, PTR), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType objTmpl = dtm.addDataType(createObjectTemplate(objTmplVtPtr, bfsStr), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType gameEvent = dtm.addDataType(createGameEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            DataType networkableBase = dtm.addDataType(createNetworkableBase(), DataTypeConflictHandler.REPLACE_HANDLER);

            // GameClient (uses BFPlayer*)
            DataType bfplayerPtr = new PointerDataType(bfplayer);
            DataType gameClient = dtm.addDataType(createGameClient(bfplayerPtr), DataTypeConflictHandler.REPLACE_HANDLER);

            // GameEvent subtypes
            dtm.addDataType(createCreatePlayerEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createScoreMsgEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createDestroyPlayerEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createSetTeamEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createVoteEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createChatFragmentEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createRadioMessageEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createGameStatusEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createWelcomeMsgEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createSpecialGameEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);
            dtm.addDataType(createHUDTextEvent(gameEventVtPtr), DataTypeConflictHandler.REPLACE_HANDLER);

            println("bf42plus data types created successfully!");
            println("Types are in /bf42plus category in the Data Type Manager.");
            println("");
            println("To use: In the decompiler, right-click a variable -> Retype Variable");
            println("  e.g., retype param_2 as CreatePlayerEvent* in case 0x08");
            println("  e.g., retype a player pointer as BFPlayer*");
            println("  Virtual calls will then show named methods instead of offsets.");

        } finally {
            dtm.endTransaction(id, true);
        }
    }
}
