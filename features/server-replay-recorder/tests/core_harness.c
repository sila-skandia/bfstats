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
 *
 * run.sh builds it twice: the sampler thread (REC_TICK=0) and the tick
 * capture (REC_TICK=1), and holds both to the same files. `harness live`
 * (tick mode) runs the live set instead of the map walk: a weapon is looked
 * at while it is new, then set aside as scenery, and its pool is written
 * again when the next file opens. It also destroys objects through
 * GameServer::destroyObject's slot: each is one destroyObject record, with
 * or without a client's event for it, and none between files.
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
static void rs(uintptr_t s, char *o, size_t c) { (void)s; (void)c; o[0] = 0; }
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
static uint8_t vt_fa[16], vt_hfa[16], vt_round[16];   /* their addresses are the vptrs */
static uint32_t nid(uintptr_t o) { return *(uint32_t *)o == (uint32_t)(uintptr_t)vt_round ? *(uint32_t *)(o + 0x70) : 0; }
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
static uint32_t map_header[8], map_nodes[4][8];
/* The map holds these objects (up to 4, NULL-terminated). */
static void set_map(uint8_t **objs)
{
    memset(map_nodes, 0, sizeof map_nodes);
    map_header[2] = 0;
    for (int i = 0; i < 4 && objs[i]; i++) {
        map_nodes[i][4] = 0x1000u + (uint32_t)i;                 /* key */
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
    .obj_flags_off = 4, .obj_id_off = 0x48, .obj_tmpl_off = 0x4c, .tmpl_id_off = 0x10,
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
#endif

int main(int argc, char **argv) {
    signal(SIGALRM, on_alarm); alarm(20);
    fake.vt_fire_arms = (uint32_t)(uintptr_t)vt_fa;
    fake.vt_hand_fire_arms = (uint32_t)(uintptr_t)vt_hfa;
#if REC_TICK
    if (argc > 1 && !strcmp(argv[1], "live")) return live_main();
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
