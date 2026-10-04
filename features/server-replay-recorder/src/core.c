/*
 * Server-side round replay recorder -- shared core (see core.h for layout).
 *
 * Captures the whole battlefield from inside the dedicated server as
 * newline-delimited JSON in the bf42plus client recorder's format, played by
 * tools/bf1942-models/viewer/replay-recording.js. Two capture surfaces
 * (stage 3, lnxded today):
 *
 *   1. The world, sampled from the object manager's registered-object map
 *      and the player list: root object transforms, ARMOR hit points, moving
 *      parts (RotationalBundle: turrets, gun mounts, airplane propellers),
 *      engines (revs/gear: the sound note), soldiers' bodies and aim, seats,
 *      bots' AI LOD, control points, projectiles in flight, the animation
 *      state table and the two sides' tickets. REC_TICK=1 (lnxded) samples on
 *      the game thread after a simulated tick (the GameServer::simulateFrame
 *      vtable slot), every tick at 30 Hz; REC_TICK=0 (w32ded) polls from a
 *      sampler thread through safe reads.
 *   2. Inline detours on the game thread capture what the server BUILDS for
 *      clients: GameEventManager::addEventToSendQueue (every game event:
 *      createPlayer with the real kit, pickupKit, enter/exitVehicle, kills
 *      with the weapon, chat, radio, tickets' game flow) and
 *      FireArms::fireBarrel (every round any player or bot fires).
 *
 * Everything about a target's layout is read out of its binary and lives in
 * the target's `struct rec_target` (each field's comment in core.h names the
 * accessor or ctor it was read from; addresses in README.md).
 *
 * Config: <cwd>/mods/bf1942/settings/recorder.con, one key per line:
 *   recordReplays 1        off unless present
 *   replaySampleHz 30      samples per second; tick mode rounds it to a
 *                          whole number of 30 Hz ticks (client recorder: 10)
 * RECORDER_DEBUG=1 in the environment prints one diagnostic line every 5 s.
 * Writes replays/replay_<unixts>[-<n>].ndjson under the server's cwd, one
 * file per round.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>
#include <time.h>

#include "core.h"

#if REC_TICK
#include <pthread.h>
#include <signal.h>
#include <setjmp.h>
#include <unistd.h>
#endif

#if !defined(REC_STAGE3)
#error "build must define REC_STAGE3 (1 = lnxded stage-3 target, 0 = stage-1 w32ded)"
#endif

const struct rec_target *T;

/* --- config ------------------------------------------------------------ */

static volatile int g_on = 0;
static int g_hz = 10;
int g_debug = 0;
volatile int g_hook_active = 0;  /* addEventToSendQueue patched (the lnxded
                                  * detour installer sets it) */

static void read_config(void)
{
    g_debug = getenv("RECORDER_DEBUG") != 0;
    const char *paths[] = {
        "mods/bf1942/settings/recorder.con",
        "recorder.con",
    };
    for (unsigned i = 0; i < sizeof(paths) / sizeof(paths[0]); i++) {
        FILE *f = fopen(paths[i], "r");
        if (!f) continue;
        char line[256];
        while (fgets(line, sizeof(line), f)) {
            char key[128];
            float value = 0.0f;
            if (sscanf(line, " %127s %f", key, &value) != 2) continue;
            for (char *p = key; *p; p++) *p = (char)tolower((unsigned char)*p);
            if (!strcmp(key, "recordreplays")) g_on = value != 0.0f;
            else if (!strcmp(key, "replaysamplehz")) {
                if (value >= 1.0f && value <= 30.0f) g_hz = (int)value;
            }
        }
        fclose(f);
        fprintf(stderr, "recorder: config %s: recordReplays %d, %d Hz\n",
                paths[i], g_on, g_hz);
        return;
    }
    fprintf(stderr, "recorder: no recorder.con; recording off\n");
}

/* --- output ------------------------------------------------------------ */

/* The clock every line shares: 0 at file open, so both writers agree and the
 * viewer's sanity gate (LONGEST_RECORDING, 12 h) stays happy. The sampler
 * seeds g_t0; the game-thread hooks read it (0 until then: they buffer). */
static double g_t0 = 0.0;

/* An ISO-8859-1 byte string as a JSON string's contents, the client
 * recorder's law (bf42plus replay.cpp jsonEscape): a name's high bytes
 * become \u00XX, so the file stays UTF-8 and the viewer's name decoding gets
 * the bytes the server holds ("Julius Haiüller", not a raw 0xfc). */
static void json_escape(const char *in, char *out, size_t cap)
{
    size_t o = 0;
    for (const char *p = in; *p && o + 7 < cap; p++) {
        unsigned char c = (unsigned char)*p;
        if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = c; }
        else if (c < 0x20 || c >= 0x7f) o += (size_t)snprintf(out + o, cap - o, "\\u%04x", c);
        else out[o++] = (char)c;
    }
    out[o] = 0;
}

/* A template's name, ready to sit inside a JSON string. */
static void tmpl_name_json(uintptr_t tmpl, char *out, size_t cap)
{
    char raw[128];
    T->read_template_name(tmpl, raw, sizeof(raw));
    json_escape(raw, out, cap);
}

/* The next file's name: replays/replay_<unix>[-<n>].ndjson, never one on
 * disk (a file split off in the same second as the last one opened must not
 * truncate it) and never one this process already handed out (tick mode
 * names a file before its writer creates it). */
static void next_file_name(char *name, size_t cap)
{
    static long last_ts;
    static int last_n;
    long ts = (long)time(0);
    int n = ts == last_ts ? last_n + 1 : 0;
    for (; n < 100; n++) {
        if (n) snprintf(name, cap, "replays/replay_%ld-%d.ndjson", ts, n);
        else snprintf(name, cap, "replays/replay_%ld.ndjson", ts);
        FILE *exists = fopen(name, "r");
        if (!exists) break;
        fclose(exists);
    }
    last_ts = ts;
    last_n = n;
}

static void header_line(char *out, size_t cap)
{
    char iso[64];
    time_t now = time(0);
    strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%S", localtime(&now));
    snprintf(out, cap,
             "{\"k\":\"h\",\"v\":%d,\"plus\":\"%s\","
             "\"start\":\"%s\",\"hz\":%d}", T->header_version, T->header_plus,
             iso, g_hz);
}

#if REC_TICK

/* Tick mode: every line is made on the game thread (the tick sample, the
 * event and fire hooks) and none of it touches the disk there. Lines go into
 * an in-memory queue; a writer thread swaps it out a few times a second and
 * writes it. Opening and closing a file are markers in the same stream (a
 * line starting \x01; JSON lines never hold a raw control byte), so a split
 * lands between the right two lines. The write lock guards only the queue. */
typedef struct { char *p; size_t n, cap; } Buf;

static Buf g_q[2];          /* g_q[g_qcur] fills, the other drains */
static int g_qcur;
static int g_open;          /* a file is open, as the producer sees it */
static Buf g_sbuf;          /* the current tick sample's lines */
static int g_in_sample;     /* game thread: lines go to g_sbuf */
static pthread_mutex_t g_drain_lock = PTHREAD_MUTEX_INITIALIZER;
static FILE *g_wfile;       /* the writer's file */
static volatile int g_writer_quit;
static volatile uint32_t g_q_dropped;

static void buf_put(Buf *b, const char *s, size_t n)
{
    if (b->n + n > b->cap) {
        size_t cap = b->cap ? b->cap : 1 << 16;
        while (cap < b->n + n) cap *= 2;
        /* 64 MB of undrained lines: the disk is gone; drop rather than grow. */
        if (cap > (64u << 20)) { g_q_dropped++; return; }
        char *p = realloc(b->p, cap);
        if (!p) { g_q_dropped++; return; }
        b->p = p;
        b->cap = cap;
    }
    memcpy(b->p + b->n, s, n);
    b->n += n;
}

static void put_line(Buf *b, const char *line)
{
    buf_put(b, line, strlen(line));
    buf_put(b, "\n", 1);
}

/* With the write lock held: the sample's lines so far go to the queue (a
 * file open or close must come after them). */
static void sbuf_commit_locked(void)
{
    if (g_sbuf.n) buf_put(&g_q[g_qcur], g_sbuf.p, g_sbuf.n);
    g_sbuf.n = 0;
}

static int file_is_open(void) { return g_open; }

static void file_open_locked(void)
{
    sbuf_commit_locked();
    char name[256], line[512];
    next_file_name(name, sizeof(name));
    snprintf(line, sizeof(line), "\x01O%s", name);
    put_line(&g_q[g_qcur], line);
    header_line(line, sizeof(line));
    put_line(&g_q[g_qcur], line);
    g_open = 1;
    fprintf(stderr, "recorder: recording to %s\n", name);
}

static void file_close_locked(double t)
{
    sbuf_commit_locked();
    if (!g_open) return;
    char line[64];
    snprintf(line, sizeof(line), "{\"k\":\"end\",\"t\":%.3f}", t);
    put_line(&g_q[g_qcur], line);
    put_line(&g_q[g_qcur], "\x01" "C");
    g_open = 0;
}

static void write_line_locked(const char *line)
{
    if (!g_open) return;
    put_line(g_in_sample ? &g_sbuf : &g_q[g_qcur], line);
}

static void write_line(const char *line)
{
    if (g_in_sample) {   /* game thread, inside the sample: no lock needed */
        if (g_open) put_line(&g_sbuf, line);
        return;
    }
    T->rec_lock();
    write_line_locked(line);
    T->rec_unlock();
}

/* The writer: one drained buffer, file markers acted on in order. */
static void drain_buffer(Buf *b)
{
    size_t i = 0;
    while (i < b->n) {
        if (b->p[i] == '\x01') {
            char *nl = memchr(b->p + i, '\n', b->n - i);
            size_t end = nl ? (size_t)(nl - b->p) : b->n;
            if (b->p[i + 1] == 'O') {
                char name[256];
                size_t len = end - (i + 2);
                if (len >= sizeof(name)) len = sizeof(name) - 1;
                memcpy(name, b->p + i + 2, len);
                name[len] = 0;
                if (g_wfile) fclose(g_wfile);
                T->make_replays_dir();
                g_wfile = fopen(name, "w");
                if (!g_wfile) fprintf(stderr, "recorder: cannot open %s\n", name);
            } else if (b->p[i + 1] == 'C') {
                if (g_wfile) fclose(g_wfile);
                g_wfile = 0;
            }
            i = end + 1;
            continue;
        }
        char *m = memchr(b->p + i, '\x01', b->n - i);
        size_t end = m ? (size_t)(m - b->p) : b->n;
        if (g_wfile) fwrite(b->p + i, 1, end - i, g_wfile);
        i = end;
    }
    b->n = 0;
    if (g_wfile) fflush(g_wfile);
}

/* Swap the queue out and write it. g_drain_lock keeps the exit drain and
 * the writer thread from interleaving. */
static void drain_once(void)
{
    pthread_mutex_lock(&g_drain_lock);
    T->rec_lock();
    int full = g_qcur;
    g_qcur ^= 1;
    T->rec_unlock();
    drain_buffer(&g_q[full]);
    pthread_mutex_unlock(&g_drain_lock);
}

static void *writer(void *arg)
{
    (void)arg;
    while (!g_writer_quit) {
        const struct timespec quarter = { 0, 250000000L };
        nanosleep(&quarter, 0);
        drain_once();
    }
    return 0;
}

#else /* !REC_TICK: the sampler thread and the hooks write the file */

static FILE *g_file = 0;

static int file_is_open(void) { return g_file != 0; }

static void file_open_locked(void)
{
    (void)T->make_replays_dir();
    char name[256], line[512];
    next_file_name(name, sizeof(name));
    g_file = fopen(name, "w");
    if (!g_file) {
        fprintf(stderr, "recorder: cannot open %s\n", name);
        return;
    }
    header_line(line, sizeof(line));
    fprintf(g_file, "%s\n", line);
    fprintf(stderr, "recorder: recording to %s\n", name);
}

/* With the write lock held (it is not re-entrant on lnxded: anything that
 * already holds it writes through here, never through write_line). */
static void write_line_locked(const char *line)
{
    if (g_file) {
        fputs(line, g_file);
        fputc('\n', g_file);
        if (T->flush_each_line) fflush(g_file);
    }
}

static void file_close_locked(double t)
{
    if (!g_file) return;
    char line[64];
    snprintf(line, sizeof(line), "{\"k\":\"end\",\"t\":%.3f}", t);
    write_line_locked(line);
    fflush(g_file);
    fclose(g_file);
    g_file = 0;
}

static void write_line(const char *line)
{
    T->rec_lock();
    write_line_locked(line);
    T->rec_unlock();
}

#endif /* REC_TICK */

/* Everything written so far, on disk now. */
static void out_sync(void)
{
#if REC_TICK
    drain_once();
    drain_once();   /* the other buffer too, if the writer swapped meanwhile */
#else
    T->rec_lock();
    if (g_file) fflush(g_file);
    T->rec_unlock();
#endif
}

/* --- reads ------------------------------------------------------------------- */

#if REC_TICK
/* Set by the tick sample, on the game thread, inside the fault guard: the
 * world is the game thread's and stands still while it reads, so a plain
 * load is exact; a bad pointer faults into the guard, not the server. */
static int g_direct;
#endif

static int rd(void *dst, size_t len, uintptr_t addr)
{
#if REC_TICK
    if (g_direct) {
        if (addr < 0x1000) return 0;
        memcpy(dst, (const void *)addr, len);
        return 1;
    }
#endif
    return T->safe_read(dst, len, addr);
}

uint32_t read_u32(uintptr_t addr)
{
    uint32_t v = 0;
    rd(&v, 4, addr);
    return v;
}

/* A NUL-terminated string's bytes at `chars` (an SGI std::string's one
 * pointer), read through rd: a direct read in the tick sample. */
static void read_chars(uintptr_t chars, char *out, size_t cap)
{
    out[0] = 0;
    if (chars < 0x1000 || cap < 2) return;
    size_t n = 0;
    while (n + 1 < cap) {
        char c;
        if (!rd(&c, 1, chars + n) || !c) break;
        out[n++] = c;
    }
    out[n] = 0;
}

/* --- transforms ------------------------------------------------------------ */

typedef struct { float a[4], b[4], c[4], p[4]; } Mat4;

/* Quaternion from the transform's rows a/b/c (the client recorder's law,
 * bf42plus replay.cpp toQuat). */
static void to_quat(const Mat4 *m, float *q)
{
    float m00 = m->a[0], m01 = m->a[1], m02 = m->a[2];
    float m10 = m->b[0], m11 = m->b[1], m12 = m->b[2];
    float m20 = m->c[0], m21 = m->c[1], m22 = m->c[2];
    float trace = m00 + m11 + m22;
    if (trace > 0.0f) {
        float s = 2.0f * (float)sqrt((double)trace + 1.0f);
        q[3] = 0.25f * s;
        q[0] = (m12 - m21) / s;
        q[1] = (m20 - m02) / s;
        q[2] = (m01 - m10) / s;
    } else if (m00 > m11 && m00 > m22) {
        float s = 2.0f * (float)sqrt(1.0 + (double)m00 - (double)m11 - (double)m22);
        q[3] = (m12 - m21) / s;
        q[0] = 0.25f * s;
        q[1] = (m10 + m01) / s;
        q[2] = (m20 + m02) / s;
    } else if (m11 > m22) {
        float s = 2.0f * (float)sqrt(1.0 + (double)m11 - (double)m00 - (double)m22);
        q[3] = (m20 - m02) / s;
        q[0] = (m10 + m01) / s;
        q[1] = 0.25f * s;
        q[2] = (m21 + m12) / s;
    } else {
        float s = 2.0f * (float)sqrt(1.0 + (double)m22 - (double)m00 - (double)m11);
        q[3] = (m01 - m10) / s;
        q[0] = (m20 + m02) / s;
        q[1] = (m21 + m12) / s;
        q[2] = 0.25f * s;
    }
}

#if REC_STAGE3

static void quat_conj(float *o, const float *q)
{
    o[0] = -q[0]; o[1] = -q[1]; o[2] = -q[2]; o[3] = q[3];
}

static void quat_mul(float *o, const float *a, const float *b)
{
    o[0] = a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1];
    o[1] = a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0];
    o[2] = a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3];
    o[3] = a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2];
}

/* A point in m's own frame: its offset from m's position on m's rows. */
static void local_pos(const Mat4 *m, const float *p, float *out)
{
    float dx = p[0] - m->p[0], dy = p[1] - m->p[1], dz = p[2] - m->p[2];
    out[0] = dx * m->a[0] + dy * m->a[1] + dz * m->a[2];
    out[1] = dx * m->b[0] + dy * m->b[1] + dz * m->b[2];
    out[2] = dx * m->c[0] + dy * m->c[1] + dz * m->c[2];
}

/* The root of `obj`'s parent chain: parent at obj_parent_off (getRootParent
 * 0x0818d4b0), root flag byte at obj+7 bit 1. Bounded walk. */
static uintptr_t root_of(uintptr_t obj)
{
    uintptr_t root = obj;
    for (int depth = 0; depth < 32; depth++) {
        if ((read_u32(root + 4) & 0x02000000u) || root < 0x1000) break;
        uintptr_t parent = read_u32(root + T->obj_parent_off);
        if (parent < 0x1000) break;
        root = parent;
    }
    return root;
}

#endif /* REC_STAGE3 */

/* --- objects --------------------------------------------------------------- */

/* Every root object the map holds (Wake: ~4.6k registered). State persists
 * across samples; a per-sample generation marks who was seen. */
#define MAX_TRACKED 8192
#define FLAG_ROOT 0x02000000u   /* byte at obj+7 bit 1 (getRootParent 0x0818d4b0) */
#define FLAG_DISABLED 1u

typedef struct {
    uint32_t key; /* the registered map's key (the gid) */
    uint32_t nid; /* the networkable's id: what the viewer's ids are
                   * (a stage-1 target without a net-id read keys on the
                   * map key) */
    uint32_t gen;
    float x, y, z, qx, qy, qz, qw;
#if REC_STAGE3
    int has_armor;
    uintptr_t armor_ptr;   /* the Armor component, found once (components map) */
    float hp;
    int32_t last_hit;
#endif
} Tracked;

static Tracked *g_tracked;
static int g_tracked_n;
static uint32_t g_gen;

/* Open-addressing index over g_tracked, keyed by key (linear probe). */
#define HASH_SLOTS (MAX_TRACKED * 2)
static int32_t *g_hash; /* -1 empty, else index into g_tracked */

static void hash_rebuild(void)
{
    memset(g_hash, 0xff, sizeof(int32_t) * HASH_SLOTS);
    for (int i = 0; i < g_tracked_n; i++) {
        uint32_t h = (g_tracked[i].key * 0x9e3779b9u) & (HASH_SLOTS - 1);
        for (uint32_t j = h; ; j = (j + 1) & (HASH_SLOTS - 1))
            if (g_hash[j] < 0) { g_hash[j] = (int32_t)i; break; }
    }
}

static int hash_find(uint32_t key, uint32_t h)
{
    for (uint32_t i = h; ; i = (i + 1) & (HASH_SLOTS - 1)) {
        int32_t e = g_hash[i];
        if (e < 0) return -1;
        if (g_tracked[e].key == key) return e;
    }
}

static void hash_insert(uint32_t key, int idx, uint32_t h)
{
    (void)key;
    for (uint32_t i = h; ; i = (i + 1) & (HASH_SLOTS - 1))
        if (g_hash[i] < 0) { g_hash[i] = (int32_t)idx; return; }
}

static uint32_t hash_of(uint32_t key)
{
    return (key * 0x9e3779b9u) & (HASH_SLOTS - 1);
}

#if REC_STAGE3

/* --- stage 3: an SGI-STL rb-tree find --------------------------------------- */

/* ObjectTemplateManager's map for scalar keys: header-node pointer at
 * `mapaddr`, node count at mapaddr+4; a node: color 0, parent +4, left +8,
 * right +0xc, pair key +0x10, value +0x14. Returns the node's VALUE for
 * `key`, or 0. Bounded to the map's count + 8. (The SGI map-object shape;
 * an MSVC map object is laid out differently -- parameterize here when the
 * w32ded stage-3 port needs it.) */
static uintptr_t rbtree_find_value(uintptr_t mapaddr, uint32_t key);

static uintptr_t template_by_id(uint32_t tid)
{
    uint32_t mgr = read_u32(T->template_manager_ptr);
    if (mgr < 0x1000) return 0;
    return rbtree_find_value(mgr + 8, tid);
}

static void template_name_by_id(uint32_t tid, char *out, size_t cap)
{
    out[0] = 0;
    if (tid == 0 || tid > 0x00ffffff) return;
    uintptr_t tmpl = template_by_id(tid);
    if (tmpl < 0x1000) return;
    T->read_template_name(tmpl, out, cap);   /* ObjectTemplate::getName 0x081d4c60 */
}

static uintptr_t rbtree_find_value(uintptr_t mapaddr, uint32_t key)
{
    /* Both shapes agree on the first two dwords ({header-node ptr, count})
     * and on the root being header+4. The rest goes through the table's node
     * offsets: SGI {color,parent,left,right,key+0x10,val+0x14} vs MSVC
     * {_Left,_Parent,_Right,key+0xc,val+0x10,_Isnil +0x15}. */
    uint32_t header = read_u32(mapaddr);
    if (header < 0x1000) return 0;
    uint32_t count = read_u32(mapaddr + 4);
    if (count > 100000) return 0;
    uint32_t node = read_u32(header + 4);       /* root */
    uint32_t steps = count + 16;
    while (node >= 0x1000 && steps--) {
        if (T->node_isnil_off && (read_u32(node + T->node_isnil_off) & 1)) break;
        if (node == header) break;
        uint32_t nkey = read_u32(node + T->node_key_off);
        if (nkey == key) return read_u32(node + T->node_value_off);
        node = key < nkey ? read_u32(node + T->node_left_off)
                          : read_u32(node + T->node_right_off);
    }
    return 0;
}

/* --- armor ----------------------------------------------------------------- */

/* Armor holds an object's hit points. The getters read the same offsets as
 * the client's: getHitPoints 0x08173f30 +0x38, getMaxHitPoints 0x08173f20
 * +0x3c, getCriticalDamage 0x081741b0 +0xf0, getLastHitPlayer 0x081740d0
 * +0x14. The Armor component itself is found in the object's component map,
 * the rb-tree at obj_compmap_off (BObject<ICompositeObject>::queryComponent
 * 0x08193fd0's fallback: key armor_iid, SmartPtr value at node+0x14) -- read
 * directly, no virtual call from a thread that is not the game's. */

typedef struct {
    float hitPoints;
    float maxHitPoints;
    float criticalDamage;
    int32_t lastHitPlayer;
} ArmorFields;

static int read_armor_at(uintptr_t armor, ArmorFields *out)
{
    memset(out, 0, sizeof(*out));
    if (armor < 0x1000) return 0;
    return rd(&out->hitPoints, 4, armor + T->armor_hp_off)
        && rd(&out->maxHitPoints, 4, armor + T->armor_maxhp_off)
        && rd(&out->criticalDamage, 4, armor + T->armor_crit_off)
        && rd(&out->lastHitPlayer, 4, armor + T->armor_lasthit_off);
}

/* The Armor component, looked up once per object (the pointer lives as long
 * as the object does; the object is gone from the map before it frees). */
static uintptr_t find_armor(uintptr_t obj)
{
    return rbtree_find_value(obj + T->obj_compmap_off, T->armor_iid);
}

/* --- moving parts (v5: jn / j / g lines) ------------------------------------ */

/* A child bundle's own id, numbered once per file: its networkable has no id
 * (getID() 0 for every child; a v4 file keyed them all 0). Keyed by object
 * pointer, re-keyed when the root or the template changes -- an address the
 * allocator handed to an object under another root is a new part. */
#define MAX_PARTS 4096

/* One part and its last written state. The id is a label in the file, so it
 * may grow without bound (every respawned vehicle's parts get new ones); the
 * state lives in the slot, not in an array indexed by id. */
typedef struct {
    uintptr_t obj;
    uint32_t root_nid;
    uintptr_t tmpl;
    int id;
    uint32_t gen;          /* the last sample that saw it */
    int has_j, has_g;      /* a j / g line has been written for this id */
    float qx, qy, qz, qw;  /* the last j */
    float revs, throttle;  /* the last g */
    int gear, eflags;
} Part;

static Part *g_parts;
static int g_parts_n;
static int g_next_part_id = 1;

/* The part for `obj`, re-keyed (a new id) when the root or the template
 * changed under that address. NULL when the table is full of live parts. */
/* Index over g_parts by object pointer (slot + 1; 0 empty): a part is
 * looked up every sample, a linear scan of a few hundred parts each time is
 * O(parts^2) a sample. Rebuilt whenever slots move. */
#define PART_IDX_SLOTS 8192
static uint16_t g_part_idx[PART_IDX_SLOTS];

static uint32_t part_hash(uintptr_t obj) { return ((uint32_t)obj * 0x9e3779b1u) >> 19; }

static void part_idx_rebuild(void)
{
    memset(g_part_idx, 0, sizeof(g_part_idx));
    for (int i = 0; i < g_parts_n; i++) {
        uint32_t h = part_hash(g_parts[i].obj);
        while (g_part_idx[h]) h = (h + 1) & (PART_IDX_SLOTS - 1);
        g_part_idx[h] = (uint16_t)(i + 1);
    }
}

static Part *part_of(uintptr_t obj, uint32_t root_nid, uintptr_t tmpl, uint32_t gen, int *first)
{
    *first = 0;
    uint32_t h = part_hash(obj);
    for (; g_part_idx[h]; h = (h + 1) & (PART_IDX_SLOTS - 1)) {
        Part *p = &g_parts[g_part_idx[h] - 1];
        if (p->obj != obj) continue;
        if (p->root_nid != root_nid || p->tmpl != tmpl) {
            memset(p, 0, sizeof(*p));
            p->obj = obj;
            p->root_nid = root_nid;
            p->tmpl = tmpl;
            p->id = g_next_part_id++;
            *first = 1;
        }
        p->gen = gen;
        return p;
    }
    if (g_parts_n >= MAX_PARTS) return 0;
    Part *p = &g_parts[g_parts_n++];
    memset(p, 0, sizeof(*p));
    p->obj = obj;
    p->root_nid = root_nid;
    p->tmpl = tmpl;
    p->id = g_next_part_id++;
    p->gen = gen;
    g_part_idx[h] = (uint16_t)g_parts_n;
    *first = 1;
    return p;
}

/* Drop the slots of parts not seen for about five seconds of samples. */
static void parts_prune(uint32_t gen)
{
    uint32_t stale = (uint32_t)(5 * g_hz);
    int w = 0;
    for (int i = 0; i < g_parts_n; i++) {
        if (gen - g_parts[i].gen > stale) continue;
        if (w != i) g_parts[w] = g_parts[i];
        w++;
    }
    if (w != g_parts_n) {
        g_parts_n = w;
        part_idx_rebuild();
    }
}

static void parts_reset(void)
{
    g_parts_n = 0;
    g_next_part_id = 1;
    part_idx_rebuild();
}

/* --- soldiers (st lines) ---------------------------------------------------- */

#define MAX_SOLDIERS 128

typedef struct {
    uint32_t nid;
    int lower, upper, item, bits;
    float pitch, twist;
    int seen;
} SoldierTracked;

static SoldierTracked g_soldiers[MAX_SOLDIERS];
static int g_soldiers_n;
static int g_anim_written;

/* The animation state table, once per file: [index, name, flags], what the
 * client recorder writes from its own copy (the indices are the same: a
 * server state number mapped through a client file's table names the right
 * pose, 2026-10-04). activeAnimationStateMachine holds the states in a
 * vector at asm_states_off (getState 0x083285b0) with each state's flags at
 * state_flags_off (getCurrentStateFlags 0x0832b110), and their names in the
 * std::map<string,int> findState 0x08328610 searches at asm_names_off: an SGI
 * map (header pointer, count), a node's key string at +0x10 and its index at
 * +0x14. */
static void write_anim_states(double t)
{
    if (!T->anim_asm_ptr) return;
    uint32_t sm = read_u32(T->anim_asm_ptr);
    if (sm < 0x1000) return;
    uint32_t vb = read_u32(sm + T->asm_states_off);
    uint32_t ve = read_u32(sm + T->asm_states_off + 4);
    if (vb < 0x1000 || ve < vb || (ve - vb) / 4 > 8192) return;
    uint32_t nstates = (ve - vb) / 4;
    uint32_t header = read_u32(sm + T->asm_names_off);
    uint32_t count = read_u32(sm + T->asm_names_off + 4);
    if (header < 0x1000 || count > 8192) return;
    size_t cap = 64 + (size_t)count * 96;
    char *line = malloc(cap);
    if (!line) return;
    size_t n = (size_t)snprintf(line, cap, "{\"k\":\"anim\",\"t\":%.3f,\"states\":[", t);
    int first = 1;
    uint32_t node = read_u32(header + T->node_leftmost_off);
    for (uint32_t steps = 0; node && node != header && steps < count + 16; steps++) {
        uint32_t idx = read_u32(node + T->node_value_off);
        char raw[80], esc[200];
        read_chars(read_u32(node + T->node_key_off), raw, sizeof(raw));
        uint32_t flags = 0;
        if (idx < nstates) {
            uint32_t st = read_u32(vb + idx * 4);
            if (st >= 0x1000) flags = read_u32(st + T->state_flags_off);
        }
        json_escape(raw, esc, sizeof(esc));
        if (raw[0] && n + 160 < cap)
            n += (size_t)snprintf(line + n, cap - n, "%s[%u,\"%s\",%u]", first ? "" : ",", idx, esc, flags);
        first = 0;
        node = T->tree_successor(node, header);
    }
    snprintf(line + n, cap - n, "]}");
    write_line(line);
    free(line);
}

/* --- kits -------------------------------------------------------------------- */

/* Kit objects a real event named but the root-only pass cannot see (a kit is
 * a child of its soldier until dropped): net ids to emit an `o` record for
 * when the registered map hands us the object. */
#define MAX_KIT_WATCH 256

typedef struct { uint32_t nid; int done; } KitWatch;
static KitWatch g_kit_watch[MAX_KIT_WATCH];
static int g_kit_watch_n;

/* Called from both threads (the sampler's synthesised pickups, the game
 * thread's real events): the write lock orders it against kit_watch_compact. */
static void kit_watch_add(uint32_t nid)
{
    if (!nid) return;
    T->rec_lock();
    int i = 0;
    for (; i < g_kit_watch_n; i++)
        if (g_kit_watch[i].nid == nid) { g_kit_watch[i].done = 0; break; }
    if (i == g_kit_watch_n && g_kit_watch_n < MAX_KIT_WATCH) {
        g_kit_watch[g_kit_watch_n].nid = nid;
        g_kit_watch[g_kit_watch_n].done = 0;
        g_kit_watch_n++;
    }
    T->rec_unlock();
}

/* Drop the kits already emitted (sampler thread, once a sample): the table
 * fills with every spawn of the round otherwise, and late spawns go
 * undressed. */
static void kit_watch_compact(void)
{
    T->rec_lock();
    int w = 0;
    for (int i = 0; i < g_kit_watch_n; i++) {
        if (g_kit_watch[i].done) continue;
        if (w != i) g_kit_watch[w] = g_kit_watch[i];
        w++;
    }
    g_kit_watch_n = w;
    T->rec_unlock();
}

static int kit_watch_pending(uint32_t nid)
{
    for (int i = 0; i < g_kit_watch_n; i++)
        if (!g_kit_watch[i].done && g_kit_watch[i].nid == nid) return 1;
    return 0;
}

#endif /* REC_STAGE3 */

static double g_t;   /* the current sample's stamp */

/* --- fast number formatting --------------------------------------------------- */

/* The per-sample entries are numbers, thirty times a second for every moving
 * object; printf's float conversion was most of a sample's cost once the
 * walk was gone. These write what "%u", "%d" and "%.Nf" would, byte for
 * byte (a non-finite value as 0). */
static char *put_u(char *o, uint32_t v)
{
    char tmp[12];
    int n = 0;
    do { tmp[n++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (n) *o++ = tmp[--n];
    return o;
}

static char *put_i(char *o, int32_t v)
{
    if (v < 0) { *o++ = '-'; return put_u(o, (uint32_t)(-(int64_t)v)); }
    return put_u(o, (uint32_t)v);
}

static char *put_f(char *o, float fv, int dec)
{
    static const int64_t pow10[] = { 1, 10, 100, 1000, 10000, 100000 };
    double v = fv;
    if (!(v == v) || v > 1e9 || v < -1e9) v = 0.0;   /* NaN, inf */
    int neg = v < 0.0 || (v == 0.0 && 1.0 / v < 0.0);
    if (neg) v = -v;
    /* A float times 10^dec (dec <= 4) is exact in a double, so a tie is
     * exactly .5 and rounds to even, as printf does. */
    double x = v * (double)pow10[dec];
    int64_t scaled = (int64_t)x;
    double frac = x - (double)scaled;
    if (frac > 0.5 || (frac == 0.5 && (scaled & 1))) scaled++;
    int64_t ip = scaled / pow10[dec], fp = scaled % pow10[dec];
    if (neg) *o++ = '-';
    o = put_u(o, (uint32_t)ip);
    if (dec) {
        *o++ = '.';
        for (int k = dec - 1; k >= 0; k--) { o[k] = (char)('0' + fp % 10); fp /= 10; }
        o += dec;
    }
    return o;
}

/* --- batched records ---------------------------------------------------------- */

/* One line per kind per sample, the client recorder's shape:
 * {"k":"s","t":..,"o":[[...],[...]]}. A kind's entries flush at the end of
 * the sample, or early once the line passes ACC_FLUSH bytes. */
#define ACC_FLUSH (48 * 1024)

typedef struct { const char *k, *arr; char *p; size_t n, cap; } Acc;

static Acc g_acc_s = { "s", "o", 0, 0, 0 };
static Acc g_acc_a = { "a", "a", 0, 0, 0 };
#if REC_STAGE3
static Acc g_acc_j = { "j", "o", 0, 0, 0 };
static Acc g_acc_g = { "g", "o", 0, 0, 0 };
static Acc g_acc_st = { "st", "o", 0, 0, 0 };
static Acc g_acc_p = { "p", "p", 0, 0, 0 };
static Acc g_acc_lod = { "lod", "o", 0, 0, 0 };
static Acc g_acc_pj = { "pj", "o", 0, 0, 0 };
#endif

static void acc_flush(Acc *a)
{
    if (!a->n) return;
    size_t cap = a->n + 96;
    char *line = malloc(cap);
    if (line) {
        int head = snprintf(line, cap, "{\"k\":\"%s\",\"t\":%.3f,\"%s\":[", a->k, g_t, a->arr);
        memcpy(line + head, a->p, a->n);
        memcpy(line + head + a->n, "]}", 3);
        write_line(line);
        free(line);
    }
    a->n = 0;
}

static void acc_add(Acc *a, const char *entry)
{
    size_t len = strlen(entry);
    if (a->n + len + 2 > a->cap) {
        size_t cap = a->cap ? a->cap * 2 : 4096;
        while (cap < a->n + len + 2) cap *= 2;
        char *p = realloc(a->p, cap);
        if (!p) return;
        a->p = p;
        a->cap = cap;
    }
    if (a->n) a->p[a->n++] = ',';
    memcpy(a->p + a->n, entry, len);
    a->n += len;
    if (a->n > ACC_FLUSH) acc_flush(a);
}

static void acc_flush_all(void)
{
    acc_flush(&g_acc_s);
    acc_flush(&g_acc_a);
#if REC_STAGE3
    acc_flush(&g_acc_j);
    acc_flush(&g_acc_g);
    acc_flush(&g_acc_st);
    acc_flush(&g_acc_p);
    acc_flush(&g_acc_lod);
    acc_flush(&g_acc_pj);
#endif
}
static void sample_object(uint32_t key, uint32_t obj);
#if REC_STAGE3
static uint32_t g_score_manager;   /* ScoreManager found by vtable (sample_tickets) */
#endif

#if REC_STAGE3

/* The watched kit object, emitted as its own o record even while DISABLED
 * (a carried kit is disabled until dropped): the viewer needs its template
 * to dress the soldier. */
static void kit_watch_emit(uint32_t obj, uint32_t nid, uint32_t key)
{
    for (int i = 0; i < g_kit_watch_n; i++) {
        if (g_kit_watch[i].done || g_kit_watch[i].nid != nid) continue;
        uint32_t tmpl = read_u32(obj + T->obj_tmpl_off);
        char name[128];
        tmpl_name_json(tmpl, name, sizeof(name));
        uint32_t tid = tmpl > T->min_tmpl_addr ? read_u32(tmpl + T->tmpl_id_off) : 0;
        Mat4 m;
        float q[4] = {0, 0, 0, 1};
        float px = 0, py = 0, pz = 0;
        if (rd(&m, sizeof(m), obj + T->obj_mat_off)) {
            to_quat(&m, q);
            px = m.p[0]; py = m.p[1]; pz = m.p[2];
        }
        char line[512];
        snprintf(line, sizeof(line),
            "{\"k\":\"o\",\"t\":%.3f,\"id\":%u,\"gid\":%u,\"tmpl\":\"%s\",\"tid\":%u"
            ",\"pos\":[%.2f,%.2f,%.2f],\"rot\":[%.3f,%.3f,%.3f,%.3f]}",
            g_t, nid, key, name, tid, px, py, pz, q[0], q[1], q[2], q[3]);
        write_line(line);
        g_kit_watch[i].done = 1;
        return;
    }
}

/* --- players --------------------------------------------------------------- */

#define MAX_PLAYERS 64

typedef struct {
    int pid;
    uint32_t soldier_nid;
    uint32_t kit_nid;
    int team;
    int missing;   /* consecutive complete roster walks without him */
    char name[64]; /* raw, as the server holds it */
    /* the last p entry written: [pid, team, vehicle, root, seat, triggers] */
    int p_written;
    uint32_t p_vehicle, p_root;
    int p_seat, p_trig, p_team;
    int lod;       /* the last AI LOD written; -2 none yet */
    uint32_t bf, name_ptr;   /* the BFPlayer and its name string, when name was read */
} Plyr;

/* Complete roster walks a player may be absent from before he is written as
 * gone: one missed walk can be a list rebuilt under the reader. */
#define PLAYER_GONE_WALKS 3

static Plyr *g_players;
static int g_players_n;
static int g_level_written;
static int g_player_dump_done;

/* --- tickets ------------------------------------------------------------------ */

/* ScoreManager: the global `dice::ref2::world::scoreManager` 0x0871bb58
 * (getTeamScore 0x081616c0 = this + 0x10 + team*0x50; the live count at
 * TeamScore+0x48, TeamScore::setTickets 0x081610a0). */
static int g_tickets[2] = { -1, -1 };

/* ScoreManager instance, found in the registered map by vtable
 * (vtable for dice::ref2::world::ScoreManager 0x0871c000 + 8). */
static uint32_t g_score_manager = 0;

static void sample_tickets(double t)
{
    /* The global may hold the manager or a pointer to it; accept either. */
    uint32_t at = read_u32(T->score_manager_ptr);
    uint32_t mgr = 0;
    if (at >= 0x1000 && read_u32(at) == T->vt_score_manager) mgr = at;
    else if (read_u32(T->score_manager_ptr) == T->vt_score_manager) mgr = T->score_manager_ptr;
    if (!mgr) {
        static int sm_dumped;
        if (g_debug && !sm_dumped++) {
            fprintf(stderr, "recorder dbg: scoremgr %08x vtbl %08x (expect %08x)\n",
                    at, at >= 0x1000 ? read_u32(at) : 0, T->vt_score_manager);
            /* walk the team array anyway: which offsets hold live tickets */
            if (at >= 0x1000) {
                fprintf(stderr, "recorder dbg: sm dwords:");
                for (int w = 0; w < 0xb0; w += 4)
                    fprintf(stderr, " +%x=%08x", w, read_u32(at + w));
                fprintf(stderr, "\n");
            }
        }
        return;
    }
    int t1 = (int)read_u32(mgr + T->score_base_off + 1 * T->score_stride_off + T->score_tickets_off);
    int t2 = (int)read_u32(mgr + T->score_base_off + 2 * T->score_stride_off + T->score_tickets_off);
    if (t1 == g_tickets[0] && t2 == g_tickets[1]) return;
    g_tickets[0] = t1;
    g_tickets[1] = t2;
    char line[160];
    snprintf(line, sizeof(line), "{\"k\":\"tk\",\"t\":%.3f,\"v\":[%d,%d]}", t, t1, t2);
    write_line(line);
}

#endif /* REC_STAGE3 */

/* --- sampling: one registered object ------------------------------------------ */

/* One registered object: `key` is its key in the registered-objects map
 * (its gid, obj+0x48). */
static void sample_object(uint32_t key, uint32_t obj)
{
    if (!obj || obj < T->min_addr) return;

    uint32_t flags = read_u32(obj + T->obj_flags_off);
    if (flags & FLAG_DISABLED) return;

    uint32_t nid = T->net_id_of(obj);
    /* The record's id: the networkable's id, or -- for a target without a
     * net-id read (w32ded stage 1) -- the registered map's key, which is the
     * object's own gid. */
    uint32_t id = nid ? nid : key;

    /* Root pass: transforms and armor. */
    int is_root = (flags & FLAG_ROOT) != 0;
    if (is_root) {
#if REC_STAGE3
        /* The replicated ScoreManager registers as a world object: found by
         * vtable, the tickets read off it (sample_tickets). */
        uint32_t vptr = read_u32(obj);
        if (vptr == T->vt_score_manager) g_score_manager = obj;   /* legacy find path */
#endif
        if (!id) return;
        Mat4 m;
        if (!rd(&m, sizeof(m), obj + T->obj_mat_off)) return;

        float q[4];
        to_quat(&m, q);

        int ti = hash_find(key, hash_of(key));
        if (ti < 0) {
            if (g_tracked_n >= MAX_TRACKED) return;
            /* First sight: the template's name (a string read the target
             * may make through a system call) only here, not every sample. */
            uint32_t tmpl = read_u32(obj + T->obj_tmpl_off);
            char name[128];
            tmpl_name_json(tmpl, name, sizeof(name));
            uint32_t tid = tmpl > T->min_tmpl_addr ? read_u32(tmpl + T->tmpl_id_off) : 0;
#if REC_STAGE3
            uint32_t gid = key;   /* the registered map's key: obj+0x48 (registerObject 0x0819b4a0) */
#else
            uint32_t gid = read_u32(obj + T->obj_id_off);
#endif
            ti = g_tracked_n++;
            g_tracked[ti].key = key;
            g_tracked[ti].nid = id;
            hash_insert(key, ti, hash_of(key));
            Tracked *tr = &g_tracked[ti];
            tr->x = m.p[0]; tr->y = m.p[1]; tr->z = m.p[2];
            tr->qx = q[0]; tr->qy = q[1]; tr->qz = q[2]; tr->qw = q[3];
            tr->gen = g_gen;
#if REC_STAGE3
            tr->armor_ptr = find_armor(obj);
            ArmorFields armor;
            int has_armor = read_armor_at(tr->armor_ptr, &armor);
            tr->has_armor = has_armor;
            tr->hp = has_armor ? armor.hitPoints : 0.0f;
            tr->last_hit = has_armor ? armor.lastHitPlayer : -1;
            /* First seen: the o record the viewer's lifeFor needs. Max hit
             * points and the critical-damage threshold ride on it (the
             * burning and destruction thresholds). */
            if (has_armor) {
                char line[512];
                snprintf(line, sizeof(line),
                    "{\"k\":\"o\",\"t\":%.3f,\"id\":%u,\"gid\":%u,\"tmpl\":\"%s\",\"tid\":%u"
                    ",\"maxhp\":%.1f,\"crit\":%.1f}",
                    g_t, id, gid, name, tid, armor.maxHitPoints, armor.criticalDamage);
                write_line(line);
            } else
#endif
            {
                char line[512];
                snprintf(line, sizeof(line),
                    "{\"k\":\"o\",\"t\":%.3f,\"id\":%u,\"gid\":%u,\"tmpl\":\"%s\",\"tid\":%u}",
                    g_t, id, gid, name, tid);
                write_line(line);
            }
            return;
        }

        Tracked *tr = &g_tracked[ti];
        tr->gen = g_gen;
#if REC_STAGE3
        ArmorFields armor_now;
        int has_armor = read_armor_at(tr->armor_ptr, &armor_now);
#endif
        float dx = tr->x - m.p[0], dy = tr->y - m.p[1], dz = tr->z - m.p[2];
        float dq = tr->qx - q[0] + tr->qy - q[1] + tr->qz - q[2] + tr->qw - q[3];
        int moved = dx * dx + dy * dy + dz * dz >= 1e-4f || !(dq < 0.008f && dq > -0.008f);
#if REC_STAGE3
        int hp_changed = has_armor && (!tr->has_armor
            || fabsf(armor_now.hitPoints - tr->hp) > 0.05f
            || armor_now.lastHitPlayer != tr->last_hit);
#endif
        if (moved) {
            tr->x = m.p[0]; tr->y = m.p[1]; tr->z = m.p[2];
            tr->qx = q[0]; tr->qy = q[1]; tr->qz = q[2]; tr->qw = q[3];
            char entry[160], *e = entry;
            *e++ = '['; e = put_u(e, id);
            for (int k = 0; k < 3; k++) { *e++ = ','; e = put_f(e, m.p[k], 2); }
            for (int k = 0; k < 4; k++) { *e++ = ','; e = put_f(e, q[k], 3); }
            *e++ = ']'; *e = 0;
            acc_add(&g_acc_s, entry);
        }
        /* Hit points change on every hit, and fall steadily on their own once
         * below the critical threshold (burning): the smoke, fire and
         * destruction timeline, and the damage events the viewer feeds. */
#if REC_STAGE3
        if (hp_changed) {
            tr->has_armor = 1;
            tr->hp = armor_now.hitPoints;
            tr->last_hit = armor_now.lastHitPlayer;
            char entry[96];
            snprintf(entry, sizeof(entry), "[%u,%.1f,%d]",
                id, armor_now.hitPoints, armor_now.lastHitPlayer);
            acc_add(&g_acc_a, entry);
        }
#endif
        return;
    }

#if REC_STAGE3
    /* Non-root pass 1: a watched kit (needs its net id). The walk emits
     * pending kits before it gets here; this catches one armed meanwhile. */
    if (nid && kit_watch_pending(nid)) kit_watch_emit(obj, nid, key);

    /* Non-root pass 2: moving parts and engines under a root. A child's
     * networkable carries no id (getID() 0 for every child), so the pass
     * does not need one -- the gate above only applied to the kit watch. */
    uint32_t vptr = read_u32(obj);
    int is_rot = vptr == T->vt_rot_bundle;
    int is_engine = vptr == T->vt_engine;
    if (!is_rot && !is_engine) return;

    uintptr_t root = root_of(obj);
    if (root < 0x1000 || root == obj) return;
    uint32_t root_nid = T->net_id_of(root);
    if (!root_nid) return;

    Mat4 top, part;
    const Mat4 *top_m, *part_m;
    if (!rd(&top, sizeof(top), root + T->obj_mat_off)) return;
    if (!rd(&part, sizeof(part), obj + T->obj_mat_off)) return;
    top_m = &top;
    part_m = &part;

    uint32_t tmpl = read_u32(obj + T->obj_tmpl_off);
    int first = 0;
    Part *pt = part_of(obj, root_nid, tmpl, g_gen, &first);
    if (!pt) return;

    if (is_rot) {
        /* The part's rotation relative to its root: the turret's traverse,
         * the gun's elevation, the propeller's spin. */
        float qr[4], qtop[4], qpart[4], qc[4];
        to_quat(top_m, qtop);
        to_quat(part_m, qpart);
        quat_conj(qc, qtop);
        quat_mul(qr, qc, qpart);

        if (first) {
            /* Named on first sight, with where it sits on its root: the
             * viewer finds the part in the root's model by template name,
             * and among same-named parts (a ship's AA guns) by place. */
            char name[128];
            tmpl_name_json(tmpl, name, sizeof(name));
            float at[3];
            local_pos(top_m, part_m->p, at);
            char line[512];
            snprintf(line, sizeof(line),
                "{\"k\":\"jn\",\"t\":%.3f,\"o\":[[%u,%d,\"%s\",%.2f,%.2f,%.2f]]}",
                g_t, root_nid, pt->id, name, at[0], at[1], at[2]);
            write_line(line);
        } else if (pt->has_j && fabsf(pt->qx - qr[0]) < 0.002f && fabsf(pt->qy - qr[1]) < 0.002f
                   && fabsf(pt->qz - qr[2]) < 0.002f && fabsf(pt->qw - qr[3]) < 0.002f) {
            return;
        }
        pt->has_j = 1;
        pt->qx = qr[0]; pt->qy = qr[1]; pt->qz = qr[2]; pt->qw = qr[3];
        char entry[128], *e = entry;
        *e++ = '['; e = put_u(e, root_nid); *e++ = ','; e = put_i(e, pt->id);
        for (int k = 0; k < 4; k++) { *e++ = ','; e = put_f(e, qr[k], 4); }
        *e++ = ']'; *e = 0;
        acc_add(&g_acc_j, entry);
        return;
    }

    /* Engine: PhysicsEngine at eng_pe_off (the physicsNode field; verified
     * against the vptr), revs at pe_revs_off (PhysicsEngine::updatePhysics
     * 0x0824cbb0 reads and writes it), gear at pe_gear_off (PhysicsEngine
     * ctor sets 1). The running/disabled flags and throttle are verified
     * server-side: running Engine+0x142 (TemplateMessage 4 sets, 5 clears),
     * disabled +0x143 (0x14/0x15 on critical damage, 0x13 repair clears),
     * throttle +0x124 (handlePlayerInput gates all input on the word == 1;
     * handleUpdate forces revs 0 when running == 0). */
    uint32_t pe = read_u32(obj + T->eng_pe_off);
    /* vt_phys_engine == 0: the target has no verified vtable yet (w32ded's
     * comes from the live census) -- trust the pe pointer alone. */
    if (pe < 0x1000 || (T->vt_phys_engine && read_u32(pe) != T->vt_phys_engine)) return;
    float revs;
    if (!rd(&revs, 4, pe + T->pe_revs_off)) return;
    int32_t gear = (int32_t)read_u32(pe + T->pe_gear_off);
    uint8_t flags2[2] = { 0, 0 };
    rd(flags2, 2, obj + T->eng_flags_off);
    float throttle = 0.0f;
    rd(&throttle, 4, obj + T->eng_throttle_off);
    int eflags = (flags2[0] ? 1 : 0) | (flags2[1] ? 2 : 0);

    if (pt->has_g && fabsf(pt->revs - revs) < 0.01f && pt->gear == gear
        && fabsf(pt->throttle - throttle) < 0.01f && pt->eflags == eflags)
        return;
    pt->has_g = 1;
    pt->revs = revs;
    pt->gear = gear;
    pt->throttle = throttle;
    pt->eflags = eflags;
    char entry[128], *e = entry;
    *e++ = '['; e = put_u(e, root_nid);
    *e++ = ','; e = put_f(e, revs, 3); *e++ = ','; e = put_f(e, throttle, 3);
    *e++ = ','; e = put_i(e, eflags); *e++ = ','; e = put_i(e, gear); *e++ = ','; e = put_i(e, pt->id);
    *e++ = ']'; *e = 0;
    acc_add(&g_acc_g, entry);

    if (g_debug) {
        static int dumped = 0;
        if (!dumped) {
            dumped = 1;
            fprintf(stderr, "recorder dbg: engine obj %08x dwords 0x100-0x1c0:", (unsigned)obj);
            for (int w = 0x100; w < 0x1c0; w += 4)
                fprintf(stderr, " +%x=%08x", w, read_u32(obj + w));
            fprintf(stderr, "\n");
        }
    }
#endif /* REC_STAGE3 */
}

#if REC_STAGE3

/* Soldier pass (roots only, vtable-identified): the animation state machines
 * (BFSoldier::getAnimationState 0x0826d060: soldier+0x2b4 + i*0x44 -- lower
 * machine i=0, upper i=1), the held item (getActiveItemIndex 0x0827f920:
 * +0x3b8) and the state bits (getStateBits 0x0827e1c0: +0x3e6). */
static void sample_soldier(uint32_t obj, uint32_t nid)
{
    int lower = (int)read_u32(obj + T->sol_lower_off);
    int upper = (int)read_u32(obj + T->sol_upper_off);
    int item = (int)read_u32(obj + T->sol_item_off);
    int bits = 0;
    rd(&bits, 2, obj + T->sol_bits_off);
    /* The aim the client is sent (BFSoldierNetworkable::updateStateMask
     * 0x082224e0 copies these two into its +0x68/+0x6c; a client file's
     * pitch and twist are the same numbers, ledger P-4). */
    float pitch = 0.0f, twist = 0.0f;
    if (T->sol_aim_pitch_off) rd(&pitch, 4, obj + T->sol_aim_pitch_off);
    if (T->sol_aim_twist_off) rd(&twist, 4, obj + T->sol_aim_twist_off);
    if (!(pitch > -360.0f && pitch < 360.0f)) pitch = 0.0f;
    if (!(twist > -360.0f && twist < 360.0f)) twist = 0.0f;

    SoldierTracked *s = 0;
    for (int i = 0; i < g_soldiers_n; i++)
        if (g_soldiers[i].nid == nid) { s = &g_soldiers[i]; break; }
    if (!s) {
        if (g_soldiers_n >= MAX_SOLDIERS) return;
        s = &g_soldiers[g_soldiers_n++];
        memset(s, 0, sizeof(*s));
        s->nid = nid;
        s->lower = -1; s->upper = -1; s->item = -1; s->bits = -1;
    }
    s->seen = 1;
    if (s->lower == lower && s->upper == upper && s->item == item && s->bits == bits
        && fabsf(s->pitch - pitch) < 0.25f && fabsf(s->twist - twist) < 0.25f) return;
    s->lower = lower; s->upper = upper; s->item = item; s->bits = bits;
    s->pitch = pitch; s->twist = twist;
    char entry[128], *e = entry;
    *e++ = '['; e = put_u(e, nid); *e++ = ','; e = put_i(e, lower); *e++ = ','; e = put_i(e, upper);
    *e++ = ','; e = put_f(e, pitch, 1); *e++ = ','; e = put_f(e, twist, 1);
    *e++ = ','; e = put_i(e, item); *e++ = ','; e = put_i(e, bits);
    *e++ = ']'; *e = 0;
    acc_add(&g_acc_st, entry);
    if (!g_anim_written) { write_anim_states(g_t); g_anim_written = 1; }
}

/* Drop the soldiers this sample's walk did not see as live roots: the dead
 * (every spawn is a new soldier object), and the seated (a seated soldier is
 * a child; he comes back with a fresh st line). The table holds MAX_SOLDIERS
 * at a time, not per round. */
static void soldiers_prune(void)
{
    int w = 0;
    for (int i = 0; i < g_soldiers_n; i++) {
        if (!g_soldiers[i].seen) continue;
        if (w != i) g_soldiers[w] = g_soldiers[i];
        w++;
    }
    g_soldiers_n = w;
}

/* --- the roster and the level ---------------------------------------------- */

static uint32_t kit_net_id_of(uint32_t soldier);

/* PlayerManager::getPlayers: the list at pm_list_off; a node: next +0,
 * BFPlayer* at pl_node_player_off (GameServer::updateGameLogic walks it so).
 * BFPlayer: id u16 bf_id_off, name string bf_name_off, ai byte bf_ai_off,
 * team bf_team_off, and -- the fields GameEventManager::createPlayer
 * 0x0812d080 fills its event from: the controlled object (vehicle)
 * bf_veh_off, the camera bf_cam_off. The kit is NOT a BFPlayer field (the
 * event builder takes it from the soldier's template, class id 0x9493): the
 * real createPlayer/pickupKit events the detour captures carry it, so with
 * the hook active no kit is written here. */
static void write_create_player(const Plyr *pl, uintptr_t p, int ai, uint32_t veh)
{
    /* Synthesised createPlayer (hook inactive or the join's events went
     * by): the ids the event builder fills from bf_veh_off and bf_cam_off --
     * vehicle/controlled and camera. */
    uint32_t cam = read_u32(p + T->bf_cam_off);
    uint32_t cam_nid = cam > 0x1000 ? T->net_id_of(cam) : 0;
    uint32_t veh_nid = veh > 0x1000 ? T->net_id_of(veh) : 0;
    char esc[400];   /* 63 bytes, every one \u00XX at worst */
    json_escape(pl->name, esc, sizeof(esc));
    char line[768];
    snprintf(line, sizeof(line),
        "{\"k\":\"e\",\"t\":%.3f,\"e\":\"createPlayer\",\"pid\":%d,"
        "\"name\":\"%s\",\"team\":%d,\"ai\":%d"
        ",\"vehNetId\":%u,\"camNetId\":%u,\"kitNetId\":%u}",
        g_t, pl->pid, esc, pl->team, ai, veh_nid, cam_nid, pl->kit_nid);
    write_line(line);
}

static void write_destroy_player(int pid)
{
    char line[128];
    snprintf(line, sizeof(line),
        "{\"k\":\"e\",\"t\":%.3f,\"e\":\"destroyPlayer\",\"pid\":%d}", g_t, pid);
    write_line(line);
}

static void sample_players(void)
{
    uint32_t pm = read_u32(T->player_manager_ptr);
    if (!pm || pm < 0x1000) return;

    /* The list: lnxded keeps the header node embedded at pm+pm_list_off;
     * w32ded's pm vtable slot 0x2c returns pm+0xc and the raw walk starts at
     * the sentinel pointer *(pm+0x10) -- see w32ded-offsets.md pass 4. */
    uint32_t list = T->pm_sentinel_indirect
        ? read_u32(pm + T->pm_list_off) : pm + T->pm_list_off;
    if (list < 0x1000) return;
    uint32_t node = read_u32(list);
    /* The BotManager, by its vptr: IBotManager::instance holds it, or its
     * IBotManager base bm_iface_adj into it. */
    uint32_t bm = 0;
    if (T->bm_iface_ptr) {
        static int said;
        uint32_t inst = read_u32(T->bm_iface_ptr);
        if (inst >= 0x1000 && read_u32(inst) == T->vt_bot_manager) bm = inst;
        else if (inst >= 0x1000 && read_u32(inst - T->bm_iface_adj) == T->vt_bot_manager)
            bm = inst - T->bm_iface_adj;
        if (bm && !said) {
            said = 1;
            fprintf(stderr, "recorder: BotManager at IBotManager::instance%s\n",
                    bm == inst ? "" : " - adj");
        }
    }
    /* Who this walk saw, by index into g_players. */
    unsigned char seen[MAX_PLAYERS] = { 0 };
    int complete = 0;
    for (int i = 0; i < MAX_PLAYERS + 8; i++) {
        if (node == list) { complete = 1; break; }
        if (node < 0x1000) break;
        uint32_t p = read_u32(node + T->pl_node_player_off);
        node = read_u32(node);
        if (!p || p < 0x1000) break;

        /* getId: 0 is a real player (the first human to join), so a failed
         * read shows as an empty name below, not as pid 0. */
        int pid = read_u32(p + T->bf_id_off) & 0xffff;

        char name[64] = "";
        /* w32: the plain name field is being located live (the createPlayer
         * builder gets the name via a virtual; a virtual call from this
         * thread on a racing destroy faults). While bf_name_off is 0, dump
         * the player's head once per run to find the plain offsets. */
        if (!T->bf_name_off && g_debug && !g_player_dump_done) {
            g_player_dump_done = 1;
            fprintf(stderr, "recorder dbg: player %08x vtbl %08x:", p, read_u32(p));
            for (int w = 0; w < 0x120; w += 4)
                fprintf(stderr, " +%x=%08x", w, read_u32(p + w));
            fprintf(stderr, "\n");
        }
        /* The name only when the player object or its name string changed
         * since the last walk (the read can be a system call a player). */
        uint32_t name_ptr = T->bf_name_off ? read_u32(p + T->bf_name_off) : 0;
        Plyr *known = 0;
        for (int j = 0; j < g_players_n; j++)
            if (g_players[j].pid == pid) { known = &g_players[j]; break; }
        if (known && name_ptr && known->bf == p && known->name_ptr == name_ptr) {
            snprintf(name, sizeof(name), "%s", known->name);
        } else {
            if (T->read_player_name) T->read_player_name(p, name, sizeof(name));
            else T->read_string(p + T->bf_name_off, name, sizeof(name));
        }
        if (!name[0]) continue;
        int ai = T->read_player_ai
            ? T->read_player_ai(p) : (int)(read_u32(p + T->bf_ai_off) & 0xff);
        int team = read_u32(p + T->bf_team_off);
        uint32_t veh = read_u32(p + T->bf_veh_off);
        uint32_t nid = veh > 0x1000 ? T->net_id_of(veh) : 0;

        Plyr *pl = known;

        /* A pid the server handed to someone else since we last looked (a
         * public server reuses them): the old player left, a new one came. */
        if (pl && name[0] && strcmp(name, pl->name) != 0) {
            write_destroy_player(pid);
            int slot = (int)(pl - g_players);
            g_players[slot] = g_players[--g_players_n];
            seen[slot] = seen[g_players_n];
            pl = 0;
        }

        /* The kit he carries: resolved only when his controlled object
         * changes (a spawn binds a fresh soldier and a fresh kit). */
        uint32_t kit_nid = 0;
        if (!pl || nid != pl->soldier_nid) {
            kit_nid = nid ? kit_net_id_of(veh) : 0;
            if (kit_nid) {
                kit_watch_add(kit_nid);
                /* The pickupKit event the engine would have sent (the join's
                 * database sends it once; a recorder that starts with the
                 * round catches none). The viewer binds the soldier's kit
                 * from it. */
                char line[256];
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"pickupKit\",\"pid\":%d,\"netId\":%u}",
                    g_t, pid, kit_nid);
                write_line(line);
            }
        }

        if (!pl) {
            if (g_players_n >= MAX_PLAYERS) continue;
            pl = &g_players[g_players_n++];
            memset(pl, 0, sizeof(*pl));
            pl->lod = -2;
            pl->pid = pid;
            snprintf(pl->name, sizeof(pl->name), "%s", name);
            pl->kit_nid = kit_nid;
            pl->team = team;
            write_create_player(pl, p, ai, veh);
        } else {
            if (kit_nid && kit_nid != pl->kit_nid) pl->kit_nid = kit_nid;
            if (team != pl->team) {
                pl->team = team;
                char line[256];
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"setTeam\",\"pid\":%d,\"team\":%d}",
                    g_t, pid, team);
                write_line(line);
            }
        }
        pl->missing = 0;
        pl->bf = p;
        pl->name_ptr = name_ptr;
        seen[pl - g_players] = 1;

        /* What the player controls now: his soldier on spawning, his free
         * camera on death. The real events say this too (hook active); the
         * sampled fallback only runs when they are absent, and the viewer
         * folds both into the same control store. */
        if (nid != pl->soldier_nid) {
            pl->soldier_nid = nid;
            if (nid) {
                char line[256];
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"control\",\"pid\":%d,\"netId\":%u}",
                    g_t, pid, nid);
                write_line(line);
            }
        }

        /* The seat: the client's p entry [pid, team, vehicle, root, seat,
         * triggers]. The control object is what the ghost manager replicates
         * as the client's (GhostManager::updatePlayerControlObject 0x08142210
         * calls getVehicle 0x080560c0: BFPlayer+0x4c): the soldier on foot,
         * the seat's object in a vehicle, the free camera when dead. Its root
         * is the hull; the seat is the int setVehicle 0x08052310 stores beside
         * it. Matched the client's p records seat for seat (2026-10-04). */
        if (T->bf_ctrl_off) {
            uint32_t ctrl = read_u32(p + T->bf_ctrl_off);
            uint32_t vehicle = ctrl >= 0x1000 ? T->net_id_of(ctrl) : 0;
            uintptr_t croot = ctrl >= 0x1000 ? root_of(ctrl) : 0;
            uint32_t root = croot >= 0x1000 ? T->net_id_of(croot) : 0;
            int seat = (int)read_u32(p + T->bf_seat_off);
            if (seat < 0 || seat > 64) seat = 0;
            uint8_t tb[2] = { 0, 0 };
            rd(tb, 2, p + T->bf_trig_off);
            int trig = (tb[0] ? 1 : 0) | (tb[1] ? 2 : 0);
            if (vehicle && (!pl->p_written || vehicle != pl->p_vehicle || root != pl->p_root
                            || seat != pl->p_seat || trig != pl->p_trig || team != pl->p_team)) {
                pl->p_written = 1;
                pl->p_vehicle = vehicle; pl->p_root = root; pl->p_seat = seat;
                pl->p_trig = trig; pl->p_team = team;
                char entry[96];
                snprintf(entry, sizeof(entry), "[%d,%d,%u,%u,%d,%d]",
                         pid, team, vehicle, root ? root : vehicle, seat, trig);
                acc_add(&g_acc_p, entry);
            }
        }

        /* A bot's AI LOD (AI-136): 0 near a human, 2 far from all of them.
         * At 2 the server runs it in less detail (no locomotion states, fake
         * fire, a hull that slides): the viewer can tell that from a capture
         * fault. BotManager::getBotFromPlayerId 0x0849c460's lookup. */
        if (ai && bm && pid < 256) {
            int lod = -1;
            uint32_t tbl = read_u32(bm + T->bm_pid_table_off);
            uint32_t bi = tbl >= 0x1000 ? read_u32(tbl + (uint32_t)pid * 4) : 0xffffffffu;
            uint32_t vb = read_u32(bm + T->bm_bots_off), ve = read_u32(bm + T->bm_bots_off + 4);
            if (bi != 0xffffffffu && vb >= 0x1000 && ve >= vb && bi < (ve - vb) / 4) {
                uint32_t e = read_u32(vb + bi * 4);
                uint32_t bot = e >= 0x1000 ? read_u32(e) : 0;
                if (bot >= 0x1000) lod = (int)read_u32(bot + T->bot_lod_off);
            }
            if (lod >= 0 && lod < 8 && lod != pl->lod) {
                pl->lod = lod;
                char entry[48];
                snprintf(entry, sizeof(entry), "[%d,%d]", pid, lod);
                acc_add(&g_acc_lod, entry);
            }
        }
    }

    /* Departures: only a walk that reached the list's end proves absence. */
    if (!complete) return;
    for (int j = 0; j < g_players_n; ) {
        if (seen[j] || ++g_players[j].missing < PLAYER_GONE_WALKS) { j++; continue; }
        write_destroy_player(g_players[j].pid);
        g_players[j] = g_players[--g_players_n];
        seen[j] = seen[g_players_n];
    }
}

/* The kit a soldier carries: the lookup GameEventManager::createPlayer
 * 0x0812d080 performs when it fills a createPlayer event's kitNetworkID --
 * the soldier's template must be a Kit (class id 0x9493 via the template's
 * getClassID slot, vptr+0xc), then the soldier's getKit (vptr+0x17c) yields
 * a key the object manager resolves (vptr+0x20, fallback +0x24) to the kit
 * object. Two virtual calls on long-lived objects, from the sampler: the
 * same calls the server itself makes at every spawn. Returns the kit's net
 * id (0 when there is none). */
static uint32_t kit_net_id_of(uint32_t soldier)
{
    if (soldier < 0x1000) return 0;
    uint32_t tmpl = read_u32(soldier + T->obj_tmpl_off);
    if (tmpl < 0x1000) return 0;
    uint32_t tv = read_u32(tmpl);
    if (tv < 0x1000) return 0;
    if (T->sol_kitid_off) {
        /* The same lookup by safe reads. A virtual call from this thread
         * runs the engine's own std::map find on the objectManager's id map
         * while the game thread inserts and erases in it, and a freed node
         * there is a dead server, not a skipped sample. getClassID ==
         * kit_class_id is a BFSoldierTemplate (the only vtable carrying that
         * getClassID); getKitId is a field read; getObjectFromGrid and
         * getObjectFromNoCollisionGrid are finds in two id maps. */
        if (tv != T->vt_soldier_tmpl) return 0;
        uint32_t key = read_u32(soldier + T->sol_kitid_off);
        if (!key) return 0;
        uint32_t om = read_u32(T->object_manager_ptr);
        if (om < 0x1000) return 0;
        uintptr_t kit = rbtree_find_value(om + T->om_objmap1_off, key);
        if (kit < 0x1000 && T->om_objmap2_off)
            kit = rbtree_find_value(om + T->om_objmap2_off, key);
        return kit >= 0x1000 ? T->net_id_of(kit) : 0;
    }
    uint32_t fn = read_u32(tv + 0xc);
    if (fn < 0x1000) return 0;
    /* fn = vtable slot value; a target may veto wild pointers (w32ded: the
     * sampler thread races destroys, and SEH is unavailable on i386). */
    if (T->vt_call_ok && !T->vt_call_ok(fn)) return 0;
    if (((uint32_t (REC_VTCALL *)(void *))fn)((void *)(uintptr_t)tmpl) != T->kit_class_id) return 0;
    uint32_t sv = read_u32(soldier);
    if (sv < 0x1000) return 0;
    uint32_t gk = read_u32(sv + T->kit_getkit_slot);
    if (gk < 0x1000) return 0;
    if (T->vt_call_ok && !T->vt_call_ok(gk)) return 0;
    uint32_t key = ((uint32_t (REC_VTCALL *)(void *))gk)((void *)(uintptr_t)soldier);
    if (!key) return 0;
    uint32_t om = read_u32(T->object_manager_ptr);
    if (om < 0x1000) return 0;
    uint32_t ov = read_u32(om);
    if (ov < 0x1000) return 0;
    uint32_t kit = 0;
    uint32_t f1 = read_u32(ov + T->om_get_slot1);
    /* fn = vtable slot value; a target may veto wild pointers (w32ded: the
     * sampler thread races destroys, and SEH is unavailable on i386). */
    if (T->vt_call_ok && !T->vt_call_ok(fn)) return 0;
    if (T->vt_call_ok && !T->vt_call_ok(f1)) return 0;
    if (f1 >= 0x1000) kit = ((uint32_t (REC_VTCALL *)(void *, uint32_t))f1)((void *)(uintptr_t)om, key);
    if (kit < 0x1000) {
        uint32_t f2 = read_u32(ov + T->om_get_slot2);
        if (f2 >= 0x1000 && !(T->vt_call_ok && !T->vt_call_ok(f2)))
            kit = ((uint32_t (REC_VTCALL *)(void *, uint32_t))f2)((void *)(uintptr_t)om, key);
    }
    return kit >= 0x1000 ? T->net_id_of(kit) : 0;
}

/* The level and the mode, from the setup's current level entry
 * (Setup::getCurrentLevel 0x080bfeb0: the entry at setup_level_off, name
 * string +0, gpm enum +4; the enum's words from stringToGPM 0x08060620:
 * CQ=2, TDM=3, COOP=4, OBJECTIVEMODE=5). */
/* The level this file is recording (empty until write_level ran). */
static char g_level_name[64];

static void read_level(char *level, size_t cap, uint32_t *gpm)
{
    level[0] = 0;
    *gpm = 0;
    uint32_t setup = read_u32(T->setup_ptr);
    if (!setup || setup < 0x1000) return;
    T->read_string(setup + T->setup_level_off, level, cap);
    *gpm = read_u32(setup + T->setup_gpm_off);
}

static void write_level(void)
{
    char level[64];
    uint32_t gpm;
    read_level(level, sizeof(level), &gpm);
    if (!level[0]) return;
    const char *mode = gpm == 2 ? "Conquest" : gpm == 3 ? "Tdm"
                     : gpm == 4 ? "CoOp" : gpm == 5 ? "ObjectiveMode"
                     : gpm == 1 ? "Ctf" : "";
    char esc[128];
    json_escape(level, esc, sizeof(esc));
    char line[256];
    snprintf(line, sizeof(line),
        "{\"k\":\"e\",\"t\":%.3f,\"e\":\"setLevel\",\"level\":\"%s\",\"mode\":\"%s\"}",
        g_t, esc, mode);
    write_line(line);
    g_level_written = 1;
    snprintf(g_level_name, sizeof(g_level_name), "%s", level);
    fprintf(stderr, "recorder: level %s mode %s (gpm %u)\n", level, mode, gpm);
}

/* --- the event detour (game thread) ------------------------------------------ */

/* Held events: what arrived before a file existed (the join's events go by
 * before the sampler wakes) open the file at t 0. A ring of lines; a join's
 * events repeat, so later copies replace earlier same-kind ones where it
 * matters (setLevel, gameRules, serverInfo). */
#define HELD_MAX 1024

typedef struct { int replace_kind; uint32_t order; char line[768]; } HeldEvent;
static HeldEvent *g_held;
static int g_held_n;
static uint32_t g_held_order;

static int held_kind(int type)
{
    switch (type) {
        case 0x36: case 0x16: case 0x1a: case 0x1b: case 0x14: return type;
        case 0x08: return 1000;              /* createPlayer: per player, not replaced */
        default: return 0;                   /* never replaced, never dropped */
    }
}

/* With the write lock held: game-thread events and the sampler's open race
 * for the file, so the check and the push are one locked step (emit_line). */
static void held_push_locked(const char *line, int type)
{
    if (!g_held) return;   /* buffer only once a run's config turned recording on */
    int kind = held_kind(type);
    if (kind) {
        for (int i = 0; i < g_held_n; i++)
            if (g_held[i].replace_kind == kind) {
                snprintf(g_held[i].line, sizeof(g_held[i].line), "%s", line);
                return;
            }
    }
    if (g_held_n >= HELD_MAX) return;
    HeldEvent *h = &g_held[g_held_n++];
    h->replace_kind = kind;
    h->order = g_held_order++;
    snprintf(h->line, sizeof(h->line), "%s", line);
}

/* With the write lock held (the sampler, right after it opened the file):
 * written through write_line_locked, never write_line. */
static void held_flush_locked(void)
{
    /* In arrival order, at t 0 (what came before the file existed). */
    for (uint32_t o = 0; o < g_held_order; o++) {
        for (int i = 0; i < g_held_n; i++)
            if (g_held[i].order == o) write_line_locked(g_held[i].line);
    }
    g_held_n = 0;
    g_held_order = 0;
}

/* An event line: into the file, or held until there is one. */
static void emit_line(const char *line, int type)
{
    T->rec_lock();
    if (file_is_open()) write_line_locked(line);
    else held_push_locked(line, type);
    T->rec_unlock();
}

/* ScoreMsgEvent kind names for the debug log. */
static void emit_event_json(int type, const uint8_t *payload, size_t size, double t);

/* Called from the stubs with the event the server just built. Payload after
 * the 12-byte GameEvent header (vptr, sequenceNumber, nextEvent). Struct
 * shapes are bf42plus src/bf/gameevent.h, which static_asserts them against
 * the client binary; the wire format is shared. */
static volatile int g_event_calls;
static int g_event_type_hist[64];
static volatile int g_fire_calls, g_fire_written;

/* The last event recorded (game thread only). sendGameEventToAll hands its
 * event to GameEventManager::addEvent once per connected client, which
 * clones it into addEventToSendQueue; the per-client GameServer senders
 * (enterVehicle, radioMessage, handlePickup, ...) loop the same way. With N
 * clients one event reaches the hooks N (+1) times, back to back, with the
 * same payload: those copies are dropped here. */
static int g_last_type;
static size_t g_last_size;
static uint8_t g_last_payload[256];
static double g_last_at;
#define FANOUT_WINDOW_S 0.005

static void on_event(uint32_t ev)
{
    g_event_calls++;
    if (ev < 0x1000) return;
    /* getType: vtable slot 0 (GameEvent's first virtual). A real event on
     * the game's own thread: the call is as safe as the engine's own. */
    uint32_t vt = read_u32(ev);
    if (vt < 0x1000) return;
    uint32_t fn = read_u32(vt);
    if (fn < 0x1000) return;
    int type = (int)((int (REC_VTCALL *)(void *))fn)((void *)(uintptr_t)ev);
    if (type >= 0 && type < 64) g_event_type_hist[type]++;
    if (type <= 0 || type > 0x3f) return;

    const uint8_t *p = (const uint8_t *)(uintptr_t)ev + 12;

    double now = T->now_s();
    double t = g_t0 > 0.0 ? now - g_t0 : 0.0;

    /* A ServerInfo event (0x1a) is a client's join handshake, never a map
     * change (its only builder is GameServer::processReceivedPackets): it is
     * recorded like any other event. Map changes are the sampler's to find
     * (split_if_new_level). */

    /* Read the payload into a local buffer: every read through the game's
     * own memory on the game thread. */
    uint8_t buf[256];
    size_t size = 0;
    /* Sizes from the event structs (bf42plus gameevent.h); unknown sizes
     * read 64 bytes and are dropped. */
    static const struct { int type; size_t size; } sizes[] = {
        { 0x04, 17 }, { 0x05, 22 }, { 0x06, 14 }, { 0x07, 43 }, { 0x08, 57 },
        { 0x09, 15 }, { 0x0a, 15 }, { 0x0b, 14 }, { 0x0c, 13 }, { 0x16, 31 },
        { 0x1a, 63 }, { 0x1b, 45 }, { 0x24, 51 }, { 0x27, 13 }, { 0x28, 38 },
        { 0x29, 20 }, { 0x2a, 26 }, { 0x34, 12 }, { 0x36, 128 }, { 0x39, 14 },
        { 0x3a, 16 }, { 0x23, 15 },
    };
    for (unsigned i = 0; i < sizeof(sizes) / sizeof(sizes[0]); i++)
        if (sizes[i].type == type) { size = sizes[i].size; break; }
    if (!size) return;
    if (size > sizeof(buf)) size = sizeof(buf);
    memcpy(buf, p, size);

    if (type == g_last_type && size == g_last_size && now - g_last_at < FANOUT_WINDOW_S
        && memcmp(buf, g_last_payload, size) == 0) {
        g_last_at = now;   /* a long fan-out stays one window */
        return;
    }
    g_last_type = type;
    g_last_size = size;
    memcpy(g_last_payload, buf, size);
    g_last_at = now;

    emit_event_json(type, buf, size, t);
}

/* Entered from GCC 3.2 code, which keeps the stack 4-byte aligned; this
 * file is built for SSE and may keep 16-byte aligned spills. */
#define REC_GAME_THREAD_ENTRY __attribute__((force_align_arg_pointer))

/* GameServer::sendGameEventToAll: every to-all event, once. */
REC_GAME_THREAD_ENTRY void recorder_on_event(uint32_t ev)
{
    on_event(ev);
}

/* GameEventManager::addEventToSendQueue: what a connected client is sent
 * (the per-client senders, the to-all fan-out's clones, a joining client's
 * database). Dead while no client is connected. */
REC_GAME_THREAD_ENTRY void recorder_on_queue_event(uint32_t ev)
{
    on_event(ev);
}

static void emit_event_json(int type, const uint8_t *p, size_t size, double t)
{
    (void)size;
    char line[768];
    char name[80];

#define U8(at) ((uint8_t)p[at])
#define U16(at) ((uint16_t)(p[at] | (p[(at) + 1] << 8)))
#define U32(at) ((uint32_t)(p[at] | (p[(at) + 1] << 8) | (p[(at) + 2] << 16) | ((uint32_t)p[(at) + 3] << 24)))
#define I32(at) ((int32_t)U32(at))
#define F32(at) ({ uint32_t _v = U32(at); float _f; memcpy(&_f, &_v, 4); _f; })

    switch (type) {
        case 0x08: {  /* CreatePlayerEvent */
            memcpy(name, p + 3, 32); name[32] = 0;
            char esc[200]; json_escape(name, esc, sizeof(esc));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"createPlayer\",\"pid\":%u,"
                "\"name\":\"%s\",\"team\":%u,\"ai\":%u,\"netId\":%u,\"vehNetId\":%u"
                ",\"camNetId\":%u,\"kitNetId\":%u}",
                t, U8(35), esc, U8(0), U8(44), U16(36), U16(38), U16(40), U16(42));
            /* Watch the kit: the viewer needs its o record. */
            kit_watch_add(U16(42));
            break;
        }
        case 0x0c:
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"destroyPlayer\",\"pid\":%u}", t, U8(0));
            break;
        case 0x39:
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"setTeam\",\"pid\":%u,\"team\":%u}",
                t, U8(0), U8(1));
            break;
        case 0x2a: {  /* ScoreMsgEvent: kills name the weapon */
            /* The server's object is packed: kind +0xc, player +0x10, victim
             * +0x11, weapon +0x12, then +0x16 (ScoreMsgEvent::serialize
             * 0x0811c8d0) -- payload 0, 4, 5, 6, 10, not the client
             * struct's 8 and 12. */
            int kind = I32(0);
            if (kind == 3 || kind == 6) {
                uint32_t wid = U32(6);
                template_name_by_id(wid, name, sizeof(name));
                char esc[128]; json_escape(name, esc, sizeof(esc));
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"score\",\"kind\":%d,\"pid\":%u"
                    ",\"victim\":%u,\"weapon\":%d,\"bodypart\":%d,\"weaponName\":\"%s\"}",
                    t, kind, U8(4), U8(5), (int32_t)wid, I32(10), esc);
            } else {
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"score\",\"kind\":%d,\"pid\":%u"
                    ",\"victim\":%u,\"weapon\":%d,\"bodypart\":%d}",
                    t, kind, U8(4), U8(5), I32(6), I32(10));
            }
            break;
        }
        case 0x28: {  /* ChatFragmentEvent */
            memcpy(name, p + 10, 16); name[16] = 0;
            char esc[104]; json_escape(name, esc, sizeof(esc));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"chat\",\"pid\":%d,\"first\":%u"
                ",\"global\":%u,\"server\":%u,\"total\":%u,\"text\":\"%s\"}",
                t, (int)I32(4), U8(0), U8(2), U8(3), U8(8), esc);
            break;
        }
        case 0x3a:
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"radio\",\"pid\":%u,\"msg\":%u,\"global\":%u}",
                t, U8(3), U16(0), U8(2));
            break;
        case 0x0a:
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"enterVehicle\",\"pid\":%u,\"netId\":%u}",
                t, U8(0), U16(1));
            break;
        case 0x0b:
            if (!U8(1))
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"exitVehicle\",\"pid\":%u}", t, U8(0));
            else
                line[0] = 0;
            break;
        case 0x23:  /* PickupKitEvent */
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"pickupKit\",\"pid\":%u,\"netId\":%u}",
                t, U8(0), U16(1));
            kit_watch_add(U16(1));
            break;
        case 0x06:
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"destroyObject\",\"netId\":%u}",
                t, U16(0));
            break;
        case 0x09:
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"control\",\"pid\":%u,\"netId\":%u}",
                t, U8(0), U16(1));
            break;
        case 0x07: {  /* CreateObjectEvent */
            template_name_by_id(U32(0), name, sizeof(name));
            char esc[128]; json_escape(name, esc, sizeof(esc));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"createObject\",\"tid\":%u,\"netId\":%u"
                ",\"tmpl\":\"%s\",\"pos\":[%.2f,%.2f,%.2f],\"rot\":[%.2f,%.2f,%.2f]}",
                t, U32(0), U16(4), esc, F32(8), F32(12), F32(16),
                F32(20), F32(24), F32(28));
            break;
        }
        case 0x36: {  /* SetLevelEvent */
            char lvl[80], mode[80];
            memcpy(lvl, p, 64); lvl[64] = 0;
            memcpy(mode, p + 64, 64); mode[64] = 0;
            char e1[200], e2[200];   /* ASCII in practice; a high byte costs 6 */
            json_escape(lvl, e1, sizeof(e1));
            json_escape(mode, e2, sizeof(e2));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"setLevel\",\"level\":\"%s\",\"mode\":\"%s\"}",
                t, e1, e2);
            break;
        }
        case 0x24:  /* GameStatusEvent */
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"gameStatus\",\"status\":%u}", t, U8(0));
            break;
        case 0x34:
            snprintf(line, sizeof(line), "{\"k\":\"e\",\"t\":%.3f,\"e\":\"dbComplete\"}", t);
            break;
        case 0x16:  /* GameRulesEvent */
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"gameRules\",\"extViews\":%u,\"noseCam\":%u"
                ",\"soldierFF\":%.3f,\"ticketRatio\":%.3f,\"timeLimit\":%u,\"worldTime\":%u"
                ",\"crosshair\":%u}",
                t, U8(0), U8(1), F32(2), F32(6), U32(10), U32(14), U8(18));
            break;
        case 0x29:  /* TimerSyncEvent, every 10 s: the world clock */
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"clock\",\"timeLimit\":%u,\"worldTime\":%u}",
                t, U32(0), U32(4));
            break;
        case 0x04:  /* SimulationEvent: the join's world time */
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"simStart\",\"running\":%u,\"worldTime\":%.3f}",
                t, U8(0), F32(1));
            break;
        case 0x1a: {  /* ServerInfoEvent */
            char m1[24], m2[24], m3[24];
            memcpy(m1, p, 16); m1[16] = 0;
            memcpy(m2, p + 17, 16); m2[16] = 0;
            memcpy(m3, p + 34, 16); m3[16] = 0;
            char e1[104], e2[104], e3[104];
            json_escape(m1, e1, sizeof(e1));
            json_escape(m2, e2, sizeof(e2));
            json_escape(m3, e3, sizeof(e3));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"serverInfo\",\"mapId\":\"%s\",\"mod\":\"%s\",\"gameId\":\"%s\"}",
                t, e1, e2, e3);
            break;
        }
        case 0x1b: {  /* ServerInfoEvent2: the server's name */
            memcpy(name, p, 32); name[32] = 0;
            char esc[200]; json_escape(name, esc, sizeof(esc));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"serverName\",\"name\":\"%s\"}", t, esc);
            break;
        }
        case 0x14: {  /* ChallengeEvent: the mod and pack */
            char m1[20];
            memcpy(m1, p + 10, 16); m1[16] = 0;
            char esc[104]; json_escape(m1, esc, sizeof(esc));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"challenge\",\"mod\":\"%s\",\"xpack\":%d}",
                t, esc, I32(27));
            break;
        }
        default:
            line[0] = 0;
            break;
    }
#undef U8
#undef U16
#undef U32
#undef I32
#undef F32

    if (!line[0]) return;

    emit_line(line, type);
    /* ENDMAP: the server restarts its process for the next map without
     * running exit handlers (each round of a lab run is a new process), so
     * what the round wrote is put on disk now, not at the writer's next
     * wake-up. Once a map, on the game thread. */
    if (type == 0x24 && p[0] == 5) out_sync();
}

/* --- the fire detour (game thread) --------------------------------------------- */

/* FireArms::fireBarrel(IPlayer*, Mat4&, int) 0x0828aba0: the twin of the
 * client hook's Fire commit site (bf42plus 0x0053DCB1). Every round any
 * player or bot fires leaves through it -- on the server, every bot's shots,
 * not only what one client had live. The record is the client's `f` line:
 * the weapon's template, its root's net id, the firing player's id, and the
 * Mat4 the round left along (rows a, b, c are the X, Y, Z axes; a round
 * leaves along +Z). */
/* One f record. `fake`: a round the AI rolled instead of firing (see
 * recorder_on_fake_fire): no projectile, the hit is statistical, and the
 * transform is the launch matrix rather than the barrel's. */
static void write_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr, int fake)
{
    uint32_t tmpl = read_u32(fire_arms + T->obj_tmpl_off);
    char name[96];
    T->read_template_name(tmpl, name, sizeof(name));

    int pid = -1;
    if (player >= 0x1000) {
        uint32_t bf = ((uint32_t (*)(uint32_t))T->get_bf_player_addr)(player);
        if (bf >= 0x1000) pid = (int)(read_u32(bf + T->bf_id_off) & 0xffff);
    }

    int root_nid = -1;
    uint32_t root = ((uint32_t (*)(uint32_t))T->get_root_parent_addr)(fire_arms);
    if (root >= 0x1000) root_nid = (int)T->net_id_of(root);

    Mat4 m;
    if (!rd(&m, sizeof(m), mat4_addr)) return;

    char esc[112]; json_escape(name, esc, sizeof(esc));
    char line[512];
    snprintf(line, sizeof(line),
        "{\"k\":\"f\",\"t\":%.3f,\"id\":%d,\"pid\":%d,\"w\":\"%s\""
        ",\"p\":[%.2f,%.2f,%.2f],\"d\":[%.3f,%.3f,%.3f]%s}",
        T->now_s() - g_t0, root_nid, pid, esc,
        m.p[0], m.p[1], m.p[2], m.c[0], m.c[1], m.c[2], fake ? ",\"fake\":1" : "");
    write_line(line);
    g_fire_written++;
}

REC_GAME_THREAD_ENTRY void recorder_on_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr)
{
    g_fire_calls++;
    if (!file_is_open() || fire_arms < 0x1000 || mat4_addr < 0x1000) return;
    write_fire(fire_arms, player, mat4_addr, 0);
}

/* FireArms::Fire past its fakeFire test (0x0828a217): every round, real or
 * fake, passes here once. Real rounds already went through fireBarrel, so
 * only the fake ones are written here. A bot shooting a bot that no human is
 * near fires fake: the timer, recoil, heat and ammo run, but no projectile
 * is made and the AI rolls the hit (EntryInfoWrapper::execute 0x08617f30
 * sets it through setFakeFire 0x0828e310). Most of a bots-only round's
 * small-arms fire is fake. */
REC_GAME_THREAD_ENTRY void recorder_on_fake_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr)
{
    if (!file_is_open() || fire_arms < 0x1000 || mat4_addr < 0x1000 || !T->fa_fake_off) return;
    uint8_t fake = 0;
    if (!rd(&fake, 1, fire_arms + T->fa_fake_off) || !fake) return;
    g_fire_calls++;
    write_fire(fire_arms, player, mat4_addr, 1);
}

#endif /* REC_STAGE3 */

/* --- control points and projectiles ---------------------------------------- */

#if REC_STAGE3

/* A control point, keyed by the registered map's key like the client
 * recorder's getID: [cp] on first sight with its name, template, place and
 * team, then a line per team change (the client's `cp` records). The team is
 * ControlPoint+0x174 (ControlPoint::setTeam 0x08284490; the networkable
 * replicates that field, ControlPointNetworkable::updateStateMask
 * 0x08226cb0), the name the template's controlPointName (+0x1e4, the
 * console setter at 0x08309c90). */
#define MAX_CPS 64

typedef struct { uint32_t key; int team; } CpTracked;
static CpTracked g_cps[MAX_CPS];
static int g_cps_n;

static void sample_cp(uint32_t obj, uint32_t key)
{
    int team = (int)read_u32(obj + T->cp_team_off);
    for (int i = 0; i < g_cps_n; i++) {
        if (g_cps[i].key != key) continue;
        if (g_cps[i].team == team) return;
        g_cps[i].team = team;
        char line[128];
        snprintf(line, sizeof(line), "{\"k\":\"cp\",\"t\":%.3f,\"id\":%u,\"team\":%d}", g_t, key, team);
        write_line(line);
        return;
    }
    if (g_cps_n >= MAX_CPS) return;
    g_cps[g_cps_n].key = key;
    g_cps[g_cps_n].team = team;
    g_cps_n++;
    uint32_t tmpl = read_u32(obj + T->obj_tmpl_off);
    char tname[128], raw[80], cname[200];
    tmpl_name_json(tmpl, tname, sizeof(tname));
    raw[0] = 0;
    if (tmpl >= 0x1000 && T->cpt_name_off) read_chars(read_u32(tmpl + T->cpt_name_off), raw, sizeof(raw));
    json_escape(raw, cname, sizeof(cname));
    Mat4 m;
    if (!rd(&m, sizeof(m), obj + T->obj_mat_off)) memset(&m, 0, sizeof(m));
    char line[640];
    snprintf(line, sizeof(line),
        "{\"k\":\"cp\",\"t\":%.3f,\"id\":%u,\"name\":\"%s\",\"tmpl\":\"%s\",\"pos\":[%.2f,%.2f,%.2f],\"team\":%d}",
        g_t, key, cname, tname, m.p[0], m.p[1], m.p[2], team);
    write_line(line);
}

/* Projectiles in flight: every Projectile root the map holds enabled (the
 * projectile map at om+0x128 holds only the mine-warning ones). A pooled
 * projectile is disabled between flights, so one key flies many times: `pn`
 * names a flight as it starts, `pj` places it each sample, `pd` ends it. */
#define MAX_PROJ 1024

typedef struct { uint32_t key; uint32_t gen; } ProjTracked;
static ProjTracked g_proj[MAX_PROJ];
static int g_proj_n;

static void sample_projectile(uint32_t obj, uint32_t key)
{
    int i = 0;
    for (; i < g_proj_n; i++) if (g_proj[i].key == key) break;
    if (i == g_proj_n) {
        if (g_proj_n >= MAX_PROJ) return;
        g_proj[g_proj_n++].key = key;
        char tname[128], line[256];
        tmpl_name_json(read_u32(obj + T->obj_tmpl_off), tname, sizeof(tname));
        snprintf(line, sizeof(line), "{\"k\":\"pn\",\"t\":%.3f,\"o\":[[%u,\"%s\"]]}", g_t, key, tname);
        write_line(line);
    }
    g_proj[i].gen = g_gen;
    Mat4 m;
    if (!rd(&m, sizeof(m), obj + T->obj_mat_off)) return;
    char entry[96], *e = entry;
    *e++ = '['; e = put_u(e, key);
    for (int k = 0; k < 3; k++) { *e++ = ','; e = put_f(e, m.p[k], 2); }
    *e++ = ']'; *e = 0;
    acc_add(&g_acc_pj, entry);
}

static void projectiles_gone(void)
{
    char line[4096];
    size_t n = 0;
    int w = 0;
    for (int i = 0; i < g_proj_n; i++) {
        if (g_proj[i].gen == g_gen) { g_proj[w++] = g_proj[i]; continue; }
        if (!n) n = (size_t)snprintf(line, sizeof(line), "{\"k\":\"pd\",\"t\":%.3f,\"o\":[%u", g_t, g_proj[i].key);
        else if (n + 16 < sizeof(line)) n += (size_t)snprintf(line + n, sizeof(line) - n, ",%u", g_proj[i].key);
    }
    g_proj_n = w;
    if (n) { snprintf(line + n, sizeof(line) - n, "]}"); write_line(line); }
}

#endif /* REC_STAGE3 */

/* --- one object of the world ------------------------------------------------- */

/* What a sample does with one registered object. Returns 1 when the object
 * is one the capture reads (a net id, or a class it samples without one):
 * the live set keeps only those in its per-tick list. */
static int visit_object(uint32_t key, uint32_t obj)
{
#if REC_STAGE3
    uint32_t flags = read_u32(obj + T->obj_flags_off);
    uint32_t nid = T->net_id_of(obj);
    uint32_t vptr = read_u32(obj);
    /* A watched kit is emitted however it is flagged: a carried kit sits
     * disabled in the map until dropped. */
    if (nid && kit_watch_pending(nid)) kit_watch_emit(obj, nid, key);
    /* Child bundles and engines carry no net id: they are sampled for their
     * parts regardless. Roots without one are skipped (the viewer has no id
     * space for them). */
    if (!(flags & FLAG_DISABLED) && (nid || !(flags & FLAG_ROOT)))
        sample_object(key, obj);
    if (nid && !(flags & FLAG_DISABLED) && (flags & FLAG_ROOT) && vptr == T->vt_soldier)
        sample_soldier(obj, nid);
    /* Control points and projectiles in flight: roots the viewer keys by the
     * map's own key (a projectile has no net id). */
    int cp = T->vt_control_point && vptr == T->vt_control_point;
    int proj = T->vt_projectile && vptr == T->vt_projectile;
    if (!(flags & FLAG_DISABLED) && (flags & FLAG_ROOT)) {
        if (cp) sample_cp(obj, key);
        else if (proj) sample_projectile(obj, key);
    }
    return nid || cp || proj || vptr == T->vt_rot_bundle || vptr == T->vt_engine
        || vptr == T->vt_soldier;
#else
    sample_object(key, obj);
    return 1;
#endif
}

#if REC_TICK

/* The live set. The registered-objects map holds ~5,000 objects on a 32-slot
 * level, nearly all of them scenery that never moves; walking it is nine
 * tenths of a sample's cost (461 of 520 us, El Alamein 2026-10-04). The
 * registerObject and unregisterObject hooks keep the set exact; a new object
 * is looked at for PENDING_SAMPLES samples (its networkable may come after
 * its registration), then kept in g_dense or set aside as scenery. */
#define LIVE_SLOTS 32768            /* power of two; ~5k objects */
#define LIVE_REBUILD (30 * 10)      /* samples between full-walk rebuilds */
#define PENDING_SAMPLES 30

enum { LIVE_EMPTY = 0, LIVE_PENDING, LIVE_KEPT, LIVE_SCENERY, LIVE_DEAD };

typedef struct { uint32_t obj; uint32_t vptr; int32_t dense; uint16_t state; uint16_t age; uint32_t gen; } LiveEnt;

static LiveEnt *g_live;
static int32_t *g_dense;            /* indices into g_live */
static int g_dense_n;
static int g_live_used;             /* occupied + dead slots */
static int g_live_ok;               /* hooks in, one thread: the live set drives the samples */
static uint32_t g_live_age, g_live_count;
static pthread_t g_reg_thread;
static int g_reg_thread_set;

static uint32_t live_hash(uint32_t obj) { return (obj * 0x9e3779b1u) & (LIVE_SLOTS - 1); }

static int live_find(uint32_t obj)
{
    for (uint32_t i = live_hash(obj), n = 0; n < LIVE_SLOTS; i = (i + 1) & (LIVE_SLOTS - 1), n++) {
        if (g_live[i].state == LIVE_EMPTY) return -1;
        if (g_live[i].obj == obj && g_live[i].state != LIVE_DEAD) return (int)i;
    }
    return -1;
}

static void live_rehash(void);

static void dense_remove(int d)
{
    int slot = g_dense[d];
    g_live[slot].dense = -1;
    if (d != g_dense_n - 1) {
        g_dense[d] = g_dense[g_dense_n - 1];
        g_live[g_dense[d]].dense = d;
    }
    g_dense_n--;
}

/* `vptr`: 0 while the object may still be in its constructors (registration
 * can come before the most derived one sets it); set on first visit. */
static void live_add(uint32_t obj, uint32_t vptr)
{
    if (obj < 0x1000 || live_find(obj) >= 0) return;
    if (g_live_used >= LIVE_SLOTS * 3 / 4) live_rehash();
    if (g_live_used >= LIVE_SLOTS * 3 / 4) { g_live_ok = 0; return; }   /* full: back to walking */
    uint32_t i = live_hash(obj);
    while (g_live[i].state != LIVE_EMPTY && g_live[i].state != LIVE_DEAD) i = (i + 1) & (LIVE_SLOTS - 1);
    if (g_live[i].state == LIVE_EMPTY) g_live_used++;
    g_live[i].obj = obj;
    g_live[i].vptr = vptr;
    g_live[i].state = LIVE_PENDING;
    g_live[i].age = 0;
    g_live[i].dense = g_dense_n;
    g_dense[g_dense_n++] = (int32_t)i;
}

static void live_remove(uint32_t obj)
{
    int i = live_find(obj);
    if (i < 0) return;
    if (g_live[i].dense >= 0) dense_remove(g_live[i].dense);
    g_live[i].state = LIVE_DEAD;
}

/* Rehash: the dead slots go, every live entry keeps its state. */
static void live_rehash(void)
{
    LiveEnt *old = malloc(sizeof(LiveEnt) * LIVE_SLOTS);
    if (!old) { g_live_ok = 0; return; }
    memcpy(old, g_live, sizeof(LiveEnt) * LIVE_SLOTS);
    memset(g_live, 0, sizeof(LiveEnt) * LIVE_SLOTS);
    g_live_used = 0;
    g_dense_n = 0;
    for (int k = 0; k < LIVE_SLOTS; k++) {
        LiveEnt *o = &old[k];
        if (o->state == LIVE_EMPTY || o->state == LIVE_DEAD) continue;
        uint32_t i = live_hash(o->obj);
        while (g_live[i].state != LIVE_EMPTY) i = (i + 1) & (LIVE_SLOTS - 1);
        g_live[i] = *o;
        g_live_used++;
        g_live[i].dense = -1;
        if (o->state != LIVE_SCENERY) {
            g_live[i].dense = g_dense_n;
            g_dense[g_dense_n++] = (int32_t)i;
        }
    }
    free(old);
}

/* Reconcile with a full walk, the safety net for anything the hooks did not
 * see: objects the map holds and the set does not are added (pending), and
 * entries the map no longer holds are dropped. What the set already knows
 * keeps its state, so the scenery is not looked at again. */
static uint32_t g_live_gen;

static void live_rebuild(uint32_t header, uint32_t count)
{
    g_live_age = 0;
    g_live_gen++;
    uint32_t node = read_u32(header + T->node_leftmost_off);
    uint32_t steps = 0;
    while (node && node != header && steps < count + 16) {
        steps++;
        uint32_t obj = read_u32(node + T->node_value_off);
        if (obj >= T->min_addr) {
            int i = live_find(obj);
            if (i < 0) {
                live_add(obj, read_u32(obj));
                i = live_find(obj);
            }
            if (i >= 0) g_live[i].gen = g_live_gen;
        }
        node = T->tree_successor(node, header);
    }
    int dead = 0;
    for (int k = 0; k < LIVE_SLOTS; k++) {
        LiveEnt *e = &g_live[k];
        if (e->state == LIVE_EMPTY || e->state == LIVE_DEAD) { dead += e->state == LIVE_DEAD; continue; }
        if (e->gen == g_live_gen) continue;
        if (e->dense >= 0) dense_remove(e->dense);
        e->state = LIVE_DEAD;
        dead++;
    }
    if (dead > LIVE_SLOTS / 8) live_rehash();
}

/* One sample over the live set: the kept and the pending. */
static void live_visit(void)
{
    for (int d = 0; d < g_dense_n; ) {
        LiveEnt *e = &g_live[g_dense[d]];
        uint32_t vptr = read_u32(e->obj);
        if (!e->vptr) e->vptr = vptr;
        else if (vptr != e->vptr) {
            /* Destroyed without an unregisterObject we saw: drop it. */
            e->state = LIVE_DEAD;
            dense_remove(d);
            continue;
        }
        int keep = visit_object(read_u32(e->obj + T->obj_id_off), e->obj);
        if (e->state == LIVE_PENDING) {
            if (keep) e->state = LIVE_KEPT;
            else if (++e->age >= PENDING_SAMPLES) {
                e->state = LIVE_SCENERY;
                dense_remove(d);
                continue;
            }
        }
        d++;
    }
}

/* ObjectManager::registerObject / unregisterObject, through their vtable
 * slots (every call is virtual: 164 and 60 call sites, none direct). */
static uint32_t g_orig_register, g_orig_unregister;
static uint32_t g_reg_calls, g_unreg_calls;

static void live_check_thread(void)
{
    if (!g_reg_thread_set) { g_reg_thread = pthread_self(); g_reg_thread_set = 1; return; }
    if (g_live_ok && !pthread_equal(g_reg_thread, pthread_self())) {
        g_live_ok = 0;
        fprintf(stderr, "recorder: objects registered from two threads; sampling walks the map\n");
    }
}

REC_GAME_THREAD_ENTRY uint32_t recorder_register_object(void *om, uint32_t obj)
{
    uint32_t r = ((uint32_t (*)(void *, uint32_t))(uintptr_t)g_orig_register)(om, obj);
    g_reg_calls++;
    if (g_live) {
        live_check_thread();
        if (g_live_ok) live_add(obj, 0);
    }
    return r;
}

REC_GAME_THREAD_ENTRY uint32_t recorder_unregister_object(void *om, uint32_t obj)
{
    g_unreg_calls++;
    if (g_live) {
        live_check_thread();
        if (g_live_ok) live_remove(obj);
    }
    return ((uint32_t (*)(void *, uint32_t))(uintptr_t)g_orig_unregister)(om, obj);
}

static int patch_slot(uint32_t slot, uint32_t expect, void *mine, uint32_t *orig, const char *what)
{
    uint32_t have = 0;
    if (!slot || !T->safe_read(&have, 4, slot) || have != expect) {
        fprintf(stderr, "recorder: %s slot %08x holds %08x, not %08x: not hooked\n", what, slot, have, expect);
        return 0;
    }
    *orig = have;
    uint32_t p = (uint32_t)(uintptr_t)mine;
    if (!T->patch_write(slot, &p, 4)) {
        fprintf(stderr, "recorder: could not patch the %s slot\n", what);
        return 0;
    }
    return 1;
}

static void install_live_hooks(void)
{
    if (!T->om_register_slot) return;
    g_live = calloc(LIVE_SLOTS, sizeof(LiveEnt));
    g_dense = calloc(LIVE_SLOTS, sizeof(int32_t));
    if (!g_live || !g_dense) { free(g_live); free(g_dense); g_live = 0; g_dense = 0; return; }
    /* Unregister first: a register hooked alone would keep the dead. */
    if (!patch_slot(T->om_unregister_slot, T->om_unregister_fn, recorder_unregister_object,
                    &g_orig_unregister, "unregisterObject"))
        return;
    if (!patch_slot(T->om_register_slot, T->om_register_fn, recorder_register_object,
                    &g_orig_register, "registerObject")) {
        /* Put unregister back: the set would never grow. */
        T->patch_write(T->om_unregister_slot, &g_orig_unregister, 4);
        return;
    }
    g_live_ok = 1;
    g_live_age = LIVE_REBUILD;   /* the first sample builds it from the map */
    fprintf(stderr, "recorder: live set hooked (registerObject %08x, unregisterObject %08x)\n",
            T->om_register_slot, T->om_unregister_slot);
}

#endif /* REC_TICK */

/* --- the sampler ------------------------------------------------------------------ */

/* A file opens once the world holds this many registered objects: a level
 * is loaded (or loading), not the empty manager of a server between maps. */
#define OPEN_MIN_OBJECTS 64

/* Round state that belongs to one file (the sampling side's). */
static void reset_file_state(void)
{
    g_tracked_n = 0;
    hash_rebuild();
#if REC_STAGE3
    parts_reset();
    g_players_n = 0;
    T->rec_lock();
    g_kit_watch_n = 0;
    T->rec_unlock();
    g_soldiers_n = 0;
    g_level_written = 0;
    g_level_name[0] = 0;
    g_anim_written = 0;
    g_tickets[0] = g_tickets[1] = -1;
    g_score_manager = 0;
    g_cps_n = 0;
    g_proj_n = 0;
#endif
}

/* Close this file with its end record; the next sample opens a fresh one
 * with a fresh clock. */
static void split_file(const char *why)
{
    acc_flush_all();
    T->rec_lock();
    file_close_locked(T->now_s() - g_t0);
    g_t0 = 0.0;
    T->rec_unlock();
    reset_file_state();
    fprintf(stderr, "recorder: file closed (%s)\n", why);
}

/* The sampling side's state across samples. */
static double s_next_sample;
static uint32_t s_peak_count;      /* this file's most registered objects */
static double s_next_level_check;
/* After an unload split: the fewest objects seen since. The next file opens
 * once the count climbs OPEN_MIN_OBJECTS above it (the next level loading),
 * not on the way down. */
static int s_after_unload;
static uint32_t s_trough;
static int s_low_samples;          /* consecutive samples under peak / 4 */
static char s_other_level[64];     /* a different level name, seen once */
static uint32_t s_last_count;      /* registered objects at the last sample */

/* One sample of the world. Tick mode calls it on the game thread when a
 * sample is due; the sampler thread calls it every 30 Hz wake-up and it
 * decides by the clock. */
static void sampler_step(int tick_mode)
{
    uint32_t om = read_u32(T->object_manager_ptr);
    uint32_t count = om >= T->min_addr ? read_u32(om + T->map_count_off) : 0;
    s_last_count = count;

    if (!file_is_open()) {
        if (s_after_unload) {
            if (count < s_trough) s_trough = count;
            if (count < s_trough + OPEN_MIN_OBJECTS) return;
            s_after_unload = 0;
        }
        if (count < OPEN_MIN_OBJECTS) return;
        T->rec_lock();
        if (!file_is_open() && g_on) {   /* g_on: shutdown may have run meanwhile */
            file_open_locked();
            if (file_is_open()) {
                g_t0 = T->now_s();
                s_next_sample = 1.0 / g_hz;
                s_next_level_check = 2.0;
                s_peak_count = 0;
#if REC_STAGE3
                held_flush_locked();
#endif
            }
        }
        T->rec_unlock();
        if (!file_is_open()) { g_on = 0; return; }
    }

    double t = T->now_s() - g_t0;
    if (!tick_mode) {
        if (t < s_next_sample) return;
        if (T->sample_reset_next) s_next_sample = t + 1.0 / g_hz;
        else s_next_sample += 1.0 / g_hz;
    }

    if (!om || om < T->min_addr) return;

    /* A map change: the world emptied (the level unloading -- a same-map
     * reload changes no name), or the setup names another level than the one
     * this file announced. One file per level. */
    if (count > s_peak_count && count <= 1000000u) s_peak_count = count;
    if (s_peak_count >= 4 * OPEN_MIN_OBJECTS && count < s_peak_count / 4) {
        if (++s_low_samples >= 3) {
            s_low_samples = 0;
            split_file("world unloaded");
            s_after_unload = 1;
            s_trough = count;
            return;
        }
    } else {
        s_low_samples = 0;
    }
#if REC_STAGE3
    if (g_level_written && t >= s_next_level_check) {
        s_next_level_check = t + 2.0;
        char level[64];
        uint32_t gpm;
        read_level(level, sizeof(level), &gpm);
        if (level[0] && strcmp(level, g_level_name) != 0) {
            if (!strcmp(level, s_other_level)) {
                s_other_level[0] = 0;
                split_file("level changed");
                return;
            }
            snprintf(s_other_level, sizeof(s_other_level), "%s", level);
        } else {
            s_other_level[0] = 0;
        }
    }
#endif

    uint32_t header = read_u32(om + T->map_head_off);
    if (!header || header < T->min_addr) return;

    if (g_debug) {
        static double last_dbg = 0.0;
#if REC_STAGE3
        static int census_done = 0;
        if (!census_done && g_tracked_n > 0) {
            census_done = 1;
            /* One-shot census: every registered object's vptr, and the
             * flags word, to see which classes the map holds. */
            struct { uint32_t vt; int n; } top[32] = {};
            int ntop = 0;
            uint32_t n2 = read_u32(header + T->node_leftmost_off);
            uint32_t ms2 = read_u32(om + T->map_count_off) + 16;
            uint32_t st2 = 0;
            while (n2 && n2 != header && st2 < ms2) {
                st2++;
                uint32_t o2 = read_u32(n2 + T->node_value_off);
                if (o2 >= 0x1000) {
                    uint32_t v2 = read_u32(o2);
                    int found = 0;
                    for (int i = 0; i < ntop; i++)
                        if (top[i].vt == v2) { top[i].n++; found = 1; break; }
                    if (!found && ntop < 32) { top[ntop].vt = v2; top[ntop++].n = 1; }
                }
                n2 = T->tree_successor(n2, header);
            }
            fprintf(stderr, "recorder dbg: vptr census:");
            for (int i = 0; i < ntop; i++) {
                fprintf(stderr, " %08x:%d", top[i].vt, top[i].n);
            }
            fprintf(stderr, "\n");
            /* Name one object of each top vptr (from the object's own
             * template): tells the rot/engine/soldier vtables apart. */
            uint32_t n3 = read_u32(header + T->node_leftmost_off);
            uint32_t ms3 = read_u32(om + T->map_count_off) + 16;
            uint32_t st3 = 0;
            while (n3 && n3 != header && st3 < ms3) {
                st3++;
                uint32_t o3 = read_u32(n3 + T->node_value_off);
                if (o3 >= 0x1000) {
                    uint32_t v3 = read_u32(o3);
                    for (int i = 0; i < ntop; i++) {
                        if (top[i].vt != v3 || top[i].n < 1) continue;
                        if (top[i].n == -1) break;
                        uint32_t t3 = read_u32(o3 + T->obj_tmpl_off);
                        char nm[64] = "";
                        if (t3 >= T->min_tmpl_addr)
                            T->read_template_name(t3, nm, sizeof(nm));
                        fprintf(stderr, "recorder dbg: vt %08x count %d tmpl '%s'\n",
                                top[i].vt, top[i].n, nm);
                        top[i].n = -1;   /* named */
                    }
                }
                n3 = T->tree_successor(n3, header);
            }
            fprintf(stderr, "recorder dbg: expect rot=%08x engine=%08x soldier=%08x\n",
                    T->vt_rot_bundle, T->vt_engine, T->vt_soldier);
            /* w32 layout probes: the playerManager's list fields, and one
             * root object's tail (+0xb0..+0x110: root cache / component
             * map region, see w32ded-offsets.md pass 4). */
            uint32_t pmx = read_u32(T->player_manager_ptr);
            fprintf(stderr, "recorder dbg: pm %08x:", pmx);
            if (pmx >= 0x1000)
                for (int w = 0; w < 0x40; w += 4)
                    fprintf(stderr, " +%x=%08x", w, read_u32(pmx + w));
            fprintf(stderr, "\n");
            uint32_t n4 = read_u32(header + T->node_leftmost_off);
            uint32_t ms4 = read_u32(om + T->map_count_off) + 16;
            uint32_t st4 = 0;
            while (n4 && n4 != header && st4 < ms4) {
                st4++;
                uint32_t o4 = read_u32(n4 + T->node_value_off);
                n4 = T->tree_successor(n4, header);
                if (o4 < 0x1000) continue;
                if ((read_u32(o4 + 4) & 0x02000000u) &&
                    T->net_id_of(o4) && !(read_u32(o4 + 4) & 1u)) {
                    fprintf(stderr, "recorder dbg: root %08x tail:",
                            o4);
                    for (int w = 0xb0; w < 0x110; w += 4)
                        fprintf(stderr, " +%x=%08x", w, read_u32(o4 + w));
                    fprintf(stderr, "\n");
                    break;
                }
            }
        }
        if (t < last_dbg) last_dbg = t;   /* a new file's clock */
        if (t - last_dbg > 5.0) {
            last_dbg = t;
            fprintf(stderr, "recorder dbg: count=%u tracked=%d players=%d parts=%d soldiers=%d kitwatch=%d held=%d evcalls=%d fires=%d/%d\n",
                    read_u32(om + T->map_count_off), g_tracked_n, g_players_n, g_parts_n, g_soldiers_n,
                    g_kit_watch_n, g_held_n, g_event_calls, g_fire_written, g_fire_calls);
            if (g_debug) {
                fprintf(stderr, "recorder dbg: types:");
                for (int ty = 0; ty < 64; ty++)
                    if (g_event_type_hist[ty]) fprintf(stderr, " %02x:%d", ty, g_event_type_hist[ty]);
                fprintf(stderr, "\n");
            }
        }
#else
        if (t - last_dbg > 5.0) {
            last_dbg = t;
            fprintf(stderr, "recorder dbg: count=%u tracked=%d\n",
                    read_u32(om + T->map_count_off), g_tracked_n);
        }
#endif
    }

    g_t = t;
    g_gen++;
#if REC_STAGE3
    for (int i = 0; i < g_soldiers_n; i++) g_soldiers[i].seen = 0;

    if (!g_level_written) write_level();
#endif

#if REC_TICK
    /* The live set: every registered object, kept by the registerObject /
     * unregisterObject hooks, and the ones worth a look in g_dense. Rebuilt
     * from a full walk every LIVE_REBUILD samples, and at once when the world
     * shrinks by half (a level unloading with deleteAllRegisteredObjects,
     * which three direct calls reach without unregisterObject). */
    if (g_live_ok) {
        if (++g_live_age >= LIVE_REBUILD || count < g_live_count / 2) live_rebuild(header, count);
        g_live_count = count;
        live_visit();
    } else
#endif
    {
        /* Walk bounded to the map's own count + 16: during map load a node
         * can be walked whose successor cycles (the same spin the lnxded
         * sampler hit; see README stage 2). */
        uint32_t node = read_u32(header + T->node_leftmost_off);
        uint32_t max_steps = (T->walk_clamp_count && count > 100000u ? 100000u : count) + 16;
        uint32_t steps = 0;
        while (node && node != header && steps < max_steps) {
            steps++;
            uint32_t obj = read_u32(node + T->node_value_off);
            if (obj >= T->min_addr) visit_object(read_u32(node + T->node_key_off), obj);
            node = T->tree_successor(node, header);
        }
    }

#if REC_STAGE3
    soldiers_prune();
    sample_players();
    projectiles_gone();
    sample_tickets(t);
    kit_watch_compact();
    if (g_gen % 10 == 0) parts_prune(g_gen);
#endif

    /* vanishings: ids whose generation is behind, compacted away. */
    int w = 0;
    for (int i = 0; i < g_tracked_n; i++) {
        if (g_tracked[i].gen != g_gen) {
            char line[128];
            snprintf(line, sizeof(line), "{\"k\":\"d\",\"t\":%.3f,\"id\":%u}",
                     t, g_tracked[i].nid);
            write_line(line);
            continue;
        }
        if (w != i) g_tracked[w] = g_tracked[i];
        w++;
    }
    if (w != g_tracked_n) {
        g_tracked_n = w;
        hash_rebuild();
    }
    acc_flush_all();
#if !REC_STAGE3 && !REC_TICK
    fflush(g_file);
#endif
}

#if !REC_TICK
static void *sampler(void *arg)
{
    (void)arg;
    for (;;) {
        T->rec_sleep();
        if (!g_on) continue;
        sampler_step(0);
    }
    return 0;
}
#endif

/* --- tick mode: the game thread samples ------------------------------------------- */

#if REC_TICK

/* The fault guard. The tick sample reads the game's memory with plain loads
 * (exact, and a few hundred times cheaper than a /proc/self/mem pread). A
 * pointer the recorder misjudges must not take the server down: a SIGSEGV
 * or SIGBUS on the game thread inside the sample jumps back to the tick
 * entry, which ends the sample there. Any other fault goes to whatever
 * handler was installed before ours, or to the default action. */
static sigjmp_buf g_guard_jmp;
static volatile sig_atomic_t g_guard_on;
static pthread_t g_game_thread;
static struct sigaction g_prev_segv, g_prev_bus;
static int g_faults;
#define MAX_FAULTS 64

static void guard_handler(int sig, siginfo_t *si, void *uc)
{
    if (g_guard_on && pthread_equal(pthread_self(), g_game_thread)) {
        g_guard_on = 0;
        siglongjmp(g_guard_jmp, sig);
    }
    struct sigaction *prev = sig == SIGBUS ? &g_prev_bus : &g_prev_segv;
    if ((prev->sa_flags & SA_SIGINFO) && prev->sa_sigaction) {
        prev->sa_sigaction(sig, si, uc);
        return;
    }
    if (!(prev->sa_flags & SA_SIGINFO) && prev->sa_handler != SIG_DFL && prev->sa_handler != SIG_IGN) {
        prev->sa_handler(sig);
        return;
    }
    /* Nothing before us: restore the default; the faulting instruction runs
     * again and the process dies as it would have without the recorder. */
    struct sigaction dfl;
    memset(&dfl, 0, sizeof(dfl));
    dfl.sa_handler = SIG_DFL;
    sigaction(sig, &dfl, 0);
}

/* Ours, ahead of whatever the server installed (checked each sample: the
 * engine may install its own after we did). */
static void guard_install(void)
{
    struct sigaction cur;
    if (sigaction(SIGSEGV, 0, &cur) == 0 && (cur.sa_flags & SA_SIGINFO) && cur.sa_sigaction == guard_handler)
        return;
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = guard_handler;
    sa.sa_flags = SA_SIGINFO;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGSEGV, &sa, &g_prev_segv);
    sigaction(SIGBUS, &sa, &g_prev_bus);
}

/* Samples per tick: the server simulates at 30 Hz (D-1); replaySampleHz is
 * rounded to a whole number of ticks. */
static uint32_t g_tick_n, g_tick_div = 1;

static double g_server_sum, g_server_max;
static uint32_t g_server_n;

/* What the sample costs the game thread, written once a minute as a `perf`
 * line (the viewer skips it) and to stderr. */
static double g_perf_sum, g_perf_max, g_perf_next, g_perf_last_t;
static uint32_t g_perf_n, g_perf_bursts;

void recorder_core_tick(void)
{
    if (!g_on) return;
    if (++g_tick_n % g_tick_div) return;
    g_game_thread = pthread_self();
    guard_install();
    double t0 = T->now_s();
    g_in_sample = 1;
    if (sigsetjmp(g_guard_jmp, 1) == 0) {
        g_guard_on = 1;
        g_direct = 1;
        sampler_step(1);
        g_direct = 0;
        g_guard_on = 0;
    } else {
        g_direct = 0;
        g_guard_on = 0;
        g_faults++;
        if (g_faults <= 5)
            fprintf(stderr, "recorder: a read faulted in the tick sample (%d); that sample is cut short\n", g_faults);
        if (g_faults >= MAX_FAULTS) {
            g_on = 0;
            fprintf(stderr, "recorder: %d faulted samples, recording stopped\n", g_faults);
        }
        acc_flush_all();   /* what the sample made before the fault is good */
    }
    g_in_sample = 0;
    T->rec_lock();
    sbuf_commit_locked();
    T->rec_unlock();

    double t1 = T->now_s();
    double us = (t1 - t0) * 1e6;
    g_perf_sum += us;
    if (us > g_perf_max) g_perf_max = us;
    g_perf_n++;
    /* Two samples closer than half a sample period: the server stepped
     * several ticks in one frame (a catch-up, D-4), and the stamps bunch. */
    if (g_perf_last_t > 0.0 && t0 - g_perf_last_t < 0.5 * g_tick_div / 30.0) g_perf_bursts++;
    g_perf_last_t = t0;
    if (t1 >= g_perf_next) {
        if (g_perf_next > 0.0 && g_perf_n && file_is_open()) {
            char line[256];
            double server_mean = g_server_n ? g_server_sum / g_server_n : 0.0;
            snprintf(line, sizeof(line),
                "{\"k\":\"perf\",\"t\":%.3f,\"samples\":%u,\"mean_us\":%.0f,\"max_us\":%.0f"
                ",\"tick_mean_us\":%.0f,\"tick_max_us\":%.0f"
                ",\"objects\":%u,\"bursts\":%u,\"faults\":%d,\"dropped\":%u}",
                t1 - g_t0, g_perf_n, g_perf_sum / g_perf_n, g_perf_max, server_mean, g_server_max,
                s_last_count, g_perf_bursts, g_faults, g_q_dropped);
            write_line(line);
            fprintf(stderr, "recorder: %u samples, %.0f us mean, %.0f us max; the server's tick %.0f us mean, "
                    "%.0f max; %u objects, %u bursts\n",
                    g_perf_n, g_perf_sum / g_perf_n, g_perf_max, server_mean, g_server_max,
                    s_last_count, g_perf_bursts);
            int pending = 0, kept = 0, dead = 0;
            for (int k = 0; g_live && k < LIVE_SLOTS; k++) {
                pending += g_live[k].state == LIVE_PENDING;
                kept += g_live[k].state == LIVE_KEPT;
                dead += g_live[k].state == LIVE_DEAD;
            }
            fprintf(stderr, "recorder: live set %s: dense %d (kept %d, pending %d), dead slots %d, used %d; "
                    "registered %u, unregistered %u this minute\n", g_live_ok ? "on" : "off",
                    g_dense_n, kept, pending, dead, g_live_used, g_reg_calls, g_unreg_calls);
            g_reg_calls = g_unreg_calls = 0;
        }
        g_perf_sum = g_perf_max = 0.0;
        g_perf_n = g_perf_bursts = 0;
        g_server_sum = g_server_max = 0.0;
        g_server_n = 0;
        g_perf_next = t1 + 60.0;
    }
}

/* GameServer::simulateFrame, through its vtable slot: the server's one tick.
 * Called once per tick from GameServer::update's tick loop (0x081329a6);
 * returns 1 in eax (no x87 result to preserve). The float is passed through
 * as its bits. */
static uint32_t g_orig_simulate;

/* The server's own tick is timed beside ours for the perf line
 * (g_server_*). */

REC_GAME_THREAD_ENTRY uint32_t recorder_simulate_frame(void *self, uint32_t dt_bits)
{
    double t0 = g_on ? T->now_s() : 0.0;
    uint32_t r = ((uint32_t (*)(void *, uint32_t))(uintptr_t)g_orig_simulate)(self, dt_bits);
    if (g_on) {
        double us = (T->now_s() - t0) * 1e6;
        g_server_sum += us;
        if (us > g_server_max) g_server_max = us;
        g_server_n++;
    }
    recorder_core_tick();
    return r;
}

static int install_tick_hook(void)
{
    if (!T->gs_simulate_slot) return 0;
    uint32_t have = 0;
    if (!T->safe_read(&have, 4, T->gs_simulate_slot) || have != T->gs_simulate_fn) {
        fprintf(stderr, "recorder: simulateFrame slot %08x holds %08x, not %08x: no tick hook\n",
                T->gs_simulate_slot, have, T->gs_simulate_fn);
        return 0;
    }
    g_orig_simulate = have;
    uint32_t mine = (uint32_t)(uintptr_t)recorder_simulate_frame;
    if (!T->patch_write(T->gs_simulate_slot, &mine, 4)) {
        fprintf(stderr, "recorder: could not patch the simulateFrame slot\n");
        return 0;
    }
    fprintf(stderr, "recorder: tick hook in GameServer::simulateFrame's slot %08x\n", T->gs_simulate_slot);
    return 1;
}

#endif /* REC_TICK */

/* --- entry --------------------------------------------------------------- */

void recorder_core_init(const struct rec_target *target)
{
    T = target;
    read_config();
    if (!g_on) return;
    g_tracked = calloc(MAX_TRACKED, sizeof(Tracked));
    g_hash = calloc(HASH_SLOTS, sizeof(int32_t));
    if (!g_tracked || !g_hash) {
        fprintf(stderr, "recorder: out of memory at load, not started\n");
        g_on = 0;
        return;
    }
#if REC_STAGE3
    g_parts = calloc(MAX_PARTS, sizeof(Part));
    g_players = calloc(MAX_PLAYERS, sizeof(Plyr));
    g_held = calloc(HELD_MAX, sizeof(HeldEvent));
    if (!g_parts || !g_players || !g_held) {
        fprintf(stderr, "recorder: out of memory at load, not started\n");
        g_on = 0;
        return;
    }
#endif
    hash_rebuild();
#if REC_STAGE3
    T->install_detours();
#else
    if (T->install_detours) T->install_detours();   /* w32ded: stubbed */
#endif
#if REC_TICK
    g_tick_div = (uint32_t)((30.0 / g_hz) + 0.5);
    if (g_tick_div < 1) g_tick_div = 1;
    install_tick_hook();   /* the harness has no slot: it calls recorder_core_tick */
    install_live_hooks();
    T->start_sampler_thread(writer);
    fprintf(stderr, "recorder: writer thread started; sampling every %u tick(s)\n", g_tick_div);
#else
    T->start_sampler_thread(sampler);
    fprintf(stderr, "recorder: sampler thread started\n");
#endif
}

/* Detach: close the recording with its end record (w32ded's DllMain at
 * DLL_PROCESS_DETACH, lnxded's destructor when the server exits). */
void recorder_core_shutdown(void)
{
    if (!T) return;
    T->rec_lock();
    g_on = 0;   /* nothing opens a new file after this */
    file_close_locked(T->now_s() - g_t0);
    T->rec_unlock();
#if REC_TICK
    g_writer_quit = 1;
    drain_once();
    drain_once();   /* both buffers: the writer may have swapped meanwhile */
#endif
}
