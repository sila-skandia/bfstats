/*
 * The lnxded target layer (bf1942_lnxded, the lab's non-PIE ET_EXEC).
 *
 * Platform specifics: /proc/self/mem preads for both safe reads and .text
 * patching (32-bit off_t sign-extends 0xf7xxxxxx heap addresses -- the
 * offsets are 64-bit: _FILE_OFFSET_BITS 64), SGI-STL string/map layouts,
 * an ELF-constructor entry and a pthread sampler, and stage 3's RWX
 * trampoline detours patched through /proc/self/mem. Offsets in core.h's
 * table; derivation in README.md.
 */

#define _FILE_OFFSET_BITS 64

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>

#include "core.h"

/* --- safe reads --------------------------------------------------------- */

/* A torn read or a pointer racing a destroy must not kill the server.
 * Read through the kernel's copy of our own address space. Offsets are
 * 64-bit even in this 32-bit process: heap addresses top out in 0xf7xxxxxx,
 * which a 32-bit off_t sign-extends and fails on. */
static int mem_fd = -1;
static int mem_fd_write = -1;

static int lnxded_safe_read(void *dst, size_t len, uintptr_t addr)
{
    if (mem_fd < 0) mem_fd = open("/proc/self/mem", O_RDONLY);
    if (mem_fd < 0) return 0;
    return pread(mem_fd, dst, len, (off_t)addr) == (ssize_t)len;
}

/* The detour installer: .text is mapped read-only, /proc/self/mem writes
 * through the page protection (the standard self-patching route). */
static int lnxded_patch_write(uintptr_t addr, const void *src, size_t len)
{
    if (mem_fd_write < 0) mem_fd_write = open("/proc/self/mem", O_WRONLY);
    if (mem_fd_write < 0) return 0;
    return pwrite(mem_fd_write, src, len, (off_t)addr) == (ssize_t)len;
}

/* --- std::string / names ------------------------------------------------- */

/* A std::string in this libstdc++ (SGI) is one pointer to the chars. */
static void lnxded_read_string(uintptr_t str_obj, char *out, size_t cap)
{
    out[0] = 0;
    if (str_obj < 0x1000) return;
    uint32_t sp = read_u32(str_obj);
    if (sp < 0x1000) return;
    char buf[128];
    if (!lnxded_safe_read(buf, sizeof(buf), sp)) return;
    buf[sizeof(buf) - 1] = 0;
    size_t n = strnlen(buf, sizeof(buf) - 1);
    if (n >= cap) n = cap - 1;
    memcpy(out, buf, n);
    out[n] = 0;
}

/* The template's name: ObjectTemplate::getName 0x081d4c60 returns the
 * std::string at tmpl+8 (same pointer shape). */
static void lnxded_read_template_name(uintptr_t tmpl, char *out, size_t cap)
{
    lnxded_read_string(tmpl + 8, out, cap);
}

/* The networkable's u16 id: IObject+0x68 -> NetworkableBase, word at +4
 * (the shape GameEventManager::createPlayer 0x0812d080 reads to fill an
 * event's netId fields; verified live on a soldier). The getNetworkable
 * virtual is NOT the way on the server: the IObject slots past +0xb4 are
 * pure-virtual in BObject<IObject>'s vtable. */
static uint32_t lnxded_net_id_of(uintptr_t obj)
{
    uint32_t net = read_u32(obj + 0x68);
    if (net < 0x1000) return 0;
    return read_u32(net + 4) & 0xffff;
}

static double lnxded_now_s(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

/* --- an SGI-STL rb-tree walk ---------------------------------------------- */

/* This libstdc++'s map: header-node pointer; a node: color 0, parent +4,
 * left +8, right +0xc, pair key +0x10, value +0x14 (the shape the
 * registered-objects map at om+0x94 and ObjectTemplateManager's at mgr+8
 * share). Walk from the leftmost (header.left), in-order successor: right
 * subtree's leftmost, else climb to the ancestor whose left child this is. */
static uint32_t lnxded_tree_successor(uint32_t node, uint32_t header)
{
    uint32_t right = read_u32(node + 0xc);
    if (right != header && right) {
        node = right;
        /* Bounded: a node the game thread frees mid-walk can point anywhere,
         * and an unbounded descent or climb then spins the sampler for good
         * (a client's disconnect, 2026-10-04). A tree this size is < 64 deep. */
        for (int d = 0; d < 64; d++) {
            uint32_t left = read_u32(node + 8);
            if (!left || left == header) break;
            node = left;
        }
        return node;
    }
    uint32_t parent = read_u32(node + 4);
    for (int d = 0; d < 64 && parent && parent != header; d++) {
        if (read_u32(parent + 8) == node) return parent;
        node = parent;
        parent = read_u32(node + 4);
    }
    return header;
}

/* --- threads --------------------------------------------------------------- */

static pthread_mutex_t g_write_lock = PTHREAD_MUTEX_INITIALIZER;

static void lnxded_lock(void)   { pthread_mutex_lock(&g_write_lock); }
static void lnxded_unlock(void) { pthread_mutex_unlock(&g_write_lock); }

static void lnxded_sleep(void)
{
    const struct timespec tick = { 0, (long)(1e9 / 30.0) };
    nanosleep(&tick, 0);
}

static void lnxded_make_replays_dir(void)
{
    (void)mkdir("replays", 0755);   /* EEXIST is fine */
}

static int lnxded_start_sampler_thread(void *(*fn)(void *))
{
    pthread_t th;
    if (pthread_create(&th, 0, fn, 0) != 0) return 0;
    pthread_detach(th);
    return 1;
}

/* --- detour stubs and installation --------------------------------------------- */

extern volatile int g_hook_active;   /* core: addEventToSendQueue patched */
extern int g_debug;

/* The detour sites and the functions the fire hook calls. */
#define ADD_EVENT_SEND_QUEUE 0x0812d730u  /* GameEventManager::addEventToSendQueue */
#define SEND_EVENT_TO_ALL    0x08153b10u  /* GameServer::sendGameEventToAll(const&, bool) */
#define FIRE_BARREL          0x0828aba0u  /* FireArms::fireBarrel(IPlayer*, Mat4&, int) */
#define FIRE_POST_FAKE_TEST  0x0828a230u  /* inside FireArms::Fire, past the fakeFire test */

/* The stubs live in this .so's .text; the copied prologue bytes need
 * executable memory: one RWX page, trampolines written at install. */
static uint8_t *g_tramp_page;
static size_t g_tramp_used;

/* addEventToSendQueue's prologue, copied (objdump 0x0812d730):
 *   55              push %ebp
 *   31 c0           xor  %eax,%eax
 *   89 e5           mov  %esp,%ebp
 *   81 ec 48 01 00 00  sub $0x148,%esp
 * (11 bytes; next instruction at 0x0812d73b). */
static const uint8_t AETSQ_ORIG[] = { 0x55, 0x31, 0xc0, 0x89, 0xe5, 0x81, 0xec, 0x48, 0x01, 0x00, 0x00 };
#define AETSQ_LEN 11
#define AETSQ_BACK (ADD_EVENT_SEND_QUEUE + AETSQ_LEN)

/* fireBarrel's prologue (objdump 0x0828aba0), the same shape as
 * sendGameEventToAll's:
 *   55              push %ebp
 *   89 e5           mov  %esp,%ebp
 *   57              push %edi
 *   56              push %esi
 *   53              push %ebx
 * (6 bytes; next instruction at +6). */
static const uint8_t FIRE_ORIG[] = { 0x55, 0x89, 0xe5, 0x57, 0x56, 0x53 };
#define FIRE_LEN 6
#define FIRE_BACK (FIRE_BARREL + FIRE_LEN)

static const uint8_t TOALL_ORIG[] = { 0x55, 0x89, 0xe5, 0x57, 0x56, 0x53 };
#define TOALL_LEN 6
#define TOALL_BACK (SEND_EVENT_TO_ALL + TOALL_LEN)

/* FireArms::Fire 0x0828a090 at 0x0828a230 (objdump), mid-function: the
 * fakeFire test's fall-through (`cmpb $0,0x295(this)`; `je` to the barrel
 * dispatch at 0x0828a217..22a) and the target of all five dispatch exits
 * (0x0828a625, 6ca, 709, 792, 7d3), so every round passes once; no branch
 * lands in 0x0828a231..235.
 *   83 ec 0c        sub  $0xc,%esp
 *   8b 75 08        mov  0x8(%ebp),%esi
 * (6 bytes, nothing relative; the call at 0x0828a237 is not copied.) Fire's
 * ebp frame is built: this at ebp+8, the IPlayer* (NULL from handleUpdate's
 * auto-fire site) at ebp+0xc, the launch Mat4 copied to ebp-0x58. */
static const uint8_t FAKE_ORIG[] = { 0x83, 0xec, 0x0c, 0x8b, 0x75, 0x08 };
#define FAKE_LEN 6
#define FAKE_BACK (FIRE_POST_FAKE_TEST + FAKE_LEN)

__asm__(
".text\n"
".globl recorder_stub_event\n"
"recorder_stub_event:\n"          /* jmp'd here from 0x0812d730 */
"  pusha\n"                        /* 32 bytes + pushfl 4: entry [esp] at 36 */
"  pushfl\n"
"  movl  44(%esp), %eax\n"        /* the event ([esp+8] at entry; this at +4) */
"  pushl %eax\n"
"  call  recorder_on_queue_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *recorder_tramp_event\n"
".globl recorder_stub_fire\n"
"recorder_stub_fire:\n"           /* jmp'd here from 0x0828aba0 */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"        /* this    ([esp+4] at entry: gcc passes it on the stack) */
"  movl  44(%esp), %edx\n"        /* player  */
"  movl  48(%esp), %ecx\n"        /* Mat4*   */
"  pushl %ecx\n"
"  pushl %edx\n"
"  pushl %eax\n"
"  call  recorder_on_fire\n"
"  addl  $12, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *recorder_tramp_fire\n"
".globl recorder_stub_toall\n"
"recorder_stub_toall:\n"          /* jmp'd here from 0x08153b10 */
"  pusha\n"
"  pushfl\n"
"  movl  44(%esp), %eax\n"        /* the event ([esp+8] at entry; this at +4) */
"  pushl %eax\n"
"  call  recorder_on_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *recorder_tramp_toall\n"
".globl recorder_stub_fakefire\n"
"recorder_stub_fakefire:\n"       /* jmp'd here from 0x0828a230, inside Fire's frame */
"  pusha\n"
"  pushfl\n"
"  leal  -0x58(%ebp), %ecx\n"     /* the launch Mat4 */
"  movl  12(%ebp), %edx\n"        /* IPlayer* */
"  movl  8(%ebp), %eax\n"         /* this */
"  pushl %ecx\n"
"  pushl %edx\n"
"  pushl %eax\n"
"  call  recorder_on_fake_fire\n"
"  addl  $12, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *recorder_tramp_fakefire\n"
".data\n"
".globl recorder_tramp_event\n"
".align 4\n"
"recorder_tramp_event: .long 0\n"
".globl recorder_tramp_fire\n"
".align 4\n"
"recorder_tramp_fire: .long 0\n"
".globl recorder_tramp_toall\n"
".align 4\n"
"recorder_tramp_toall: .long 0\n"
".globl recorder_tramp_fakefire\n"
".align 4\n"
"recorder_tramp_fakefire: .long 0\n"
);

extern char recorder_stub_event;
extern char recorder_stub_fire;
extern char recorder_stub_toall;
extern char recorder_stub_fakefire;
extern uint32_t recorder_tramp_event;
extern uint32_t recorder_tramp_fire;
extern uint32_t recorder_tramp_toall;
extern uint32_t recorder_tramp_fakefire;

/* A trampoline in the RWX page: the copied bytes, then a jmp back. */
static int build_trampoline(const void *orig_bytes, size_t len, uintptr_t back_to,
                            uintptr_t *out)
{
    if (!g_tramp_page) {
        g_tramp_page = mmap(0, 4096, PROT_READ | PROT_WRITE | PROT_EXEC,
                            MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (g_tramp_page == MAP_FAILED) { g_tramp_page = 0; return 0; }
    }
    uintptr_t at = (uintptr_t)g_tramp_page + g_tramp_used;
    if (g_tramp_used + len + 5 > 4096) return 0;
    memcpy((void *)at, orig_bytes, len);
    uint8_t jmp[5];
    jmp[0] = 0xe9;
    int32_t rel = (int32_t)(back_to - (at + len + 5));
    memcpy(jmp + 1, &rel, 4);
    memcpy((void *)(at + len), jmp, 5);
    g_tramp_used += len + 5;
    *out = at;
    return 1;
}

/* `tramp_global` is the pointer the stub jumps through: it is live before
 * the site is patched (the constructor runs before any game thread, but a
 * stub jumping through a null pointer is the w32 port's first crash). */
static int install_detour(uintptr_t site, const uint8_t *expected, size_t len,
                          void *stub, const uint8_t *orig_bytes, uintptr_t back_to,
                          uint32_t *tramp_global)
{
    uint8_t have[16];
    if (!lnxded_safe_read(have, len, site) || memcmp(have, expected, len) != 0) {
        fprintf(stderr, "recorder: %08lx is not the expected code, detour skipped\n",
                (unsigned long)site);
        return 0;
    }
    uintptr_t tramp = 0;
    if (!build_trampoline(orig_bytes, len, back_to, &tramp)) return 0;
    *tramp_global = (uint32_t)tramp;
    uint8_t jmp[5];
    jmp[0] = 0xe9;
    int32_t rel = (int32_t)((uintptr_t)stub - (site + 5));
    memcpy(jmp + 1, &rel, 4);
    if (!lnxded_patch_write(site, jmp, 5)) {
        fprintf(stderr, "recorder: patch at %08lx failed\n", (unsigned long)site);
        return 0;
    }
    {
        uint8_t back[5] = {};
        lnxded_safe_read(back, 5, site);
        fprintf(stderr, "recorder: %08lx now %02x %02x %02x %02x %02x (stub %p)\n",
                (unsigned long)site, back[0], back[1], back[2], back[3], back[4], stub);
    }
    return 1;
}

static int lnxded_install_detours(void)
{
    if (install_detour(ADD_EVENT_SEND_QUEUE, AETSQ_ORIG, AETSQ_LEN,
                       &recorder_stub_event, AETSQ_ORIG, AETSQ_BACK, &recorder_tramp_event)) {
        g_hook_active = 1;
        fprintf(stderr, "recorder: event queue hooked at %08x\n", (unsigned)ADD_EVENT_SEND_QUEUE);
    }
    if (install_detour(SEND_EVENT_TO_ALL, TOALL_ORIG, TOALL_LEN,
                       &recorder_stub_toall, TOALL_ORIG, TOALL_BACK, &recorder_tramp_toall))
        fprintf(stderr, "recorder: sendGameEventToAll hooked at %08x\n", (unsigned)SEND_EVENT_TO_ALL);
    if (install_detour(FIRE_BARREL, FIRE_ORIG, FIRE_LEN,
                       &recorder_stub_fire, FIRE_ORIG, FIRE_BACK, &recorder_tramp_fire))
        fprintf(stderr, "recorder: fireBarrel hooked at %08x\n", (unsigned)FIRE_BARREL);
    if (install_detour(FIRE_POST_FAKE_TEST, FAKE_ORIG, FAKE_LEN,
                       &recorder_stub_fakefire, FAKE_ORIG, FAKE_BACK, &recorder_tramp_fakefire))
        fprintf(stderr, "recorder: Fire's fake rounds hooked at %08x\n", (unsigned)FIRE_POST_FAKE_TEST);
    return 1;
}

/* --- the target table ------------------------------------------------------ */

extern void recorder_on_event(uint32_t ev);
extern void recorder_on_queue_event(uint32_t ev);
extern void recorder_on_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr);
extern void recorder_on_fake_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr);

const struct rec_target lnxded_target = {
    .name = "lnxded",
    .header_plus = "server-replay-recorder/2",
    .header_version = 5,

    .object_manager_ptr = 0x0871dc24u,  /* dice::ref2::world::objectManager */
    .player_manager_ptr = 0x0871dc2cu,  /* dice::ref2::world::playerManager */
    .template_manager_ptr = 0x0871dc28u,
    .setup_ptr = 0x08716b64u,           /* dice::bf::setup (score manager at +0x410) */
    .score_manager_ptr = 0x0871bb58u,

    /* vtable symbols; a gcc vptr holds symbol + 8 (first virtual entry). */
    .vt_rot_bundle = 0x08724e08u,       /* RotationalBundle: turret, propeller, gun mount */
    .vt_engine = 0x0872bc68u,           /* Engine (extends RotationalBundle) */
    .vt_soldier = 0x0872f048u,          /* BFSoldier */
    .vt_phys_engine = 0x0872d608u,      /* PhysicsEngine */
    .vt_score_manager = 0x0871c008u,    /* ScoreManager */

    /* The registered-objects map (ObjectManager::registerObject 0x0819b4a0)
     * is an old SGI-STL _Rb_tree at om+0x94: header-node pointer at om+0x94,
     * node count at om+0x98. A node: parent +4, left +8, right +0xc; value
     * pair key +0x10, IObject* +0x14. */
    .map_head_off = 0x94u,
    .map_count_off = 0x98u,
    .node_leftmost_off = 8u,            /* header.left */
    .node_parent_off = 4u,
    .node_left_off = 8u,
    .node_right_off = 0xcu,
    .node_key_off = 0x10u,
    .node_value_off = 0x14u,
    .node_isnil_off = 0u,               /* SGI: no nil byte, header compares */

    .min_addr = 0x1000u,
    .min_tmpl_addr = 0x1000u,
    .obj_flags_off = 0x04u,
    .obj_id_off = 0x48u,                /* registered-map key (= gid) */
    .obj_tmpl_off = 0x4cu,
    .obj_mat_off = 0x74u,               /* Mat4: rows a,b,c then position */
    .tmpl_id_off = 0x10u,

    /* stage 3 */
    .obj_parent_off = 0x50u,            /* getRootParent 0x0818d4b0 */
    .obj_compmap_off = 0xb8u,           /* the component map (rb-tree) */
    .armor_iid = 0xc4a4u,
    .armor_hp_off = 0x38u,
    .armor_maxhp_off = 0x3cu,
    .armor_crit_off = 0xf0u,
    .armor_lasthit_off = 0x14u,
    .eng_pe_off = 0x60u,                /* Engine: PhysicsEngine* (Engine::init 0x0823e110) */
    .pe_revs_off = 0xa0u,               /* PhysicsEngine::updatePhysics 0x0824cbb0 */
    .pe_gear_off = 0xbcu,               /* PhysicsEngine ctor sets 1 */
    .eng_flags_off = 0x142u,            /* running byte +0x142, disabled +0x143 (Engine::handleMessage 0x0823e730; live-verified) */
    .eng_throttle_off = 0x124u,         /* roll-axis input, Engine::handlePlayerInput 0x0823e5e0 (verified) */
    .sol_lower_off = 0x2b4u,            /* getAnimationState 0x0826d060 */
    .sol_upper_off = 0x2f8u,
    .sol_item_off = 0x3b8u,             /* getActiveItemIndex 0x0827f920 */
    .sol_bits_off = 0x3e6u,             /* getStateBits 0x0827e1c0 */
    .pm_list_off = 0xcu,                /* GameServer::updateGameLogic 0x081505c0 */
    .pl_node_player_off = 8u,
    .bf_id_off = 0x58u,                 /* getId 0x080560e0; +0xc is the player's
                                         * network id, createPlayer's next field */
    .bf_name_off = 0x44u,               /* getName 0x08056070 */
    .bf_ai_off = 0x78u,                 /* getIsAIPlayer 0x08056120 */
    .bf_team_off = 0x7cu,               /* setTeam 0x080556b0 */
    .bf_veh_off = 0x68u,                /* createPlayer 0x0812d080's event fields */
    .bf_cam_off = 0x74u,
    .kit_class_id = 0x9493u,            /* a Kit template's getClassID (vptr+0xc) */
    .kit_getkit_slot = 0x17cu,          /* BFSoldier's getKit vtable slot */
    .om_get_slot1 = 0x20u,              /* objectManager lookup vslots */
    .om_get_slot2 = 0x24u,
    .vt_soldier_tmpl = 0x0872eec8u,     /* BFSoldierTemplate (symbol 0x0872eec0 + 8): the only vtable whose getClassID (0x0827fc80) answers kit_class_id */
    .sol_kitid_off = 0x408u,            /* BFSoldier::getKitId 0x0827f910 = the vslot 0x17c call: mov 0x408(%eax),%eax */
    .om_objmap1_off = 0x48u,            /* ObjectManager::getObjectFromGrid 0x0819d310 (vslot 0x20): map<uint, IObject*> find at om+0x48 */
    .om_objmap2_off = 0x60u,            /* getObjectFromNoCollisionGrid 0x0819d350 (vslot 0x24): the same at om+0x60 */
    .score_base_off = 0x10u,            /* getTeamScore 0x081616c0 */
    .score_stride_off = 0x50u,
    .score_tickets_off = 0x48u,         /* TeamScore::setTickets 0x081610a0 */
    .setup_level_off = 0x23cu,          /* Setup::getCurrentLevel 0x080bfeb0 */
    .setup_gpm_off = 0x240u,
    .fa_fake_off = 0x295u,              /* FireArms::setFakeFire 0x0828e310 writes it; Fire tests it at 0x0828a217 */
    .get_bf_player_addr = 0x08052ac0u,  /* getBFPlayer(IPlayer*) */
    .get_root_parent_addr = 0x0818d4b0u,

    /* the tick capture (README "The new recorder"; ledger P-3, P-4, AI-136) */
    .gs_simulate_slot = 0x0871b228u,    /* vtable for GameServer 0x0871b0e0 + 8 + 0x140, in .data */
    .gs_simulate_fn = 0x0815c2a0u,      /* GameServer::simulateFrame(float) */
    /* Every DestroyObjectEvent (0x06) a client is sent is built in it, one
     * per connection; it has no direct caller (ledger J-6). */
    .gs_destroy_slot = 0x0871b13cu,     /* vtable for GameServer 0x0871b0e0 + 8 + 0x54, in .data */
    .gs_destroy_fn = 0x08131a20u,       /* GameServer::destroyObject(IObject*) */
    .sol_aim_pitch_off = 0x284u,        /* BFSoldierNetworkable::updateStateMask 0x082224e0 -> record +0x68 */
    .sol_aim_twist_off = 0x288u,        /* -> record +0x6c */
    .bf_ctrl_off = 0x4cu,               /* BFPlayer::getVehicle 0x080560c0 */
    .bf_seat_off = 0x54u,               /* BFPlayer::setVehicle 0x08052310 stores its int here */
    .bf_trig_off = 0x148u,              /* GameServer::checkPlayerTriggers 0x0814f2c0: +0x148 fire, +0x149 altfire */
    .anim_asm_ptr = 0x0873fc9cu,        /* dice::anim::activeAnimationStateMachine */
    .asm_states_off = 0x10u,            /* AnimationStateMachine::getState 0x083285b0 */
    .asm_names_off = 0x41cu,            /* AnimationStateMachine::findState 0x08328610 */
    .state_flags_off = 0x24u,           /* AnimationStateMachineInstance::getCurrentStateFlags 0x0832b110 */
    .vt_control_point = 0x0872f948u,    /* vtable for ControlPoint 0x0872f940 + 8 */
    .cp_team_off = 0x174u,              /* ControlPoint::setTeam 0x08284490 */
    .cpt_name_off = 0x1e4u,             /* controlPointName's setter 0x08309c90 */
    .vt_projectile = 0x0873f2c8u,       /* vtable for Projectile 0x0873f2c0 + 8 */
    /* A weapon's projectile pool, what CreateMultipleObjectsEvent (0x05)
     * announces: FireArms::initProjectilePool 0x08287a80, run by both
     * FireArms ctors, keeps GameServer::spawnMultipleObjects' objects in the
     * vector at +0x1d8 and its count at +0x1e4 (getNumProjectiles
     * 0x08288030); the template is +0x194. */
    .vt_fire_arms = 0x08730da8u,        /* vtable for FireArms 0x08730da0 + 8 */
    .vt_hand_fire_arms = 0x087318c8u,   /* vtable for HandFireArms 0x087318c0 + 8 */
    .fa_proj_tmpl_off = 0x194u,
    .fa_pool_off = 0x1d8u,
    .fa_pool_count_off = 0x1e4u,
    .bm_iface_ptr = 0x0874ffe8u,        /* IBotManager::instance */
    .vt_bot_manager = 0x0874f768u,      /* vtable for BotManager 0x0874f760 + 8 */
    .bm_iface_adj = 4u,                 /* the IBotManager thunks adjust this by -4 (0x0849cc40) */
    .bm_pid_table_off = 0x38u,          /* BotManager::getBotFromPlayerId 0x0849c460 */
    .bm_bots_off = 0x20u,               /* BotManager::getBotFromId 0x08498f80 */
    .bot_lod_off = 0x10u,               /* BotMain::getLodLevel 0x0852c7f0 */
    .om_register_slot = 0x087204e0u,    /* vtable for ObjectManager 0x08720400 + 8 + 0xd8, in .data */
    .om_register_fn = 0x0819b4a0u,      /* ObjectManager::registerObject */
    .om_unregister_slot = 0x087204e4u,  /* + 0xdc */
    .om_unregister_fn = 0x0819b530u,    /* ObjectManager::unregisterObject (erases by obj+0x48) */

    .walk_clamp_count = 0,
    .sample_reset_next = 0,
    .flush_each_line = 0,               /* tick mode: the writer thread flushes */

    .safe_read = lnxded_safe_read,
    .patch_write = lnxded_patch_write,
    .now_s = lnxded_now_s,
    .net_id_of = lnxded_net_id_of,
    .read_string = lnxded_read_string,
    .read_template_name = lnxded_read_template_name,
    .tree_successor = lnxded_tree_successor,
    .make_replays_dir = lnxded_make_replays_dir,
    .rec_lock = lnxded_lock,
    .rec_unlock = lnxded_unlock,
    .rec_sleep = lnxded_sleep,
    .install_detours = lnxded_install_detours,
    .start_sampler_thread = lnxded_start_sampler_thread,
};

/* --- entry --------------------------------------------------------------- */

__attribute__((constructor))
static void recorder_init(void)
{
    recorder_core_init(&lnxded_target);
}

/* A normal exit closes the file with its end record. SIGINT, which lab.py
 * stop sends, ends the server without running exit handlers. */
__attribute__((destructor))
static void recorder_fini(void)
{
    recorder_core_shutdown();
}
