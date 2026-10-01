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
 *                         winmm IAT reroute; detour layer STUBBED (no-op)
 *                         until its sites are cross-matched (REC_STAGE3=0)
 *
 * The core is written against the target contract: every address, struct
 * offset and platform call goes through the `struct rec_target` table.
 * Stage-3 code paths are compiled out of the w32ded target with
 * -DREC_STAGE3=0 (the port has not landed; do not copy stage 3 by hand --
 * it lives here already).
 */

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#ifndef RECORDER_CORE_H
#define RECORDER_CORE_H

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

    /* --- globals (addresses in the target binary) --- */
    uint32_t object_manager_ptr;   /* dice::ref2::world::objectManager */
    uint32_t player_manager_ptr;   /* stage 3: dice::ref2::world::playerManager */
    uint32_t template_manager_ptr; /* stage 3: dice::ref2::world::objectTemplateManager */
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
    uint32_t node_key_off;
    uint32_t node_value_off;
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
    uint32_t armor_hp_off;
    uint32_t armor_maxhp_off;
    uint32_t armor_crit_off;
    uint32_t armor_lasthit_off;
    uint32_t eng_pe_off;        /* Engine: PhysicsEngine* */
    uint32_t pe_revs_off;
    uint32_t pe_gear_off;
    uint32_t eng_flags_off;     /* running byte; +1 = disabled byte. Server: +0x142 (Engine::handleMessage). w32ded same layout */
    uint32_t eng_throttle_off;  /* roll-axis throttle input, Engine+0x124 on both servers */
    uint32_t sol_lower_off;     /* BFSoldier animation machines */
    uint32_t sol_upper_off;
    uint32_t sol_item_off;
    uint32_t sol_bits_off;
    uint32_t pm_list_off;       /* playerManager: the list */
    uint32_t pl_node_player_off;/* a list node: the BFPlayer* */
    uint32_t bf_id_off;
    uint32_t bf_name_off;
    uint32_t bf_ai_off;
    uint32_t bf_team_off;
    uint32_t bf_veh_off;        /* controlled object */
    uint32_t bf_cam_off;        /* free camera */
    uint32_t kit_class_id;      /* a Kit template's getClassID */
    uint32_t kit_getkit_slot;   /* BFSoldier's getKit vtable slot */
    uint32_t om_get_slot1;      /* objectManager lookup vslots */
    uint32_t om_get_slot2;
    uint32_t score_base_off;    /* ScoreManager: first TeamScore */
    uint32_t score_stride_off;  /* TeamScore stride */
    uint32_t score_tickets_off; /* the ticket count in a TeamScore */
    uint32_t setup_level_off;
    uint32_t setup_gpm_off;
    /* functions the fire detour calls in the target */
    uint32_t get_bf_player_addr;   /* getBFPlayer(IPlayer*) */
    uint32_t get_root_parent_addr; /* getRootParent(ICompositeObject const*) */

    /* --- behavior switches --- */
    int walk_clamp_count;   /* clamp the walk bound's count at 100000 (w32) */
    int sample_reset_next;  /* next_sample = t + 1/hz rather than += 1/hz */
    int flush_each_line;    /* fflush under the write lock per line
                             * (lnxded: the detour threads also write) */

    /* --- platform shims --- */
    int (*safe_read)(void *dst, size_t len, uintptr_t addr);
    int (*patch_write)(uintptr_t addr, const void *src, size_t len); /* stage 3 */
    double (*now_s)(void);
    uint32_t (*net_id_of)(uintptr_t obj);   /* 0 when the target has none */
    void (*read_string)(uintptr_t str_obj, char *out, size_t cap);
    void (*read_template_name)(uintptr_t tmpl, char *out, size_t cap);
    uint32_t (*tree_successor)(uint32_t node, uint32_t head);
    void (*make_replays_dir)(void);
    void (*rec_lock)(void);
    void (*rec_unlock)(void);
    void (*rec_sleep)(void);                /* one 30 Hz tick */
    int (*install_detours)(void);           /* stage 3; stub = return 0 */
    int (*start_sampler_thread)(void *(*fn)(void *));
};

extern const struct rec_target *T;

/* Entry: read config, allocate, install detours, start the sampler.
 * Called by the target's own entry point (ELF constructor / DllMain). */
void recorder_core_init(const struct rec_target *target);

/* Detach: close the recording if one is open (w32ded's DllMain). */
void recorder_core_shutdown(void);

/* Core helpers a target may need. */
uint32_t read_u32(uintptr_t addr);
extern int g_debug;   /* RECORDER_DEBUG in the environment */
extern volatile int g_hook_active; /* stage 3: set by the detour installer */

#endif /* RECORDER_CORE_H */
