/*
 * The shared core driven through a fake target, no server needed: the
 * event paths the lab cannot reach without a client connected. run.sh builds
 * it, runs it in a scratch directory and checks the files it wrote.
 *
 *   1. events before a level is loaded are held, then written at t 0
 *   2. a client's join (ServerInfo 0x1a, then its database) neither splits
 *      the file nor hangs the game thread (the sampler used to re-take its
 *      own lock in held_flush, and the game thread's next write hung); a
 *      name's high bytes are written \u00XX, the file stays UTF-8
 *   3. a to-all event fanned out to three clients is written once, though
 *      each copy has different bytes past its payload
 *   4. the world unloading closes the file with its end record; the next
 *      opens when the next level loads, under a name of its own
 *
 *   5. (tick mode) a read that faults ends that sample, not the process
 *   6. ENDMAP (gameStatus 5) is on disk as soon as it is written
 *   7. projectile pools (projPool): the hook's CreateMultipleObjects event,
 *      fanned out to three clients, is written once; weapons in the world (a
 *      disabled HandFireArms, a FireArms) have their pools written by the
 *      sample once a file; a pool the hook announced is not written again;
 *      a new weapon whose pool reuses a destroyed one's ids is
 *   8. chat with no hook on the server's chat handler: a line's pieces
 *      (ChatFragmentEvent, 0x28), copied to three clients with different bytes
 *      past each piece, are one chat record; a line that stops half way is
 *      dropped when its sender starts another or leaves; the lines in
 *      progress are bounded
 *   9. a kit or a controlled object named again after a destroyObject on its
 *      net id, or after its player left, is written again
 *
 * run.sh builds it twice: the sampler thread (REC_TICK=0) and the tick
 * capture (REC_TICK=1), and holds both to the same files. `harness live`
 * (tick mode) runs the live set instead of the map walk: a weapon is looked
 * at while it is new, then set aside as scenery, and its pool is written
 * again when the next file opens. It also destroys objects through
 * GameServer::destroyObject's slot: each is one destroyObject record, with
 * or without a client's event for it, and none between files.
 *
 * `harness world` (tick mode, one sample a tick) puts root objects, an Armor
 * and a roster in the fake world:
 *
 *  10. what is held before a file: the last gameStatus, each createPlayer,
 *      no clock, no kill, nothing of a player who left; when more is held than
 *      the buffer takes, the oldest goes
 *  11. an object's first sight writes its place and hit points with its o
 *      record, though it never moves
 *  12. a turn about the vertical near yaw 90 degrees is written
 *  13. a value that is not a number leaves its entry out: no line that is
 *      not JSON, no sample at the origin
 *  14. an object taking a net id in the sample its last holder went: the d
 *      before the o
 *  15. chat through GameServer::handleChatMessage's slot: the line as the
 *      chat box shows it, and its pieces to the clients are not a second one
 *  16. a pid's next player has his control written, though the object's id
 *      is the last player's; a join's database does not repeat it
 *  17. faulted samples are counted a file; at the 64th the file is closed
 *      with its end record and nothing more is written
 */
#define _FILE_OFFSET_BITS 64
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <signal.h>
#include <sys/mman.h>
#include "core.h"

static int fd = -1;
static int sr(void *d, size_t n, uintptr_t a) { if (fd < 0) fd = open("/proc/self/mem", O_RDONLY); return pread(fd, d, n, (off_t)a) == (ssize_t)n; }
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }
static void rs(uintptr_t s, char *o, size_t c)
{
    o[0] = 0;
    const char *p = s ? (const char *)(uintptr_t)*(uint32_t *)s : 0;   /* one pointer to the chars */
    if (p) snprintf(o, c, "%s", p);
}
static void mk(void) { (void)system("mkdir -p replays"); }
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;   /* default: not re-entrant, like lnxded */
static void lk(void) { pthread_mutex_lock(&mu); }
static void ul(void) { pthread_mutex_unlock(&mu); }
static void sl(void) { struct timespec t = {0, 33000000}; nanosleep(&t, 0); }
static int det(void) { return 1; }
static int th(void *(*fn)(void *)) { pthread_t t; pthread_create(&t, 0, fn, 0); pthread_detach(t); return 1; }

/* The fake world, in lnxded's offsets: a weapon is a FireArms-shaped block
 * (vptr +0, flags +4, the projectile template +0x194, the pool vector
 * +0x1d8, its count +0x1e4); a pooled round carries its net id at +0x70; a
 * template its id at +0x10 and its name at +0x20. The map is a list:
 * header.left +8, a node's key +0x10, object +0x14, the next node +0x18. */
static uint8_t vt_fa[16], vt_hfa[16], vt_round[16], vt_obj[16];   /* their addresses are the vptrs */
static uint32_t nid(uintptr_t o)
{
    uint32_t v = *(uint32_t *)o;
    return v == (uint32_t)(uintptr_t)vt_round || v == (uint32_t)(uintptr_t)vt_obj ? *(uint32_t *)(o + 0x70) : 0;
}
static void tn(uintptr_t t, char *o, size_t c) { snprintf(o, c, "%s", (const char *)(t + 0x20)); }
static uint32_t succ(uint32_t n, uint32_t h) { uint32_t nx = *(uint32_t *)(uintptr_t)(n + 0x18); return nx ? nx : h; }

static uint8_t *mk_template(uint32_t id, const char *name)
{
    uint8_t *t = calloc(1, 0x80);
    *(uint32_t *)(t + 0x10) = id;
    snprintf((char *)t + 0x20, 0x60, "%s", name);
    return t;
}
/* A weapon whose constructor made `count` rounds from net id `first`. */
static uint8_t *mk_weapon(int hand, int disabled, uint8_t *tmpl, uint32_t first, int count)
{
    uint8_t *fa = calloc(1, 0x200);
    uint32_t *pool = calloc((size_t)count, 4);
    for (int i = 0; i < count; i++) {
        uint8_t *r = calloc(1, 0x80);
        *(uint32_t *)r = (uint32_t)(uintptr_t)vt_round;
        *(uint32_t *)(r + 4) = 1;   /* disabled until thrown */
        *(uint32_t *)(r + 0x70) = first + (uint32_t)i;
        pool[i] = (uint32_t)(uintptr_t)r;
    }
    *(uint32_t *)fa = (uint32_t)(uintptr_t)(hand ? vt_hfa : vt_fa);
    *(uint32_t *)(fa + 4) = disabled ? 1u : 0u;
    *(uint32_t *)(fa + 0x194) = (uint32_t)(uintptr_t)tmpl;
    *(uint32_t *)(fa + 0x1d8) = (uint32_t)(uintptr_t)pool;
    *(uint32_t *)(fa + 0x1dc) = (uint32_t)(uintptr_t)(pool + count);
    *(int32_t *)(fa + 0x1e4) = count;
    return fa;
}
#define MAP_MAX 16
static uint32_t map_header[8], map_nodes[MAP_MAX][8];
/* The map holds these objects (up to MAP_MAX, NULL-terminated). A key is the
 * object's own (+0x48) when it has one, else its place in the list. */
static void set_map(uint8_t **objs)
{
    memset(map_nodes, 0, sizeof map_nodes);
    map_header[2] = 0;
    for (int i = 0; i < MAP_MAX && objs[i]; i++) {
        uint32_t gid = *(uint32_t *)(objs[i] + 0x48);
        map_nodes[i][4] = gid ? gid : 0x1000u + (uint32_t)i;     /* key */
        map_nodes[i][5] = (uint32_t)(uintptr_t)objs[i];          /* object */
        if (i) map_nodes[i - 1][6] = (uint32_t)(uintptr_t)map_nodes[i];
        else map_header[2] = (uint32_t)(uintptr_t)map_nodes[i];
    }
}

/* a fake objectManager: header ptr at +0 (0: no walk), count at +4 */
static uint32_t fake_om[4];
static uint32_t om_ptr;

struct fake_ev { uint32_t vptr, seq, next; uint8_t payload[256]; int type; };
static int get_type(void *ev) { return ((struct fake_ev *)ev)->type; }
static void *vtbl[1] = { (void *)get_type };

static struct rec_target fake = {
    .name = "fake", .header_plus = "fake", .header_version = 5,
    .min_addr = 0x1000, .min_tmpl_addr = 0x1000,
    .map_head_off = 0, .map_count_off = 4,
    .node_leftmost_off = 8, .node_key_off = 0x10, .node_value_off = 0x14,
    .node_left_off = 8, .node_right_off = 0xc,
    .obj_flags_off = 4, .obj_id_off = 0x48, .obj_tmpl_off = 0x4c, .tmpl_id_off = 0x10,
    .obj_mat_off = 0x74, .obj_compmap_off = 0xb8, .armor_iid = 0xc4a4,
    .armor_hp_off = 0x38, .armor_maxhp_off = 0x3c, .armor_crit_off = 0xf0, .armor_lasthit_off = 0x14,
    .pm_list_off = 0xc, .pl_node_player_off = 8,
    .bf_id_off = 0x58, .bf_name_off = 0x44, .bf_ai_off = 0x78, .bf_team_off = 0x7c,
    .bf_veh_off = 0x68, .bf_cam_off = 0x74,
    .cm_target_off = 0, .cm_text_off = 4, .cm_len_off = 0x48, .cm_sender_off = 0x4c,
    .fa_proj_tmpl_off = 0x194, .fa_pool_off = 0x1d8, .fa_pool_count_off = 0x1e4,
    .flush_each_line = 1,
    .safe_read = sr, .now_s = now, .net_id_of = nid, .read_string = rs,
    .read_template_name = tn, .tree_successor = succ, .make_replays_dir = mk,
    .rec_lock = lk, .rec_unlock = ul, .rec_sleep = sl, .install_detours = det,
    .start_sampler_thread = th,
};
extern void recorder_on_event(uint32_t ev);
extern void recorder_on_queue_event(uint32_t ev);

/* What lies past an event's payload is its heap neighbours, different for
 * every copy: the recorder must read and compare the payload alone. */
static int payload_len(int type) {
    switch (type) {
        case 0x05: return 10;
        case 0x08: return 45; case 0x16: return 19; case 0x1a: return 51;
        case 0x1b: return 33; case 0x24: return 39; case 0x29: return 8;
        case 0x2a: return 14; default: return 0;
    }
}
static uint32_t pool_tid, pool_first;   /* the next 0x05's payload */
static int32_t pool_count;
static void ev(int queue, int type, int byte0) {
    struct fake_ev e; memset(&e, 0, sizeof e);
    for (int i = payload_len(type); i < (int)sizeof e.payload; i++) e.payload[i] = (uint8_t)rand();
    e.vptr = (uint32_t)(uintptr_t)vtbl; e.type = type; e.payload[0] = (uint8_t)byte0;
    static const char cp1252_name[] = "Julius Haim\xfc" "ller";   /* a bot of El Alamein's */
    if (type == 0x08) memcpy(e.payload + 3, cp1252_name, sizeof cp1252_name);
    if (type == 0x05) {   /* the server's object: tid +0, u16 first id +4, i32 count +6 */
        uint16_t first16 = (uint16_t)pool_first;
        memcpy(e.payload, &pool_tid, 4);
        memcpy(e.payload + 4, &first16, 2);
        memcpy(e.payload + 6, &pool_count, 4);
    }
    if (queue) recorder_on_queue_event((uint32_t)(uintptr_t)&e);
    else recorder_on_event((uint32_t)(uintptr_t)&e);
}
/* An event with these payload bytes, and rand() past them. */
static void evp(int queue, int type, const void *payload, int len) {
    struct fake_ev e; memset(&e, 0, sizeof e);
    for (int i = len; i < (int)sizeof e.payload; i++) e.payload[i] = (uint8_t)rand();
    memcpy(e.payload, payload, (size_t)len);
    e.vptr = (uint32_t)(uintptr_t)vtbl; e.type = type;
    if (queue) recorder_on_queue_event((uint32_t)(uintptr_t)&e);
    else recorder_on_event((uint32_t)(uintptr_t)&e);
}
/* u8 player id, u16 net id: PickupKit (0x23) and SetDefaultVehicle (0x09). */
static void ev_pid_nid(int type, int pid, int id) {
    uint8_t p[3] = { (uint8_t)pid, (uint8_t)id, (uint8_t)(id >> 8) };
    evp(1, type, p, 3);
}
static void ev_destroy_object(int id) { uint8_t p[2] = { (uint8_t)id, (uint8_t)(id >> 8) }; evp(1, 0x06, p, 2); }
static void ev_destroy_player(int pid) { uint8_t p[1] = { (uint8_t)pid }; evp(1, 0x0c, p, 1); }
static void ev_create_player(int pid, int team, const char *name) {
    uint8_t p[45]; memset(p, 0, sizeof p);
    p[0] = (uint8_t)team; snprintf((char *)p + 3, 32, "%s", name); p[35] = (uint8_t)pid;
    evp(1, 0x08, p, sizeof p);
}
static void ev_create_object(int id) {
    uint8_t p[31]; memset(p, 0, sizeof p);
    p[4] = (uint8_t)id; p[5] = (uint8_t)(id >> 8);
    evp(1, 0x07, p, sizeof p);
}
/* One piece of a chat line as the server's ChatFragmentEvent holds it, sent
 * to `clients` connections: first 0, no-sender 1, team-only 2, server 3,
 * sender 4, the line's length 8, the piece's 9, text 10. The text field past
 * the piece is the allocator's, different in every copy. */
static void ev_chat_piece(int clients, int sender, int nosender, int team_only, const char *line, int at)
{
    int total = (int)strlen(line), n = total - at > 15 ? 15 : total - at;
    for (int c = 0; c < clients; c++) {
        uint8_t p[26];
        for (int i = 0; i < (int)sizeof p; i++) p[i] = (uint8_t)(1 + rand() % 255);
        p[0] = at == 0; p[1] = (uint8_t)nosender; p[2] = (uint8_t)team_only; p[3] = 0;
        memcpy(p + 4, &sender, 4);
        p[8] = (uint8_t)total; p[9] = (uint8_t)n;
        memcpy(p + 10, line + at, (size_t)n);
        evp(1, 0x28, p, sizeof p);
    }
}
/* The whole line, a piece every 20 ms. */
static void ev_chat_line(int clients, int sender, int nosender, int team_only, const char *line)
{
    for (int at = 0; at < (int)strlen(line); at += 15) {
        ev_chat_piece(clients, sender, nosender, team_only, line, at);
        usleep(20000);
    }
}
/* The harness thread plays the game thread. Thread mode: the sampler thread
 * runs by itself, the harness sleeps. Tick mode: the harness ticks the
 * recorder at 30 Hz, the way the simulateFrame hook does. */
static void run_for(int ms) {
#if REC_TICK
    for (int t = 0; t < ms; t += 33) { recorder_core_tick(); usleep(33000); }
#else
    usleep(ms * 1000);
#endif
}
static void on_alarm(int s) { (void)s; static const char m[] = "HANG: a recorder lock was never released\n"; if (write(2, m, sizeof m - 1)) {} _exit(3); }

#if REC_TICK
/* The live set: the ObjectManager's register/unregister vtable slots, which
 * the recorder patches. The harness registers through them as the server's
 * code does (every call is virtual). */
static uint32_t slot_reg, slot_unreg;
static uint32_t fake_register(void *om, uint32_t obj) { (void)om; (void)obj; return 1; }
static uint32_t fake_unregister(void *om, uint32_t obj) { (void)om; (void)obj; return 1; }
static int pw(uintptr_t a, const void *s, size_t n) { memcpy((void *)a, s, n); return 1; }
static void reg(uint8_t *o) { ((uint32_t (*)(void *, uint32_t))(uintptr_t)slot_reg)(fake_om, (uint32_t)(uintptr_t)o); }
static void unreg(uint8_t *o) { ((uint32_t (*)(void *, uint32_t))(uintptr_t)slot_unreg)(fake_om, (uint32_t)(uintptr_t)o); }
static void ticks(int n) { for (int i = 0; i < n; i++) { recorder_core_tick(); usleep(1000); } }

/* GameServer::destroyObject's vtable slot: the server destroys an object;
 * with a client connected its DestroyObjectEvent reaches the queue first. */
static uint32_t slot_destroy;
static uint32_t fake_destroy(void *gs, uint32_t obj) { (void)gs; (void)obj; return 1; }
static void destroy(uint32_t obj, int client)
{
    if (client) {
        struct fake_ev e; memset(&e, 0, sizeof e);
        for (int i = 2; i < (int)sizeof e.payload; i++) e.payload[i] = (uint8_t)rand();
        uint16_t id = (uint16_t)nid(obj);
        memcpy(e.payload, &id, 2);
        e.vptr = (uint32_t)(uintptr_t)vtbl; e.type = 0x06;
        recorder_on_queue_event((uint32_t)(uintptr_t)&e);
    }
    ((uint32_t (*)(void *, uint32_t))(uintptr_t)slot_destroy)(fake_om, obj);
}
/* A weapon dies: releaseProjectilePool destroys each round. */
static void release_pool(uint8_t *fa, int client_for_first)
{
    uint32_t *b = (uint32_t *)(uintptr_t)*(uint32_t *)(fa + 0x1d8), *e = (uint32_t *)(uintptr_t)*(uint32_t *)(fa + 0x1dc);
    for (uint32_t *r = b; r < e; r++) destroy(*r, client_for_first && r == b);
}

/* 3 ticks a sample (10 Hz): a weapon is pending for 30 samples, 90 ticks. */
static int live_main(void)
{
    slot_reg = (uint32_t)(uintptr_t)fake_register;
    slot_unreg = (uint32_t)(uintptr_t)fake_unregister;
    fake.om_register_slot = (uint32_t)(uintptr_t)&slot_reg;
    fake.om_register_fn = slot_reg;
    fake.om_unregister_slot = (uint32_t)(uintptr_t)&slot_unreg;
    fake.om_unregister_fn = slot_unreg;
    fake.patch_write = pw;
    slot_destroy = (uint32_t)(uintptr_t)fake_destroy;
    fake.gs_destroy_slot = (uint32_t)(uintptr_t)&slot_destroy;
    fake.gs_destroy_fn = slot_destroy;
    om_ptr = (uint32_t)(uintptr_t)fake_om;
    fake.object_manager_ptr = (uint32_t)(uintptr_t)&om_ptr;
    recorder_core_init(&fake);
    if (slot_reg == (uint32_t)(uintptr_t)fake_register) { fprintf(stderr, "harness: live set not hooked\n"); return 1; }
    if (slot_destroy == (uint32_t)(uintptr_t)fake_destroy) { fprintf(stderr, "harness: destroyObject not hooked\n"); return 1; }

    uint8_t *mine = mk_template(4242, "FloatingMine"), *grenade = mk_template(1293, "GrenadeAxisProjectile");
    /* The level loads with a PT boat's launcher (the first sample builds the
     * set from the map): written once, then scenery. */
    uint8_t *launcher = mk_weapon(0, 0, mine, 700, 4);
    set_map((uint8_t *[]){ launcher, NULL });
    fake_om[0] = (uint32_t)(uintptr_t)map_header;
    fake_om[1] = 5000;
    ticks(150);
    /* A soldier spawns: his kit's grenades (a carried kit: disabled). */
    uint8_t *hand = mk_weapon(1, 1, grenade, 599, 3);
    set_map((uint8_t *[]){ launcher, hand, NULL });
    reg(hand);
    ticks(150);
    /* The boat is destroyed and respawns: the launcher's rounds are
     * destroyed (the first with a client connected, whose event comes
     * first), then a new launcher on the same ids. */
    release_pool(launcher, 1);
    unreg(launcher);
    uint8_t *launcher2 = mk_weapon(0, 0, mine, 700, 4);
    set_map((uint8_t *[]){ hand, launcher2, NULL });
    reg(launcher2);
    ticks(150);
    /* The level unloads and the next loads: the new file has both pools,
     * though both weapons are scenery by now. */
    fake_om[1] = 900; ticks(30);
    fake_om[1] = 10; ticks(15);
    /* The last level's teardown between files: not held for the next. */
    uint8_t *gone = mk_weapon(0, 0, mine, 900, 1);
    release_pool(gone, 0);
    fake_om[1] = 4000; ticks(150);
    recorder_core_shutdown();
    fprintf(stderr, "harness: done\n");
    return 0;
}

/* --- harness world: root objects, an Armor, a roster, the chat handler --- */

/* Where a root stands, turned `yaw` degrees about the vertical: the Mat4's
 * rows a, b, c and its position. The quaternion the recorder writes for it
 * is [0, sin(yaw/2), 0, cos(yaw/2)]. */
static void place(uint8_t *o, float x, float y, float z, float yaw)
{
    float r = yaw * 3.14159265f / 180.0f, m[16] = { 0 };
    m[0] = __builtin_cosf(r); m[2] = -__builtin_sinf(r);
    m[5] = 1.0f;
    m[8] = __builtin_sinf(r); m[10] = __builtin_cosf(r);
    m[12] = x; m[13] = y; m[14] = z;
    memcpy(o + 0x74, m, sizeof m);
}
/* A root object: the root flag +4, its registry key +0x48, template +0x4c,
 * net id +0x70, Mat4 +0x74, component map +0xb8 (empty). */
static uint8_t *mk_root(uint32_t gid, uint32_t net, uint8_t *tmpl, float x, float y, float z, float yaw)
{
    uint8_t *o = calloc(1, 0x200);
    *(uint32_t *)o = (uint32_t)(uintptr_t)vt_obj;
    *(uint32_t *)(o + 4) = 0x02000000u;
    *(uint32_t *)(o + 0x48) = gid;
    *(uint32_t *)(o + 0x4c) = (uint32_t)(uintptr_t)tmpl;
    *(uint32_t *)(o + 0x70) = net;
    place(o, x, y, z, yaw);
    return o;
}
/* An Armor in the object's component map, one node under key 0xc4a4: hit
 * points +0x38, the most +0x3c, critical damage +0xf0, last hit by +0x14. */
static uint8_t *give_armor(uint8_t *o, float hp, float maxhp, float crit)
{
    uint8_t *armor = calloc(1, 0x100);
    uint32_t *header = calloc(8, 4), *node = calloc(8, 4);
    *(float *)(armor + 0x38) = hp;
    *(float *)(armor + 0x3c) = maxhp;
    *(float *)(armor + 0xf0) = crit;
    *(int32_t *)(armor + 0x14) = -1;
    node[4] = 0xc4a4; node[5] = (uint32_t)(uintptr_t)armor;
    header[1] = (uint32_t)(uintptr_t)node;                       /* the root */
    *(uint32_t *)(o + 0xb8) = (uint32_t)(uintptr_t)header;
    *(uint32_t *)(o + 0xbc) = 1;
    return armor;
}

/* The roster: the playerManager's list (its header node at +0xc; a node's
 * next +0, its BFPlayer +8), and a BFPlayer: name +0x44 (one pointer to the
 * chars), id +0x58, controlled object +0x68, ai +0x78, team +0x7c. */
static uint32_t fake_pm[8], pm_ptr, pl_nodes[8][3];
static uint8_t *mk_player(int pid, const char *name, int team, uint8_t *veh)
{
    uint8_t *p = calloc(1, 0x200);
    *(uint32_t *)(p + 0x44) = (uint32_t)(uintptr_t)name;
    *(uint16_t *)(p + 0x58) = (uint16_t)pid;
    *(uint32_t *)(p + 0x68) = (uint32_t)(uintptr_t)veh;
    *(uint32_t *)(p + 0x7c) = (uint32_t)team;
    return p;
}
static void set_roster(uint8_t **players)
{
    uint32_t list = (uint32_t)(uintptr_t)&fake_pm[3];
    uint32_t *link = &fake_pm[3];
    for (int i = 0; i < 8 && players[i]; i++) {
        pl_nodes[i][2] = (uint32_t)(uintptr_t)players[i];
        *link = (uint32_t)(uintptr_t)pl_nodes[i];
        link = &pl_nodes[i][0];
    }
    *link = list;
}

/* GameServer::handleChatMessage's vtable slot, and the ChatMessage it is
 * handed: target +0 (0 the sender's side only), text +4, length +0x48,
 * sender +0x4c. The server calls it for a client's line and for its own. */
static uint32_t slot_chat;
static uint32_t fake_chat(void *gs, uint32_t msg) { (void)gs; (void)msg; return 1; }
struct fake_msg { int32_t target; char text[68]; int32_t len; int32_t sender; uint8_t nosender, server; };
static void say(int sender, int target, const char *text)
{
    struct fake_msg m; memset(&m, 0, sizeof m);
    m.target = target; m.sender = sender; m.nosender = sender < 0;
    snprintf(m.text, 64, "%s", text);
    m.len = (int32_t)strlen(m.text);
    ((uint32_t (*)(void *, uint32_t))(uintptr_t)slot_chat)(fake_om, (uint32_t)(uintptr_t)&m);
}
/* `n` samples that fault: the map's header in a page that cannot be read. */
static void faulted(int n)
{
    static void *bad;
    if (!bad) bad = mmap(0, 4096, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    fake_om[0] = (uint32_t)(uintptr_t)bad;
    ticks(n);
    fake_om[0] = (uint32_t)(uintptr_t)map_header;
}

/* recorder.con says 30 Hz here: every tick is a sample. */
static int world_main(void)
{
    fake.header_plus = "server-replay-recorder/harness";   /* the viewer reads it as a server's file */
    fake.patch_write = pw;
    slot_chat = (uint32_t)(uintptr_t)fake_chat;
    fake.gs_chat_slot = (uint32_t)(uintptr_t)&slot_chat;
    fake.gs_chat_fn = slot_chat;
    om_ptr = (uint32_t)(uintptr_t)fake_om;
    fake.object_manager_ptr = (uint32_t)(uintptr_t)&om_ptr;
    pm_ptr = (uint32_t)(uintptr_t)fake_pm;
    fake.player_manager_ptr = (uint32_t)(uintptr_t)&pm_ptr;
    set_roster((uint8_t *[]){ NULL });
    recorder_core_init(&fake);
    fprintf(stderr, slot_chat == (uint32_t)(uintptr_t)fake_chat
            ? "harness: chat handler NOT hooked\n" : "harness: chat handler hooked\n");

    /* 10: held until the level loads. A clock and a kill are moments of
     * another round; the status is the last one; each player once, and not
     * the one who left. */
    uint32_t clock[2] = { 0, 435 };
    evp(0, 0x29, clock, sizeof clock);
    ev(0, 0x24, 1); ev(0, 0x24, 3);
    ev_create_player(1, 1, "Alpha"); ev_create_player(2, 2, "Bravo"); ev_create_player(3, 1, "Charlie");
    ev_create_player(4, 2, "Delta"); ev_destroy_player(4);
    ev(0, 0x2a, 9);

    /* 11 to 13: the level. A tank that never moves, a jeep at yaw 90, an
     * object whose place is not a number, one whose Armor is not. */
    uint8_t *tank = mk_template(31, "Tiger"), *jeep = mk_template(32, "Willy");
    uint8_t *a = mk_root(0x2001, 800, tank, 100, 20, 300, 0);
    uint8_t *a_armor = give_armor(a, 100, 100, 20);
    uint8_t *b = mk_root(0x2002, 801, jeep, 50, 10, 50, 90);
    uint8_t *n = mk_root(0x2003, 802, jeep, __builtin_nanf(""), 5, 5, 0);
    uint8_t *h = mk_root(0x2004, 803, tank, 60, 10, 60, 0);
    uint8_t *h_armor = give_armor(h, 80, __builtin_inff(), 20);
    uint8_t *d = mk_root(0x2005, 805, jeep, 70, 10, 70, 0);
    set_map((uint8_t *[]){ a, b, n, h, d, NULL });
    fake_om[0] = (uint32_t)(uintptr_t)map_header;
    fake_om[1] = 5000;
    ticks(5);
    /* 12: the jeep rolls half a metre, then turns 12 degrees where it is. */
    place(b, 50.5f, 10, 50, 90); ticks(2);
    place(b, 50.5f, 10, 50, 102); ticks(2);
    /* 13: a hit on the tank in the sample the other Armor reads as no number. */
    *(float *)(a_armor + 0x38) = 90;
    *(float *)(h_armor + 0x38) = __builtin_nanf("");
    *(int32_t *)(h_armor + 0x14) = 7;
    ticks(2);
    /* 14: the jeep on net id 805 goes and a tank takes the id, between two
     * samples. */
    uint8_t *e = mk_root(0x2006, 805, tank, 71, 10, 71, 0);
    set_map((uint8_t *[]){ a, b, n, h, e, NULL });
    ticks(3);

    /* 15: two players, and chat as the server's handler is given it. */
    uint8_t *p5 = mk_player(5, "Alpha Dog", 1, a), *p6 = mk_player(6, "Bravo", 2, b);
    set_roster((uint8_t *[]){ p5, p6, NULL });
    ticks(2);
    say(5, 1, "hello all");
    say(6, 0, "push left");
    say(-1, 1, "Server restarts at 22:00");
    say(5, 1, "gr\xfc\xdf dich");
    say(6, 1, "sixty-three characters is the most a line of chat can hold, ok?");
    usleep(20000);
    ev_chat_line(2, 5, 0, 0, "hello all");   /* its pieces on their way to two clients */

    /* 16: pid 5 goes to another player, who controls the same net id. Then a
     * client joins and is sent what the file already has. */
    *(uint32_t *)(p5 + 0x44) = (uint32_t)(uintptr_t)"Zulu";
    ticks(2);
    ev_create_player(5, 1, "Zulu"); ev_pid_nid(0x09, 5, 800); usleep(20000);

    /* 17: 40 faulted samples in this file and 40 in the next are not 64 in
     * one: the jeep's move after them is sampled. */
    faulted(40);
    fake_om[1] = 900; ticks(4);       /* the level unloads: the file closes */
    fake_om[1] = 10; ticks(2);
    /* 10: more held than the buffer takes, then the round's end. */
    for (int i = 0; i < 1100; i++) ev_create_object(2000 + i);
    ev(0, 0x24, 2);
    fake_om[1] = 4000; ticks(3);      /* the next level: the second file */
    faulted(40);
    place(b, 77, 10, 50, 0); ticks(2);
    /* 30 more: the 64th in this file ends it. */
    faulted(30);
    ev(0, 0x2a, 8);
    place(b, 99, 10, 50, 0); ticks(2);
    recorder_core_shutdown();
    fprintf(stderr, "harness: done\n");
    return 0;
}
#endif

int main(int argc, char **argv) {
    signal(SIGALRM, on_alarm); alarm(20);
    fake.vt_fire_arms = (uint32_t)(uintptr_t)vt_fa;
    fake.vt_hand_fire_arms = (uint32_t)(uintptr_t)vt_hfa;
#if REC_TICK
    if (argc > 1 && !strcmp(argv[1], "live")) return live_main();
    if (argc > 1 && !strcmp(argv[1], "world")) return world_main();
#else
    (void)argc; (void)argv;
#endif
    om_ptr = (uint32_t)(uintptr_t)fake_om;
    fake.object_manager_ptr = (uint32_t)(uintptr_t)&om_ptr;
    recorder_core_init(&fake);
    /* 1: events before any level is loaded are held */
    ev(0, 0x24, 1);                       /* gameStatus 1 */
    ev(0, 0x16, 0);                       /* gameRules */
    run_for(200);
    fake_om[1] = 5000;                    /* the level loads: the file opens, held flushed at t 0 */
    run_for(300);
    /* 2: a client joins mid-round: handshake 0x1a then its database */
    ev(1, 0x1a, 0); ev(1, 0x1b, 0); ev(1, 0x08, 7);
    run_for(100);
    /* 3: a to-all kill with 3 clients connected: toall once + 3 queue clones */
    ev(0, 0x2a, 9); ev(1, 0x2a, 9); ev(1, 0x2a, 9); ev(1, 0x2a, 9);
    run_for(20);
    ev(0, 0x2a, 9);                       /* the same payload 20 ms later: a new event */
    run_for(200);
    /* 8: chat from its pieces. Three clients are sent each piece of a
     * player's line. */
    ev_chat_line(3, 2, 0, 0, "the bridge is down, go round by the ford");
    /* A line that stops half way, then the same player's next. */
    ev_chat_piece(1, 4, 0, 0, "this line never gets its second half", 0);
    usleep(20000);
    ev_chat_line(1, 4, 0, 1, "ok");
    usleep(20000);
    ev_chat_piece(1, 4, 0, 0, "this line never gets its second half", 15);
    usleep(20000);
    /* A player who leaves in the middle of his line. */
    ev_chat_piece(1, 6, 0, 0, "gone before the end of it", 0);
    usleep(20000);
    ev_destroy_player(6);
    ev_chat_piece(1, 6, 0, 0, "gone before the end of it", 15);
    usleep(20000);
    /* The server's own line: no sender is sent, whatever the field holds. */
    ev_chat_line(1, 3, 1, 0, "Server restarts at 22:00");
    /* More unfinished lines than are kept, then a whole one. */
    for (int s = 100; s < 140; s++) ev_chat_piece(1, s, 0, 0, "an unfinished line from each of forty", 0);
    usleep(20000);
    ev_chat_line(1, 2, 0, 0, "last");
    /* 9: a kit and a controlled object named again once the file has said
     * they are gone. */
    ev_pid_nid(0x23, 9, 760); usleep(20000);
    ev_pid_nid(0x23, 9, 760); usleep(20000);       /* a repeat: dropped */
    ev_destroy_object(760); usleep(20000);
    ev_pid_nid(0x23, 9, 760); usleep(20000);       /* another kit on the id */
    ev_create_player(8, 1, "First"); ev_pid_nid(0x09, 8, 770); usleep(20000);
    ev_destroy_player(8); ev_create_player(8, 2, "Second"); usleep(20000);
    ev_pid_nid(0x09, 8, 770); usleep(20000);       /* the pid's next player */
    run_for(100);
    /* 7: a soldier spawns with 3 clients connected: his grenades' pool is
     * sent to each (spawnMultipleObjects loops the connections), then his
     * weapon is in the world, and a PT boat's launcher beside it. */
    pool_tid = 1293; pool_first = 599; pool_count = 3;
    ev(1, 0x05, 0); ev(1, 0x05, 0); ev(1, 0x05, 0);
    uint8_t *mine = mk_template(4242, "FloatingMine"), *grenade = mk_template(1293, "GrenadeAxisProjectile");
    uint8_t *hand = mk_weapon(1, 1, grenade, 599, 3);
    uint8_t *launcher = mk_weapon(0, 0, mine, 700, 4);
    set_map((uint8_t *[]){ hand, launcher, NULL });
    fake_om[0] = (uint32_t)(uintptr_t)map_header;
    run_for(400);
    /* The boat is destroyed and respawns: a new launcher, the same ids. */
    uint8_t *launcher2 = mk_weapon(0, 0, mine, 700, 4);
    set_map((uint8_t *[]){ hand, launcher2, NULL });
    run_for(300);
#if REC_TICK
    /* 5: a pointer the sample follows into an unreadable page: the guard
     * cuts that sample short, the server (this process) lives on, and the
     * recording carries on (step 4's events land after it). */
    void *bad = mmap(0, 4096, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    fake_om[0] = (uint32_t)(uintptr_t)bad;
    run_for(100);
    fake_om[0] = (uint32_t)(uintptr_t)map_header;
#endif
    /* 4: the level unloads; the next opens in the same second */
    fake_om[1] = 900; run_for(150);     /* split here (900 < 5000/4) */
    fake_om[1] = 300; run_for(150);     /* still unloading: no file */
    ev(0, 0x24, 2);                       /* held for the next file */
    fake_om[1] = 10;  run_for(150);
    fake_om[1] = 4000; run_for(300);    /* next level: second file */
    ev(0, 0x29, 0);
    run_for(150);
    /* 6: ENDMAP is on disk at once (the server restarts its process right
     * after it, with no exit handlers): read the newest file before any
     * writer wake-up or shutdown drain. */
    ev(0, 0x24, 5);
    {
        FILE *ls = popen("ls -t replays/*.ndjson | head -1", "r");
        char name[256] = "";
        if (ls && fgets(name, sizeof name, ls)) name[strcspn(name, "\n")] = 0;
        if (ls) pclose(ls);
        FILE *f = name[0] ? fopen(name, "r") : 0;
        char line[512];
        int found = 0;
        while (f && fgets(line, sizeof line, f)) if (strstr(line, "\"status\":5")) found = 1;
        if (f) fclose(f);
        fprintf(stderr, found ? "harness: endmap on disk\n" : "harness: endmap NOT on disk\n");
    }
    recorder_core_shutdown();   /* tick mode: the writer drains here */
    fprintf(stderr, "harness: done\n");
    return 0;
}
