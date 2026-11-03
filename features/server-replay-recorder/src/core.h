/*
 * Shared core of the server-side round replay recorder.
 *
 * One core (config, tracking hash, quaternion math, ndjson emitters, the
 * sampler and the stage-3 capture logic: detour callbacks, joints, engines,
 * armor, tickets, kits, roster synthesis) plus two thin target layers,
 * selected at build time:
 *
 *   src/core.c            this file
 *   src/core.h            the target contract (offset table + platform shims)
 *   src/target_lnxded.c   bf1942_lnxded: SGI-STL layouts, /proc/self/mem
 *                         preads, ELF-constructor entry, RWX-trampoline
 *                         detours (REC_STAGE3=1)
 *   src/target_w32ded.c   BF1942_w32ded.exe: MSVC-STL layouts, IsBadReadPtr
 *                         reads, DllMain + CreateThread entry, proxy-WINMM
 *                         winmm IAT reroute, VirtualProtect detours
 *                         (REC_STAGE3=1 REC_MSVC_VT=1)
 *
 * The core is written against the target contract: every address, struct
 * offset and platform call goes through the `struct rec_target` table.
 * A target built with -DREC_STAGE3=0 compiles the stage-3 paths out (do not
 * copy stage 3 into a target by hand -- it lives here already).
 *
 * Two ways to drive the capture, chosen at build time:
 *   REC_TICK=1  (lnxded) the game thread samples the world inside the
 *               GameServer::simulateFrame hook, with plain reads behind a
 *               SIGSEGV guard; a writer thread does the file I/O
 *   REC_TICK=0  (w32ded, the POC) a sampler thread polls the world through
 *               the target's safe reads
 */

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#ifndef RECORDER_CORE_H
#define RECORDER_CORE_H

#ifndef REC_TICK
#define REC_TICK 0
#endif

/* REC_FIRE_INDEX=1: each `f` record also carries the launch matrix's other
 * two rows (`ra`, `rb`), every row and its point at full float precision,
 * and `gi`, Game::getCurrentInputIndex at fireBarrel's entry (the index its
 * deviation draw reads, ledger DEV-9, DEV-14); `pj` places at 4 decimals.
 * For the lab's deviation fits (tools/bf1942-models/lab/dev_index_probe.mjs);
 * off in the shipped build, whose records stay the size they were. */
#ifndef REC_FIRE_INDEX
#define REC_FIRE_INDEX 0
#endif

/* A virtual call through a raw vtable slot. GCC (lnxded) member functions
 * pass `this` on the stack like any first argument; MSVC (w32ded) passes it
 * in ECX. The w32 build defines REC_MSVC_VT=1 so the indirect calls below
 * use GCC's __attribute__((thiscall)). */
#ifdef REC_MSVC_VT
#define REC_VTCALL __attribute__((thiscall))
#else
#define REC_VTCALL
#endif

/*
 * The target contract. Addresses and struct offsets are per binary; the
 * platform shims are per OS. Stage-3 fields (marked) are only touched by
 * REC_STAGE3 code; a stage-1 target still has to name them (zeros are fine
 * where nothing is verified yet).
 */
struct rec_target {
    const char *name;          /* "lnxded" / "w32ded" */
    const char *header_plus;   /* the h record's "plus" string */
    int header_version;        /* the h record's format version */

    /* The server's own code (its .text): a function pointer read from the
     * game's memory is called only when it lands in here. */
    uint32_t code_lo, code_hi;

    /* --- globals (addresses in the target binary) --- */
    uint32_t object_manager_ptr;   /* dice::ref2::world::objectManager */
    uint32_t player_manager_ptr;   /* stage 3: dice::ref2::world::playerManager */
    uint32_t template_manager_ptr; /* stage 3: dice::ref2::world::objectTemplateManager */
    uint32_t tmgr_id_map_off;   /* manager + : its id -> template map's {head, count}; 0 = 8 (lnxded) */
    uint32_t setup_ptr;            /* stage 3: dice::bf::setup */
    uint32_t score_manager_ptr;    /* stage 3: dice::ref2::world::scoreManager */
    /* vtables (gcc vptr = symbol + 8); exact-match only, no subclasses */
    uint32_t vt_rot_bundle;
    uint32_t vt_engine;
    uint32_t vt_soldier;
    uint32_t vt_phys_engine;
    uint32_t vt_score_manager;

    /* --- the registered-objects map --- */
    uint32_t map_head_off;      /* om + : header/sentinel node */
    uint32_t map_count_off;     /* om + : node count */
    uint32_t node_leftmost_off; /* leftmost node, relative to the head */
    /* one node of the map */
    uint32_t node_parent_off;
    uint32_t node_left_off;
    uint32_t node_right_off;
    uint32_t node_key_off;      /* the pair's key (here the object's id) */
    uint32_t node_value_off;    /* the pair's value (here the IObject*) */
    uint32_t node_isnil_off;    /* MSVC nil byte; 0 = not used (SGI) */

    /* --- an object (BObject<IObject>) --- */
    uint32_t min_addr;          /* lowest plausible pointer (w32 0x10000) */
    uint32_t min_tmpl_addr;     /* lowest plausible template pointer */
    uint32_t obj_flags_off;     /* u32: ROOT 0x02000000, DISABLED 1 */
    uint32_t obj_id_off;        /* the manager id (gid) */
    uint32_t obj_tmpl_off;      /* ObjectTemplate* */
    uint32_t obj_mat_off;       /* Mat4 */
    uint32_t tmpl_id_off;       /* ObjectTemplate's id */

    /* --- stage 3 layouts (lnxded-verified; w32 values to re-derive) --- */
    uint32_t obj_parent_off;    /* getRootParent's parent pointer */
    uint32_t obj_compmap_off;   /* the component map (rb-tree) */
    uint32_t armor_iid;         /* Armor's component key */
    uint32_t armor_hp_off;      /* Armor: hit points (float) */
    uint32_t armor_maxhp_off;
    uint32_t armor_crit_off;    /* criticalDamage: under it the object burns */
    uint32_t armor_lasthit_off; /* id of the player who last hit it (i32) */
    uint32_t eng_pe_off;        /* Engine: PhysicsEngine* */
    uint32_t pe_revs_off;       /* PhysicsEngine: revs (float), the engine note */
    uint32_t pe_gear_off;       /* PhysicsEngine: gear (i32) */
    uint32_t eng_flags_off;     /* running byte; +1 = disabled byte. Server: +0x142 (Engine::handleMessage). w32ded same layout */
    uint32_t eng_throttle_off;  /* roll-axis throttle input, Engine+0x124 on both servers */
    uint32_t sol_lower_off;     /* BFSoldier animation machines */
    uint32_t sol_upper_off;
    uint32_t sol_item_off;      /* getActiveItemIndex: the held item */
    uint32_t sol_bits_off;      /* getStateBits (u16) */
    uint32_t pm_list_off;       /* playerManager: the list */
    uint32_t pl_node_player_off;/* a list node: the BFPlayer* */
    int pm_sentinel_indirect;   /* 1: *(pm+pm_list_off) is the sentinel node
                                 * pointer (MSVC); 0: pm+pm_list_off is the
                                 * embedded header node itself (SGI/lnxded) */
    uint32_t bf_id_off;         /* BFPlayer: the player id (u16), the events' pid */
    uint32_t bf_name_off;       /* a std::string; 0 = no plain field, see read_player_name */
    uint32_t bf_ai_off;         /* a byte, non-zero for a bot */
    uint32_t bf_team_off;
    uint32_t bf_veh_off;        /* controlled object */
    uint32_t bf_cam_off;        /* free camera */
    uint32_t kit_class_id;      /* BFSoldierTemplate's getClassID: the object is a soldier */
    uint32_t kit_getkit_slot;   /* BFSoldier's getKit vtable slot */
    uint32_t om_get_slot1;      /* objectManager lookup vslots */
    uint32_t om_get_slot2;
    /* The kit lookup by safe reads (no virtual call from the sampler
     * thread): the BFSoldierTemplate vptr, the soldier's kit id field
     * (getKitId's body) and the two id maps the objectManager lookups find
     * in. sol_kitid_off 0 = the target has not verified them; the lookup
     * falls back to the virtual calls above. */
    uint32_t vt_soldier_tmpl;
    uint32_t sol_kitid_off;
    uint32_t om_objmap1_off;
    uint32_t om_objmap2_off;
    uint32_t score_base_off;    /* ScoreManager: first TeamScore */
    uint32_t score_stride_off;  /* TeamScore stride */
    uint32_t score_tickets_off; /* the ticket count in a TeamScore */
    /* The round's points and its result (0 = not verified on this target,
     * the scoreTable record and gameStatus's winner and victory are left
     * out): the first of eight i32 points (death, kill, tk, capture,
     * attack, defence, objective, objectiveTk, in that order, 4 apart),
     * the winner byte and the victory type byte. */
    uint32_t sm_points_off;
    uint32_t sm_winner_off;
    uint32_t sm_victory_off;
    /* A player's board counters (i32 each; bf_score_off 0 = not verified,
     * no ps record): score, kills, deaths, ping, and the first of three
     * medal counters (gold, silver, bronze, 4 apart). */
    uint32_t bf_score_off;
    uint32_t bf_kills_off;
    uint32_t bf_deaths_off;
    uint32_t bf_ping_off;
    uint32_t bf_medals_off;
    uint32_t setup_level_off;   /* Setup: the current level's name (std::string) */
    uint32_t setup_gpm_off;     /* Setup: its game-play mode enum (write_level names the values) */
    uint32_t fa_fake_off;       /* FireArms: the fakeFire byte (setFakeFire) */
    uint32_t game_ptr_addr;     /* the global holding the Game object (0: not read on this target) */
    uint32_t game_input_index_off; /* Game: the current input index (getCurrentInputIndex) */
    /* functions the fire detour calls in the target */
    uint32_t get_bf_player_addr;   /* getBFPlayer(IPlayer*) */
    uint32_t get_root_parent_addr; /* getRootParent(ICompositeObject const*) */
    /* The hit and impact hooks (recorder_on_hit, recorder_on_impact_*; 0 =
     * not verified on this target, the `i` record is left out): a round's
     * fields as handleCollisionForProjectile reads them */
    uint32_t proj_owner_off;    /* Projectile: the firing player's id (fireBarrel stores IPlayer::getId) */
    uint32_t proj_origin_off;   /* Projectile: the fire origin Pos3 (fireBarrel's barrel position) */
    uint32_t proj_stat_off;     /* Projectile: the stat id (a template id) */
    uint32_t proj_pos_slot;     /* the round's vtable slot returning its absolute position (Vec3*) */

    /* --- the tick capture (REC_TICK; 0 = not verified on this target, the
     * record it feeds is left out) --- */
    uint32_t gs_simulate_slot;  /* GameServer vtable's simulateFrame slot (address) */
    uint32_t gs_simulate_fn;    /* what that slot must hold before it is patched */
    uint32_t gs_destroy_slot;   /* GameServer vtable's destroyObject(IObject*) slot (address) */
    uint32_t gs_destroy_fn;     /* what that slot must hold */
    uint32_t gs_chat_slot;      /* GameServer vtable's handleChatMessage(ChatMessage const&) slot (address) */
    uint32_t gs_chat_fn;        /* what that slot must hold */
    uint32_t cm_target_off;     /* ChatMessage: the SayTarget (i32), 0 = the sender's side only */
    uint32_t cm_text_off;       /* ChatMessage: the line's characters */
    uint32_t cm_len_off;        /* ChatMessage: its length (i32, 63 at most) */
    uint32_t cm_sender_off;     /* ChatMessage: the sender's player id (i32, -1 the server's own) */
    uint32_t sol_aim_pitch_off; /* BFSoldier: the aim pitch the client is sent */
    uint32_t sol_aim_twist_off; /* BFSoldier: the torso twist */
    uint32_t bf_ctrl_off;       /* BFPlayer::getVehicle: the control object (seat) */
    uint32_t bf_seat_off;       /* the seat setVehicle stores beside it */
    uint32_t bf_trig_off;       /* fire and altfire bytes */
    uint32_t anim_asm_ptr;      /* activeAnimationStateMachine (a pointer) */
    uint32_t asm_states_off;    /* its states vector (begin, end) */
    uint32_t asm_names_off;     /* its name -> index map */
    uint32_t state_flags_off;   /* an AnimationState's flags */
    uint32_t state_clips_off;   /* an AnimationState's clips (begin, end of 12-byte entries) */
    uint32_t state_rnd_off;     /* an AnimationState's random-transition names (vector<string>: begin, end) */
    uint32_t vt_control_point;  /* ControlPoint vptr */
    uint32_t cp_team_off;       /* ControlPoint: team */
    uint32_t cpt_name_off;      /* ControlPointTemplate: controlPointName */
    uint32_t cp_state_off;      /* ControlPoint: the capture law's state (0: no cpt records) */
    uint32_t cp_tmpl_off;       /* ControlPoint: its ControlPointTemplate */
    uint32_t cp_lose_off;       /* ControlPoint: the lose timer (float, seconds left) */
    uint32_t cp_get_off;        /* ControlPoint: the get timer (float, seconds left) */
    uint32_t cp_getting_off;    /* ControlPoint: the team the get timer runs for */
    uint32_t cpt_get_off;       /* ControlPointTemplate: timeToGetControl (float) */
    uint32_t cpt_lose_off;      /* ControlPointTemplate: timeToLoseControl (float) */
    uint32_t vt_projectile;     /* Projectile vptr */
    uint32_t vt_fire_arms;      /* FireArms vptr: a weapon, its projectile pool */
    uint32_t vt_hand_fire_arms; /* HandFireArms vptr, FireArms' one subclass */
    uint32_t fa_proj_tmpl_off;  /* FireArms: the projectile template */
    uint32_t fa_pool_off;       /* FireArms: the pool, a vector (begin, end) of IObject* */
    uint32_t fa_pool_count_off; /* FireArms: the count the pool was made with */
    uint32_t bm_iface_ptr;      /* IBotManager::instance */
    uint32_t vt_bot_manager;    /* BotManager vptr */
    uint32_t bm_iface_adj;      /* BotManager = instance - adj */
    uint32_t bm_pid_table_off;  /* player id -> bot index table */
    uint32_t bm_bots_off;       /* bots vector (begin, end) of Bot** */
    uint32_t bot_lod_off;       /* BotMain: LOD level */
    uint32_t bot_active_beh_idx_off; /* BotMain: pointer to the active behaviour index (0: no bai) */
    uint32_t bot_behaviours_off;     /* BotMain: the behaviours array */
    uint32_t bot_change_target_off;  /* BotMain: the change target handle */
    uint32_t information_manager_ptr; /* ai::informationManager */
    uint32_t om_register_slot;  /* ObjectManager vtable: registerObject's slot (address) */
    uint32_t om_register_fn;    /* what that slot must hold */
    uint32_t om_unregister_slot;
    uint32_t om_unregister_fn;
    /* The flag carrier (sweep entry 15; 0 = not verified, the queue's
     * FlagHolder copies are written as they come): BFPlayer's carries-a-flag
     * byte. */
    uint32_t bf_flag_off;
    /* The held weapon's magazines (sweep entry 11; fa_mags_off 0 = not
     * verified, no am record): the soldier's item ids and weapons (vectors,
     * begin and end), a FireArms' magazine vector and its link to the
     * FireArms whose magazines it uses, and its template's link index and
     * numOfMag. An item id names a weapon by its obj_id_off. */
    uint32_t sol_items_off;
    uint32_t sol_weapons_off;
    uint32_t fa_mags_off;
    uint32_t fa_link_off;
    uint32_t fat_link_off;
    uint32_t fat_mags_off;

    /* --- behavior switches --- */
    int walk_clamp_count;   /* clamp the walk bound's count at 100000 (w32) */
    int sample_reset_next;  /* next_sample = t + 1/hz rather than += 1/hz */

    /* --- platform shims --- */
    int (*safe_read)(void *dst, size_t len, uintptr_t addr);
    int (*patch_write)(uintptr_t addr, const void *src, size_t len); /* stage 3 */
    double (*now_s)(void);
    uint32_t (*net_id_of)(uintptr_t obj);   /* 0 when the target has none */
    void (*read_string)(uintptr_t str_obj, char *out, size_t cap);
    /* A BFPlayer's name/ai: lnxded reads plain fields (bf_name_off /
     * bf_ai_off); w32ded has no plain fields there, the target calls
     * BFPlayer's virtuals instead. NULL = read the fields. */
    void (*read_player_name)(uintptr_t player, char *out, size_t cap);
    int (*read_player_ai)(uintptr_t player);
    /* veto a raw vtable-slot function pointer before an indirect virtual
     * call from the sampler (w32ded: no SEH on i386). NULL = allow all. */
    int (*vt_call_ok)(uint32_t fn);
    void (*read_template_name)(uintptr_t tmpl, char *out, size_t cap);
    uint32_t (*tree_successor)(uint32_t node, uint32_t head);
    void (*make_replays_dir)(void);
    /* Not re-entrant on lnxded (a default pthread mutex): nothing called
     * with it held may take it again. */
    void (*rec_lock)(void);
    void (*rec_unlock)(void);
    void (*rec_sleep)(void);                /* one 30 Hz tick */
    /* The write lock if it is free: 1 when taken. NULL = rec_lock always
     * (shutdown then waits for it; w32ded's process exit cannot). */
    int (*rec_trylock)(void);
    /* fn(arg) inside a fault guard: 1 when it returned, 0 when a fault cut
     * it short (the guard has released any write lock fn held). NULL = no
     * guard; tick mode's sample has its own (recorder_core_tick). */
    int (*run_guarded)(void (*fn)(void *), void *arg);
    int (*install_detours)(void);           /* stage 3; stub = return 0 */
    int (*start_sampler_thread)(void *(*fn)(void *));
};

extern const struct rec_target *T;

/* Entry: read config, allocate, install detours, start the sampler.
 * Called by the target's own entry point (ELF constructor / DllMain). */
void recorder_core_init(const struct rec_target *target);

/* Detach: close the recording if one is open (w32ded's DllMain). */
void recorder_core_shutdown(void);

#if REC_TICK
/* One simulated tick, on the game thread (the GameServer::simulateFrame
 * hook calls it; the harness calls it directly). */
void recorder_core_tick(void);
#endif

/* A sample or hook its target's guard cut short: counted a file, and
 * recording stops at too many (core.c MAX_FAULTS). Call outside the guard. */
void recorder_core_fault(const char *where);

/* 1 while recording is on (recorder.con, and not stopped for faults). */
int recorder_core_on(void);

/* Core helpers a target may need. */
uint32_t read_u32(uintptr_t addr);
extern int g_debug;   /* RECORDER_DEBUG in the environment */
extern int g_rec_hits, g_rec_impacts; /* recorder.con recordHits / recordImpacts */
extern volatile int g_hook_active; /* stage 3: set by the detour installer */

#endif /* RECORDER_CORE_H */
