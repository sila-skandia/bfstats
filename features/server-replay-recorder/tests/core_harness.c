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
 *
 * `harness hits` (tick mode) calls the hit and impact hooks as the detours
 * on addBulletsGivingDamage and handleCollisionForProjectile do, with the
 * keys recorder.con gives (run.sh runs it with both on, then each off):
 *
 *  18. an hg line per credited hit, the stat id named through the template
 *      manager, a stat id it does not know without tmpl
 *  19. an i line per collision: the round's fire origin, contact + its
 *      position, its owner and stat id, the hit object's root's net id or
 *      -1 on terrain, dmg 1 only when a hit was credited inside the call
 *      (a nested call's credit counts for the call around it too, not
 *      the other way round)
 *
 * `harness events` (tick mode) sends the events that used to be dropped
 * (features/replay-feature-sweep-2026-11-01 entry 3), as the queue and the
 * to-all hook hand them over, and calls the hit-direction and refill hooks:
 *
 *  20. welcome lines and the map rotation before a file are held and
 *      written at t 0, once each though two clients were sent them; the
 *      session id is a moment and is not
 *  21. a vote, under the client recorder's names
 *  22. the round-end tallies (0x30..0x32), the rows named, the stale rows
 *      past the count left out; a bot's from the to-all hook alone
 *  23. a hit's direction and a refill from the queue: no pid
 *  24. with the _giveDamage and triggerSpecialGameEvent hooks: each player's,
 *      with his pid, two in one tick both written; the queue's copies not
 *  25. 0x1e, 0x25, 0x3b, 0x0e as the client recorder's `raw`
 *  26. the board (sweep entry 4): a ps entry per player, again only when a
 *      counter moves; the ScoreManager's points as one scoreTable, again
 *      when one changes
 *  27. the round's end (sweep entry 5): gameStatus 2 carries the winner and
 *      the victory type set later in the same tick; 5 is written as it comes
 *  28. a control point's capture timers (sweep entry 7): a cpt row on first
 *      sight with the template's two times, again at once when the state or
 *      the getting team changes, a running timer at most every quarter
 *      second, a team change's cp before its cpt, a timer that is not a
 *      number no row
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
static uint8_t vt_fa[16], vt_hfa[16], vt_round[16], vt_obj[16], vt_sol[16];   /* their addresses are the vptrs */
static uint32_t nid(uintptr_t o)
{
    uint32_t v = *(uint32_t *)o;
    return v == (uint32_t)(uintptr_t)vt_round || v == (uint32_t)(uintptr_t)vt_obj || v == (uint32_t)(uintptr_t)vt_sol
        ? *(uint32_t *)(o + 0x70) : 0;
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

/* A template manager holding one id: its map at mgr+8, {header, count};
 * the root at header+4; a node's key +0x10, value +0x14. */
static uint32_t tm_obj[4], tm_header[8], tm_node[8], tm_ptr;
/* A round: vptr +0, root flag +4, owner +0x108, fire origin +0x134, stat id
 * +0x140; its vtable's +0x38 returns its absolute position. */
static float round_at[3] = { 10, 2, 30 };
static uint32_t round_pos(void *self) { (void)self; return (uint32_t)(uintptr_t)round_at; }
static uint32_t round_vt[32];
static uint8_t *mk_round(int owner, uint32_t tid, float ox, float oy, float oz)
{
    uint8_t *r = calloc(1, 0x200);
    *(uint32_t *)r = (uint32_t)(uintptr_t)round_vt;
    *(uint32_t *)(r + 4) = 0x02000000u;
    *(int32_t *)(r + 0x108) = owner;
    float o[3] = { ox, oy, oz };
    memcpy(r + 0x134, o, sizeof o);
    *(uint32_t *)(r + 0x140) = tid;
    return r;
}
extern void recorder_on_hit(uint32_t bf, uint32_t tid);
extern void recorder_on_impact_begin(uint32_t proj, uint32_t other, uint32_t contact);
extern void recorder_on_impact_end(void);
#define U(p) ((uint32_t)(uintptr_t)(p))

static int hits_main(void)
{
    fake.proj_owner_off = 0x108; fake.proj_origin_off = 0x134;
    fake.proj_stat_off = 0x140; fake.proj_pos_slot = 0x38;
    fake.obj_parent_off = 0x50;
    round_vt[0x38 / 4] = U(round_pos);
    uint8_t *mp40 = mk_template(3001, "Mp40");
    tm_node[4] = 3001; tm_node[5] = U(mp40);
    tm_header[1] = U(tm_node);
    tm_obj[2] = U(tm_header); tm_obj[3] = 1;
    tm_ptr = U(tm_obj);
    fake.template_manager_ptr = U(&tm_ptr);
    om_ptr = U(fake_om);
    fake.object_manager_ptr = U(&om_ptr);
    pm_ptr = U(fake_pm);
    fake.player_manager_ptr = U(&pm_ptr);
    set_roster((uint8_t *[]){ NULL });
    recorder_core_init(&fake);
    uint8_t *tank = mk_template(31, "Tiger");
    uint8_t *a = mk_root(0x2001, 800, tank, 100, 20, 300, 0);
    /* a turret on the tank: the hit object is a child, the record names its root */
    uint8_t *turret = mk_root(0x2002, 0, tank, 100, 22, 300, 0);
    *(uint32_t *)(turret + 4) = 0;
    *(uint32_t *)(turret + 0x50) = U(a);
    set_map((uint8_t *[]){ a, NULL });
    fake_om[0] = U(map_header);
    fake_om[1] = 5000;
    ticks(3);
    uint8_t *p5 = mk_player(5, "Alpha", 1, a), *p6 = mk_player(6, "Bravo", 2, 0);
    float contact[3] = { 0.5f, -0.25f, 1.0f };
    uint8_t *r = mk_round(5, 3001, 1.234f, 2, 3.5f);
    /* 18 */
    recorder_on_hit(U(p5), 3001);
    recorder_on_hit(U(p6), 777);
    /* 19: a direct hit on the turret, credited inside the call */
    recorder_on_impact_begin(U(r), U(turret), U(contact));
    recorder_on_hit(U(p5), 3001);
    recorder_on_impact_end();
    /* terrain, nothing credited */
    recorder_on_impact_begin(U(r), 0, U(contact));
    recorder_on_impact_end();
    /* an outer call credited around an inner one that is not: the inner
     * is dmg 0, the outer 1 */
    uint8_t *r6 = mk_round(-1, 777, 7, 8, 9);
    recorder_on_impact_begin(U(r), 0, U(contact));
    recorder_on_hit(U(p5), 3001);
    recorder_on_impact_begin(U(r6), U(a), U(contact));
    recorder_on_impact_end();
    recorder_on_impact_end();
    ticks(2);
    recorder_core_shutdown();
    fprintf(stderr, "harness: done\n");
    return 0;
}

extern void recorder_on_hit_from(uint32_t bf, uint32_t sector, uint32_t strength);
extern void recorder_on_special(uint32_t type, uint32_t bf);
extern void recorder_on_medpack(uint32_t medic, uint32_t patient);
extern void recorder_on_repair(uint32_t engineer, uint32_t armor);
extern void recorder_on_depot_begin(uint32_t obj);
extern void recorder_on_depot_end(uint32_t depot, uint32_t obj);
extern volatile int g_hitfrom_hooked, g_special_hooked;
extern void recorder_spawn_pick(uint32_t bf, int32_t group, int32_t kit, int32_t was_group, int32_t was_kit);

/* A round-end tally (0x30..0x32) as sendPlayerStats builds it: rows-1, the
 * player, ten template ids, ten counts; the rows past `rows` hold `stale`. */
static void ev_stats(int queue, int type, int pid, int rows, const uint32_t *tids, const uint16_t *counts, uint32_t stale)
{
    uint8_t p[62]; memset(p, 0, sizeof p);
    p[0] = (uint8_t)(rows - 1); p[1] = (uint8_t)pid;
    for (int i = 0; i < 10; i++) {
        uint32_t tid = i < rows ? tids[i] : stale;
        uint16_t n = i < rows ? counts[i] : 99;
        memcpy(p + 2 + 4 * i, &tid, 4);
        memcpy(p + 42 + 2 * i, &n, 2);
    }
    evp(queue, type, p, sizeof p);
}

/* A ScoreManager: its vptr (an address the target names), the eight points
 * from +0x3c, the winner +0x5c and victory type +0x5d. */
static uint32_t fake_sm[0x80], sm_ptr;
static uint8_t vt_sm[16];

/* A ControlPoint in lnxded's offsets (AI-100): its template +0x164 (and the
 * object's +0x4c), lose timer +0x168, get timer +0x16c, getting team +0x170,
 * team +0x174, state +0x17c; the template's controlPointName +0x1e4 (the
 * chars' address), timeToGetControl +0x1f4, timeToLoseControl +0x1f8. */
static uint8_t vt_cp[16];
static void cp_set(uint8_t *cp, int state, int by, int team, float get, float lose)
{
    *(int32_t *)(cp + 0x17c) = state; *(int32_t *)(cp + 0x170) = by; *(int32_t *)(cp + 0x174) = team;
    *(float *)(cp + 0x16c) = get; *(float *)(cp + 0x168) = lose;
}

/* `harness events` (tick mode): the events emit_event_json used to drop. */
static int events_main(void)
{
    fake.header_plus = "server-replay-recorder/harness";   /* the viewer reads it as a server's file */
    fake_sm[0] = U(vt_sm);
    static const int32_t points[8] = { -1, 3, -3, 20, 5, 5, 5, -15 };   /* death .. objectiveTk */
    memcpy((uint8_t *)fake_sm + 0x3c, points, sizeof points);
    ((uint8_t *)fake_sm)[0x5d] = 4;
    sm_ptr = U(fake_sm);
    fake.score_manager_ptr = U(&sm_ptr);
    fake.vt_score_manager = U(vt_sm);
    fake.score_base_off = 0x10; fake.score_stride_off = 0x50; fake.score_tickets_off = 0x48;
    fake.sm_points_off = 0x3c; fake.sm_winner_off = 0x5c; fake.sm_victory_off = 0x5d;
    fake.bf_score_off = 0xc0; fake.bf_kills_off = 0xa4; fake.bf_deaths_off = 0xa0;
    fake.bf_ping_off = 0x94; fake.bf_medals_off = 0xe8;
    fake.vt_control_point = U(vt_cp);
    fake.cp_team_off = 0x174; fake.cpt_name_off = 0x1e4;
    fake.cp_state_off = 0x17c; fake.cp_tmpl_off = 0x164; fake.cp_lose_off = 0x168; fake.cp_get_off = 0x16c;
    fake.cp_getting_off = 0x170; fake.cpt_get_off = 0x1f4; fake.cpt_lose_off = 0x1f8;
    uint8_t *mp40 = mk_template(3001, "Mp40");
    tm_node[4] = 3001; tm_node[5] = U(mp40);
    tm_header[1] = U(tm_node);
    tm_obj[2] = U(tm_header); tm_obj[3] = 1;
    tm_ptr = U(tm_obj);
    fake.template_manager_ptr = U(&tm_ptr);
    om_ptr = U(fake_om);
    fake.object_manager_ptr = U(&om_ptr);
    pm_ptr = U(fake_pm);
    fake.player_manager_ptr = U(&pm_ptr);
    set_roster((uint8_t *[]){ NULL });
    recorder_core_init(&fake);

    /* 20: a client joins before the level is up: two welcome lines, the
     * rotation (each sent to two clients) and his session id. The welcome
     * and the rotation are held; the session id is not. */
    for (int c = 0; c < 2; c++) {
        uint8_t w[72]; memset(w, 0, sizeof w);
        int32_t wid = 0; uint32_t len = 22;
        memcpy(w, &wid, 4); memcpy(w + 4, "Welcome to bfstats-lab", 22); memcpy(w + 68, &len, 4);
        evp(1, 0x17, w, sizeof w);
    }
    {
        uint8_t w[72]; memset(w, 0, sizeof w);
        int32_t wid = 1; uint32_t len = 9;
        memcpy(w, &wid, 4); memcpy(w + 4, "be nice!!", 9); memcpy(w + 68, &len, 4);
        evp(1, 0x17, w, sizeof w);
    }
    static const struct { const char *map; int mode; } rot[] = { { "wake", 2 }, { "el_alamein", 4 } };
    for (int c = 0; c < 2; c++)
        for (int i = 0; i < 2; i++) {
            uint8_t m[100]; memset(m, 0, sizeof m);
            m[0] = 1; m[1] = (uint8_t)strlen(rot[i].map); m[2] = 6; m[3] = (uint8_t)rot[i].mode;
            memcpy(m + 4, rot[i].map, strlen(rot[i].map)); memcpy(m + 68, "bf1942", 6);
            evp(1, 0x13, m, sizeof m);
        }
    {
        uint8_t s[64]; memset(s, 0, sizeof s);
        memcpy(s, "_ClientID_3", 11);
        evp(1, 0x37, s, sizeof s);
    }
    usleep(20000);
    uint8_t *tank = mk_template(31, "Tiger");
    uint8_t *a = mk_root(0x2001, 800, tank, 100, 20, 300, 0);
    uint8_t *cpt = calloc(1, 0x300);
    snprintf((char *)cpt + 0x20, 0x60, "%s", "ControlPoint");
    static char village[] = "ALLIES_village";
    *(uint32_t *)(cpt + 0x1e4) = U(village);
    *(float *)(cpt + 0x1f4) = 10; *(float *)(cpt + 0x1f8) = 10;
    uint8_t *cp = calloc(1, 0x200);
    *(uint32_t *)cp = U(vt_cp);
    *(uint32_t *)(cp + 4) = 0x02000000u;
    *(uint32_t *)(cp + 0x48) = 0x3001;
    *(uint32_t *)(cp + 0x4c) = U(cpt);
    *(uint32_t *)(cp + 0x164) = U(cpt);
    place(cp, 400, 30, 500, 0);
    cp_set(cp, 4, 0, 2, 10, 10);
    set_map((uint8_t *[]){ a, cp, NULL });
    fake_om[0] = U(map_header);
    fake_om[1] = 5000;
    ticks(3);
    uint8_t *p5 = mk_player(5, "Alpha", 1, a), *p6 = mk_player(6, "Bravo", 2, 0);

    /* 21: a kick vote: action 1, type 0, by 5 against 6, 1 of 2 */
    {
        uint8_t v[17]; memset(v, 0, sizeof v);
        v[0] = 6; v[1] = 1; v[3] = 2; v[4] = 5;
        float vt = 30; memcpy(v + 5, &vt, 4);
        uint32_t action = 1, type = 0;
        memcpy(v + 9, &action, 4); memcpy(v + 13, &type, 4);
        evp(1, 0x12, v, sizeof v);
    }
    usleep(20000);

    /* 22: the round-end tallies. Player 5's three, each to all and cloned
     * to two clients; bot 6's only to all (no client). Two rows, the rest
     * stale. */
    uint32_t tids[2] = { 3001, 777 };
    uint16_t n5[2] = { 13, 2 }, n6[2] = { 4, 1 };
    for (int type = 0x30; type <= 0x32; type++)
        for (int c = 0; c < 3; c++) ev_stats(c > 0, type, 5, 2, tids, n5, 0xdeadbeef);
    ev_stats(0, 0x31, 6, 1, tids, n6, 3001);
    usleep(20000);

    /* 23: a hit's direction and a refill from the queue, with no hook in:
     * no player named. */
    { uint8_t h[2] = { 2, 0xbf }; evp(1, 0x3c, h, 2); }
    { uint8_t s[1] = { 0 }; evp(1, 0x27, s, 1); }
    usleep(20000);
    /* 24: with the hooks in: two players' hits in one tick, each with his
     * pid, the queue's copy not written; a refill with his pid, type 1 not
     * written, the queue's copy not either. */
    g_hitfrom_hooked = g_special_hooked = 1;
    recorder_on_hit_from(U(p5), 4, 0x40);
    recorder_on_hit_from(U(p6), 4, 0x40);
    { uint8_t h[2] = { 4, 0x40 }; evp(1, 0x3c, h, 2); }
    recorder_on_special(0, U(p6));
    recorder_on_special(1, U(p6));
    { uint8_t s[1] = { 0 }; evp(1, 0x27, s, 1); }
    usleep(20000);
    /* 24b: the spawn screen's choice (the target's hooks pass what he held):
     * player 5 picks group 3 with kit 1; the same again is not written; a
     * new kit is; a bot's group 0 (none) is; a kit byte past 255 is not. */
    recorder_spawn_pick(U(p5), 3, 1, 0, 0);
    recorder_spawn_pick(U(p5), 3, 1, 3, 1);
    recorder_spawn_pick(U(p5), 3, 4, 3, 1);
    recorder_spawn_pick(U(p6), 0, 2, 7, 2);
    recorder_spawn_pick(U(p6), 7, 300, 0, 2);
    usleep(20000);

    /* 25: the events written raw */
    { uint8_t f[2] = { 1, 5 }; evp(0, 0x1e, f, 2); }
    { uint8_t c[2] = { 2, 1 }; evp(0, 0x25, c, 2); }
    { uint8_t o[4] = { 7, 0, 0, 0 }; evp(0, 0x3b, o, 4); }
    { uint8_t k[2] = { 0x34, 0x12 }; evp(1, 0x0e, k, 2); }
    ticks(2);

    /* 26: the board. The roster's counters, each player's once and again
     * when one moves; the points table once, and again when one changes. */
    *(int32_t *)(p5 + 0xc0) = 7; *(int32_t *)(p5 + 0xa4) = 2; *(int32_t *)(p5 + 0xa0) = 1;
    *(int32_t *)(p5 + 0x94) = 48;
    *(int32_t *)(p6 + 0xc0) = -1; *(int32_t *)(p6 + 0xa0) = 1;
    *(int32_t *)(p6 + 0xe8) = 1; *(int32_t *)(p6 + 0xf0) = 2;
    *(uint32_t *)(p5 + 0x68) = 0;
    set_roster((uint8_t *[]){ p5, p6, NULL });
    ticks(2);
    *(int32_t *)(p5 + 0x94) = 52;
    fake_sm[(0x3c + 4 * 3) / 4] = 25;   /* capture */
    ticks(2);
    /* 28: run down (state at once), the timer a tick later not yet, a
     * quarter second on again; lost (cp then cpt); taken by 1; a timer that
     * is not a number; got (cp then cpt). */
    cp_set(cp, 2, 0, 2, 10, 9.5f); ticks(1);
    cp_set(cp, 2, 0, 2, 10, 9.4f); ticks(1);
    usleep(300000);
    cp_set(cp, 2, 0, 2, 10, 7.0f); ticks(2);
    cp_set(cp, 1, 0, 0, 10, 0); ticks(1);
    cp_set(cp, 3, 1, 0, 9.9f, 0); ticks(1);
    cp_set(cp, 3, 1, 0, __builtin_nanf(""), 0); ticks(1);
    usleep(300000);
    cp_set(cp, 3, 1, 0, 9.0f, 0); ticks(1);
    cp_set(cp, 4, 0, 1, 10, 10); ticks(1);

    /* 29-31: two soldiers on foot (5 and 6), a hull with armor and a depot. */
    fake.vt_soldier = U(vt_sol);
    fake.sol_item_off = 0x3b8; fake.sol_items_off = 0x3ac; fake.sol_weapons_off = 0x110;
    fake.fa_mags_off = 0x17c; fake.fa_link_off = 0x2a0; fake.fat_link_off = 0x340; fake.fat_mags_off = 0x234;
    uint8_t *sol_t = mk_template(40, "AxisSoldier");
    uint8_t *s5 = mk_root(0x2101, 900, sol_t, 120, 20, 300, 0), *s6 = mk_root(0x2102, 901, sol_t, 122, 20, 300, 0);
    uint8_t *s5b = calloc(1, 0x500), *s6b = calloc(1, 0x500);   /* a soldier is bigger than mk_root's block */
    memcpy(s5b, s5, 0x200); memcpy(s6b, s6, 0x200); s5 = s5b; s6 = s6b;
    *(uint32_t *)s5 = *(uint32_t *)s6 = U(vt_sol);
    uint8_t *armor6 = give_armor(s6, 40, 100, 0);
    uint8_t *hull = mk_root(0x2103, 810, tank, 140, 20, 300, 0);
    uint8_t *harmor = give_armor(hull, 300, 800, 50);
    uint8_t *depot = mk_root(0x2104, 820, mk_template(41, "SupplyDepot"), 150, 20, 300, 0);
    /* 30: soldier 5 holds item 1, an Mp40 (registry key 9001): three
     * magazines, 30, 30 and 12; soldier 6 item 2, a pistol linked to item 1
     * (setWeaponLink), through which it uses the Mp40's magazines;
     * nothing at all in item 3 (no record). */
    uint8_t *mp40_tt = calloc(1, 0x400), *link_tt = calloc(1, 0x400);
    *(int32_t *)(mp40_tt + 0x340) = -1; *(int32_t *)(mp40_tt + 0x234) = 3;
    *(int32_t *)(link_tt + 0x340) = 1; *(int32_t *)(link_tt + 0x234) = 7;
    uint8_t *gun = calloc(1, 0x400), *linked = calloc(1, 0x400);
    *(uint32_t *)gun = U(vt_hfa); *(uint32_t *)(gun + 0x48) = 9001; *(uint32_t *)(gun + 0x4c) = U(mp40_tt);
    *(uint32_t *)linked = U(vt_hfa); *(uint32_t *)(linked + 0x48) = 9002; *(uint32_t *)(linked + 0x4c) = U(link_tt);
    *(uint32_t *)(linked + 0x2a0) = U(gun);
    int32_t *mags = calloc(4, 4); mags[0] = 30; mags[1] = 30; mags[2] = 12;
    *(uint32_t *)(gun + 0x17c) = U(mags); *(uint32_t *)(gun + 0x180) = U(mags + 3);
    uint32_t *items = calloc(4, 4); items[0] = 0xffffffffu; items[1] = 9001; items[2] = 9002; items[3] = 0xffffffffu;
    uint32_t *weapons = calloc(2, 4); weapons[0] = U(gun); weapons[1] = U(linked);
    for (uint8_t *s = s5; s; s = s == s5 ? s6 : 0) {
        *(uint32_t *)(s + 0x3ac) = U(items); *(uint32_t *)(s + 0x3b0) = U(items + 4);
        *(uint32_t *)(s + 0x110) = U(weapons); *(uint32_t *)(s + 0x114) = U(weapons + 2);
    }
    *(int32_t *)(s5 + 0x3b8) = 1;
    *(int32_t *)(s6 + 0x3b8) = 2;
    *(uint32_t *)(p5 + 0x68) = U(s5); *(uint32_t *)(p6 + 0x68) = U(s6);
    set_map((uint8_t *[]){ a, cp, s5, s6, hull, depot, NULL });
    ticks(2);
    mags[0] = 29; ticks(2);                 /* a round: both soldiers' entries move */
    ticks(2);                               /* nothing moves: no entry */
    *(int32_t *)(s6 + 0x3b8) = 3; ticks(2);   /* an empty slot: no entry */
    *(int32_t *)(link_tt + 0x234) = -1;     /* the linked weapon's own numOfMag -1: unlimited */
    *(int32_t *)(s6 + 0x3b8) = 2; ticks(2);
    /* A pack's swinging count (the wrench's 3000 / 2991): not each swing,
     * where it stands once half a second has passed. */
    mags[0] = 3000; ticks(1);
    mags[0] = 2991; ticks(1);
    usleep(600000);
    ticks(1);
    /* 29: CTF. With the carrier byte named, the queue's FlagHolder copies
     * are not written; player 5's byte set and cleared is two records. */
    fake.bf_flag_off = 0x13c;
    p5[0x13c] = 1; ticks(2);
    { uint8_t f[2] = { 1, 5 }; evp(1, 0x1e, f, 2); }
    ticks(1);
    p5[0x13c] = 0; ticks(2);
    /* 31: heals. Medic 5 heals 6 three times 0.1 s apart and himself once,
     * engineer 5 repairs the hull, the depot heals 6 once and once with no
     * hit points to give; then over a second with none: each visit ends. */
    for (int i = 0; i < 3; i++) { recorder_on_medpack(U(s5), U(s6)); ticks(1); usleep(100000); }
    recorder_on_medpack(U(s5), U(s5));
    recorder_on_repair(U(s5), U(harmor));
    recorder_on_depot_begin(U(s6)); *(float *)(armor6 + 0x38) = 60; recorder_on_depot_end(U(depot), U(s6));
    recorder_on_depot_begin(U(hull)); recorder_on_depot_end(U(depot), U(hull));   /* hit points unchanged */
    ticks(1);
    usleep(1200000);
    ticks(2);
    fake.bf_flag_off = 0; fake.fa_mags_off = 0;
    /* 27: the round's end. setWinner before setGameStatus(2), setVictoryType
     * after it in the same tick: the record carries the type set after. A
     * map's end (5) is written as it comes, with what stands then. */
    ((uint8_t *)fake_sm)[0x5c] = 2;
    ((uint8_t *)fake_sm)[0x5d] = 4;
    ev(0, 0x24, 2);
    ((uint8_t *)fake_sm)[0x5d] = 2;
    ticks(2);
    ev(0, 0x24, 5);
    ticks(1);
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
    if (argc > 1 && !strcmp(argv[1], "hits")) return hits_main();
    if (argc > 1 && !strcmp(argv[1], "events")) return events_main();
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
