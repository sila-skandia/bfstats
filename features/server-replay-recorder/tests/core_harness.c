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
 *
 * run.sh builds it twice: the sampler thread (REC_TICK=0) and the tick
 * capture (REC_TICK=1), and holds both to the same files.
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
static uint32_t nid(uintptr_t o) { (void)o; return 0; }
static void rs(uintptr_t s, char *o, size_t c) { (void)s; (void)c; o[0] = 0; }
static uint32_t succ(uint32_t n, uint32_t h) { (void)n; return h; }
static void mk(void) { (void)system("mkdir -p replays"); }
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;   /* default: not re-entrant, like lnxded */
static void lk(void) { pthread_mutex_lock(&mu); }
static void ul(void) { pthread_mutex_unlock(&mu); }
static void sl(void) { struct timespec t = {0, 33000000}; nanosleep(&t, 0); }
static int det(void) { return 1; }
static int th(void *(*fn)(void *)) { pthread_t t; pthread_create(&t, 0, fn, 0); pthread_detach(t); return 1; }

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
    .flush_each_line = 1,
    .safe_read = sr, .now_s = now, .net_id_of = nid, .read_string = rs,
    .read_template_name = rs, .tree_successor = succ, .make_replays_dir = mk,
    .rec_lock = lk, .rec_unlock = ul, .rec_sleep = sl, .install_detours = det,
    .start_sampler_thread = th,
};
extern void recorder_on_event(uint32_t ev);
extern void recorder_on_queue_event(uint32_t ev);

/* What lies past an event's payload is its heap neighbours, different for
 * every copy: the recorder must read and compare the payload alone. */
static int payload_len(int type) {
    switch (type) {
        case 0x08: return 45; case 0x16: return 19; case 0x1a: return 51;
        case 0x1b: return 33; case 0x24: return 39; case 0x29: return 8;
        case 0x2a: return 14; default: return 0;
    }
}
static void ev(int queue, int type, int byte0) {
    struct fake_ev e; memset(&e, 0, sizeof e);
    for (int i = payload_len(type); i < (int)sizeof e.payload; i++) e.payload[i] = (uint8_t)rand();
    e.vptr = (uint32_t)(uintptr_t)vtbl; e.type = type; e.payload[0] = (uint8_t)byte0;
    static const char cp1252_name[] = "Julius Haim\xfc" "ller";   /* a bot of El Alamein's */
    if (type == 0x08) memcpy(e.payload + 3, cp1252_name, sizeof cp1252_name);
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

int main(void) {
    signal(SIGALRM, on_alarm); alarm(20);
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
#if REC_TICK
    /* 5: a pointer the sample follows into an unreadable page: the guard
     * cuts that sample short, the server (this process) lives on, and the
     * recording carries on (step 4's events land after it). */
    void *bad = mmap(0, 4096, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    fake_om[0] = (uint32_t)(uintptr_t)bad;
    run_for(100);
    fake_om[0] = 0;
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
