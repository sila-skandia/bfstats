/*
 * Server-side round replay recorder (stage 3: parity with the client recorder).
 *
 * A 32-bit ELF shared object loaded into bf1942_lnxded via LD_PRELOAD
 * (the lab's scenario `preload` key). Two capture surfaces:
 *
 *   1. A sampler thread polls the object manager's registered-object map and
 *      the player list at a fixed rate: root object transforms, ARMOR hit
 *      points, moving parts (RotationalBundle: turrets, gun mounts, airplane
 *      propellers), engines (revs/gear: the sound note), soldiers' animation
 *      states, and the two sides' tickets.
 *   2. Inline detours on the game thread capture what the server BUILDS for
 *      clients: GameEventManager::addEventToSendQueue (every game event:
 *      createPlayer with the real kit, pickupKit, enter/exitVehicle, kills
 *      with the weapon, chat, radio, tickets' game flow) and
 *      FireArms::fireBarrel (every round any player or bot fires).
 *
 * Output is newline-delimited JSON in the bf42plus client recorder's format
 * v5, played by tools/bf1942-models/viewer/replay-recording.js.
 *
 * Everything about the target's layout was read out of the server binary
 * itself (each offset in a comment below names the accessor or ctor it was
 * read from); the addresses are in README.md. Addresses valid for the lab's
 * bf1942_lnxded (non-PIE ET_EXEC: load address == static address).
 *
 * Config: <cwd>/mods/bf1942/settings/recorder.con, one key per line:
 *   recordReplays 1        off unless present
 *   replaySampleHz 10      samples per second (client recorder used 10)
 * RECORDER_DEBUG=1 in the environment prints one diagnostic line every 5 s.
 * Writes replays/replay_<unixts>.ndjson under the server's cwd.
 */

#define _FILE_OFFSET_BITS 64

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <fcntl.h>
#include <math.h>
#include <stdarg.h>
#include <time.h>
#include <pthread.h>
#include <unistd.h>
#include <sys/mman.h>

/* --- target addresses (nm / decompile, see README.md) ------------------- */

#define OBJECT_MANAGER_PTR   0x0871dc24u  /* dice::ref2::world::objectManager */
#define PLAYER_MANAGER_PTR   0x0871dc2cu  /* dice::ref2::world::playerManager */
#define TEMPLATE_MANAGER_PTR 0x0871dc28u  /* dice::ref2::world::objectTemplateManager */
#define SETUP_PTR            0x08716b64u  /* dice::bf::setup (score manager at +0x410) */

/* vtable symbols; a gcc vptr holds symbol + 8 (first virtual entry). */
#define VT_ROT_BUNDLE        0x08724e08u  /* RotationalBundle: turret, propeller, gun mount */
#define VT_ENGINE            0x0872bc68u  /* Engine (extends RotationalBundle) */
#define VT_SOLDIER           0x0872f048u  /* BFSoldier */
#define VT_PHYS_ENGINE       0x0872d608u  /* PhysicsEngine */

/* Functions the detours call or patch. */
#define ADD_EVENT_SEND_QUEUE 0x0812d730u  /* GameEventManager::addEventToSendQueue */
#define SEND_EVENT_TO_ALL    0x08153b10u  /* GameServer::sendGameEventToAll(const&, bool) */
#define FIRE_BARREL          0x0828aba0u  /* FireArms::fireBarrel(IPlayer*, Mat4&, int) */
#define GET_ROOT_PARENT      0x0818d4b0u  /* getRootParent(ICompositeObject const*) */
#define GET_BF_PLAYER        0x08052ac0u  /* getBFPlayer(IPlayer*) */

static const uint32_t FLAG_ROOT = 0x02000000u;   /* byte at obj+7 bit 1 (getRootParent 0x0818d4b0) */
static const uint32_t FLAG_DISABLED = 1u;

/* --- config ------------------------------------------------------------ */

static volatile int g_on = 0;
static int g_hz = 10;
static int g_debug = 0;
static volatile int g_hook_active = 0;  /* addEventToSendQueue patched */

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

static FILE *g_file = 0;
static pthread_mutex_t g_write_lock = PTHREAD_MUTEX_INITIALIZER;

/* The clock every line shares: 0 at file open, so both writers agree and the
 * viewer's sanity gate (LONGEST_RECORDING, 12 h) stays happy. The sampler
 * seeds g_t0; the game-thread hooks read it (0 until then: they buffer). */
static double g_t0 = 0.0;

static void json_escape(const char *in, char *out, size_t cap)
{
    size_t o = 0;
    for (const char *p = in; *p && o + 7 < cap; p++) {
        unsigned char c = (unsigned char)*p;
        if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = c; }
        else if (c < 0x20) { out[o++] = ' '; }
        else out[o++] = (char)c;
    }
    out[o] = 0;
}

static void open_file_locked(void)
{
    (void)system("mkdir -p replays");
    char name[256];
    snprintf(name, sizeof(name), "replays/replay_%ld.ndjson", (long)time(0));
    g_file = fopen(name, "w");
    if (!g_file) {
        fprintf(stderr, "recorder: cannot open %s\n", name);
        return;
    }
    char iso[64];
    time_t now = time(0);
    strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%S", localtime(&now));
    /* v5: keyed moving parts (`jn`), so the viewer can mount them on nodes. */
    fprintf(g_file,
            "{\"k\":\"h\",\"v\":5,\"plus\":\"server-replay-recorder\","
            "\"start\":\"%s\",\"hz\":%d}\n", iso, g_hz);
    fprintf(stderr, "recorder: recording to %s\n", name);
}

static void write_line(const char *line)
{
    pthread_mutex_lock(&g_write_lock);
    if (g_file) {
        fputs(line, g_file);
        fputc('\n', g_file);
        fflush(g_file);
    }
    pthread_mutex_unlock(&g_write_lock);
}

/* --- safe reads --------------------------------------------------------- */

/* A torn read or a pointer racing a destroy must not kill the server.
 * Read through the kernel's copy of our own address space. Offsets are
 * 64-bit even in this 32-bit process: heap addresses top out in 0xf7xxxxxx,
 * which a 32-bit off_t sign-extends and fails on. */
static int mem_fd = -1;
static int mem_fd_write = -1;

static int safe_read(void *dst, size_t len, uintptr_t addr)
{
    if (mem_fd < 0) mem_fd = open("/proc/self/mem", O_RDONLY);
    if (mem_fd < 0) return 0;
    return pread(mem_fd, dst, len, (off_t)addr) == (ssize_t)len;
}

static uint32_t read_u32(uintptr_t addr)
{
    uint32_t v = 0;
    safe_read(&v, 4, addr);
    return v;
}

/* The detour installer: .text is mapped read-only, /proc/self/mem writes
 * through the page protection (the standard self-patching route). */
static int patch_write(uintptr_t addr, const void *src, size_t len)
{
    if (mem_fd_write < 0) mem_fd_write = open("/proc/self/mem", O_WRONLY);
    if (mem_fd_write < 0) return 0;
    return pwrite(mem_fd_write, src, len, (off_t)addr) == (ssize_t)len;
}

/* --- std::string / names ------------------------------------------------- */

/* A std::string in this libstdc++ (SGI) is one pointer to the chars. */
static void read_string(uintptr_t str_obj, char *out, size_t cap)
{
    out[0] = 0;
    if (str_obj < 0x1000) return;
    uint32_t sp = read_u32(str_obj);
    if (sp < 0x1000) return;
    char buf[128];
    if (!safe_read(buf, sizeof(buf), sp)) return;
    buf[sizeof(buf) - 1] = 0;
    size_t n = strnlen(buf, sizeof(buf) - 1);
    if (n >= cap) n = cap - 1;
    memcpy(out, buf, n);
    out[n] = 0;
}

/* The networkable's u16 id: IObject+0x68 -> NetworkableBase, word at +4
 * (the shape GameEventManager::createPlayer 0x0812d080 reads to fill an
 * event's netId fields; verified live on a soldier). The getNetworkable
 * virtual is NOT the way on the server: the IObject slots past +0xb4 are
 * pure-virtual in BObject<IObject>'s vtable. */
static uint32_t net_id_of(uintptr_t obj)
{
    uint32_t net = read_u32(obj + 0x68);
    if (net < 0x1000) return 0;
    return read_u32(net + 4) & 0xffff;
}

static double now_s(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

/* A template by its network id (createObject events, kills' weapon names):
 * ObjectTemplateManager::getTemplate(unsigned) 0x081d5ed0 reads the
 * u32->template map at manager+8, value at node+0x14. */
static uintptr_t rbtree_find_value(uintptr_t mapaddr, uint32_t key);

static uintptr_t template_by_id(uint32_t tid)
{
    uint32_t mgr = read_u32(TEMPLATE_MANAGER_PTR);
    if (mgr < 0x1000) return 0;
    return rbtree_find_value(mgr + 8, tid);
}

static void template_name_by_id(uint32_t tid, char *out, size_t cap)
{
    out[0] = 0;
    if (tid == 0 || tid > 0x00ffffff) return;
    uintptr_t tmpl = template_by_id(tid);
    if (tmpl < 0x1000) return;
    read_string(tmpl + 8, out, cap);   /* ObjectTemplate::getName 0x081d4c60 */
}

/* --- an SGI-STL rb-tree find ---------------------------------------------- */

/* This libstdc++'s map for scalar keys: header-node pointer at `mapaddr`,
 * node count at mapaddr+4; a node: color 0, parent +4, left +8, right +0xc,
 * pair key +0x10, value +0x14 (the shape the registered-objects map at
 * om+0x94 and ObjectTemplateManager's at mgr+8 share). Returns the node's
 * VALUE for `key`, or 0. Bounded to the map's count + 8. */
static uintptr_t rbtree_find_value(uintptr_t mapaddr, uint32_t key)
{
    uint32_t header = read_u32(mapaddr);
    if (header < 0x1000) return 0;
    uint32_t count = read_u32(mapaddr + 4);
    if (count > 100000) return 0;
    uint32_t node = read_u32(header + 8);       /* header->left: leftmost */
    uint32_t steps = count + 8;
    while (node >= 0x1000 && node != header && steps--) {
        uint32_t nkey = read_u32(node + 0x10);
        if (nkey == key) return read_u32(node + 0x14);
        if (key < nkey) node = read_u32(node + 8);       /* left */
        else node = read_u32(node + 0xc);                /* right */
    }
    return 0;
}

/* --- armor ----------------------------------------------------------------- */

/* Armor holds an object's hit points. The getters read the same offsets as
 * the client's: getHitPoints 0x08173f30 +0x38, getMaxHitPoints 0x08173f20
 * +0x3c, getCriticalDamage 0x081741b0 +0xf0, getLastHitPlayer 0x081740d0
 * +0x14, TeamScore-style setTickets-verified field shapes. The Armor
 * component itself is found in the object's component map, the rb-tree at
 * IObject+0xb8 (BObject<ICompositeObject>::queryComponent 0x08193fd0's
 * fallback: key 0xc4a4, SmartPtr value at node+0x14) -- read directly, no
 * virtual call from a thread that is not the game's. */
static const uint32_t IID_ARMOR = 0xc4a4u;

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
    return safe_read(&out->hitPoints, 4, armor + 0x38)
        && safe_read(&out->maxHitPoints, 4, armor + 0x3c)
        && safe_read(&out->criticalDamage, 4, armor + 0xf0)
        && safe_read(&out->lastHitPlayer, 4, armor + 0x14);
}

/* The Armor component, looked up once per object (the pointer lives as long
 * as the object does; the object is gone from the map before it frees). */
static uintptr_t find_armor(uintptr_t obj)
{
    return rbtree_find_value(obj + 0xb8, IID_ARMOR);
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

/* The root of `obj`'s parent chain: parent at IObject+0x50 (getRootParent
 * 0x0818d4b0), root flag byte at obj+7 bit 1. Bounded walk. */
static uintptr_t root_of(uintptr_t obj)
{
    uintptr_t root = obj;
    for (int depth = 0; depth < 32; depth++) {
        if ((read_u32(root + 4) & FLAG_ROOT) || root < 0x1000) break;
        uintptr_t parent = read_u32(root + 0x50);
        if (parent < 0x1000) break;
        root = parent;
    }
    return root;
}

/* --- objects --------------------------------------------------------------- */

/* Every root object the map holds (Wake: ~4.6k registered). State persists
 * across samples; a per-sample generation marks who was seen. */
#define MAX_TRACKED 8192

typedef struct {
    uint32_t key; /* the registered map's key (IObject+0x58) */
    uint32_t nid; /* the networkable's id: what the viewer's ids are */
    uint32_t gen;
    float x, y, z, qx, qy, qz, qw;
    int has_armor;
    uintptr_t armor_ptr;   /* the Armor component, found once (components map at IObject+0xb8) */
    float hp;
    int32_t last_hit;
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

/* --- moving parts (v5: jn / j / g lines) ------------------------------------ */

/* A child bundle's own id, numbered once per file: its networkable has no id
 * (getID() 0 for every child; a v4 file keyed them all 0). Keyed by object
 * pointer, re-keyed when the root or the template changes -- an address the
 * allocator handed to an object under another root is a new part. */
#define MAX_PARTS 4096

typedef struct {
    uintptr_t obj;
    uint32_t root_nid;
    uintptr_t tmpl;
    int id;
} PartId;

static PartId *g_parts;
static int g_parts_n;
static int g_next_part_id = 1;

static int part_id_of(uintptr_t obj, uint32_t root_nid, uintptr_t tmpl, int *first)
{
    for (int i = 0; i < g_parts_n; i++) {
        if (g_parts[i].obj == obj) {
            if (g_parts[i].root_nid == root_nid && g_parts[i].tmpl == tmpl) {
                *first = 0;
                return g_parts[i].id;
            }
            g_parts[i].root_nid = root_nid;
            g_parts[i].tmpl = tmpl;
            g_parts[i].id = g_next_part_id++;
            *first = 1;
            return g_parts[i].id;
        }
    }
    if (g_parts_n >= MAX_PARTS) { *first = 0; return 0; }
    g_parts[g_parts_n].obj = obj;
    g_parts[g_parts_n].root_nid = root_nid;
    g_parts[g_parts_n].tmpl = tmpl;
    g_parts[g_parts_n].id = g_next_part_id++;
    *first = 1;
    return g_parts[g_parts_n++].id;
}

static void parts_reset(void)
{
    g_parts_n = 0;
    g_next_part_id = 1;
}

/* A part's last written state. */
typedef struct { float qx, qy, qz, qw; } PartState;
static PartState *g_part_state;   /* parallel to the part id (1-based) */
static int g_part_state_n;

/* --- soldiers (st lines) ---------------------------------------------------- */

#define MAX_SOLDIERS 128

typedef struct {
    uint32_t nid;
    int lower, upper, item, bits;
    int seen;
} SoldierTracked;

static SoldierTracked g_soldiers[MAX_SOLDIERS];
static int g_soldiers_n;
static int g_anim_written;

/* The animation state table, once per file: index, name, flags. The server's
 * BFSoldier::getAnimationState 0x0826d060 indexes machines at soldier+0x2b4
 * + i*0x44; the state objects hang off those machines with their name
 * std::string at +0x130 and flags at +0x2c (the shape the client's
 * getCurrentStateFlags 0x00613440 reads, verified against this binary's
 * machine array by the offsets' consistency in the field run). */
static void write_anim_states(double t, uintptr_t soldier)
{
    /* The lower machine's state objects' table: state at machine+0x20
     * (client's getCurrentStateFlags), but the server layout of a machine is
     * not verified yet -- the st records carry indices, which the viewer
     * names from this table when it can and numbers when it cannot. Left
     * until a run where the names can be checked against a client recording
     * of the same round; the indices alone still drive the animations. */
    (void)t; (void)soldier;
}

/* --- kits -------------------------------------------------------------------- */

/* Kit objects a real event named but the root-only pass cannot see (a kit is
 * a child of its soldier until dropped): net ids to emit an `o` record for
 * when the registered map hands us the object. */
#define MAX_KIT_WATCH 256

typedef struct { uint32_t nid; int done; } KitWatch;
static KitWatch g_kit_watch[MAX_KIT_WATCH];
static int g_kit_watch_n;

static void kit_watch_add(uint32_t nid)
{
    if (!nid) return;
    for (int i = 0; i < g_kit_watch_n; i++)
        if (g_kit_watch[i].nid == nid) { g_kit_watch[i].done = 0; return; }
    if (g_kit_watch_n < MAX_KIT_WATCH) {
        g_kit_watch[g_kit_watch_n].nid = nid;
        g_kit_watch[g_kit_watch_n].done = 0;
        g_kit_watch_n++;
    }
}

static int kit_watch_pending(uint32_t nid)
{
    for (int i = 0; i < g_kit_watch_n; i++)
        if (!g_kit_watch[i].done && g_kit_watch[i].nid == nid) return 1;
    return 0;
}

static double g_t;   /* the current sample's stamp */
static void sample_object(uint32_t node);

/* The watched kit object, emitted as its own o record even while DISABLED
 * (a carried kit is disabled until dropped): the viewer needs its template
 * to dress the soldier. */
static void kit_watch_emit(uint32_t obj, uint32_t nid, uint32_t key)
{
    for (int i = 0; i < g_kit_watch_n; i++) {
        if (g_kit_watch[i].done || g_kit_watch[i].nid != nid) continue;
        uint32_t tmpl = read_u32(obj + 0x4c);
        char name[128];
        read_string(tmpl + 8, name, sizeof(name));
        uint32_t tid = tmpl > 0x1000 ? read_u32(tmpl + 0x10) : 0;
        Mat4 m;
        float q[4] = {0, 0, 0, 1};
        float px = 0, py = 0, pz = 0;
        if (safe_read(&m, sizeof(m), obj + 0x74)) {
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
    int seen;
    char name[64];
} Plyr;

static Plyr *g_players;
static int g_players_n;
static int g_level_written;

/* --- tickets ------------------------------------------------------------------ */

/* ScoreManager: the global `dice::ref2::world::scoreManager` 0x0871bb58
 * (getTeamScore 0x081616c0 = this + 0x10 + team*0x50; the live count at
 * TeamScore+0x48, TeamScore::setTickets 0x081610a0). */
#define SCORE_MANAGER_PTR 0x0871bb58u
static int g_tickets[2] = { -1, -1 };

/* ScoreManager instance, found in the registered map by vtable
 * (vtable for dice::ref2::world::ScoreManager 0x0871c000 + 8). */
static uint32_t g_score_manager = 0;

static void sample_tickets(double t)
{
    /* The global may hold the manager or a pointer to it; accept either. */
    uint32_t at = read_u32(SCORE_MANAGER_PTR);
    uint32_t mgr = 0;
    if (at >= 0x1000 && read_u32(at) == 0x0871c008u) mgr = at;
    else if (read_u32(SCORE_MANAGER_PTR) == 0x0871c008u) mgr = SCORE_MANAGER_PTR;
    if (!mgr) return;
    int t1 = (int)read_u32(mgr + 0x10 + 1 * 0x50 + 0x48);
    int t2 = (int)read_u32(mgr + 0x10 + 2 * 0x50 + 0x48);
    if (t1 == g_tickets[0] && t2 == g_tickets[1]) return;
    g_tickets[0] = t1;
    g_tickets[1] = t2;
    char line[160];
    snprintf(line, sizeof(line), "{\"k\":\"tk\",\"t\":%.3f,\"v\":[%d,%d]}", t, t1, t2);
    write_line(line);
}

/* --- sampling: one registered object ------------------------------------------ */

static void kit_watch_emit(uint32_t obj, uint32_t nid, uint32_t key);
static void sample_object(uint32_t node);

/* One node of the registered-objects map. Lines go straight to the file:
 * thousands of objects a sample would overflow any assembled buffer. */
static void sample_object(uint32_t node)
{
    uint32_t key = read_u32(node + 0x10);
    uint32_t obj = read_u32(node + 0x14);
    if (!obj || obj < 0x1000) return;

    uint32_t flags = read_u32(obj + 4);
    if (flags & FLAG_DISABLED) return;

    uint32_t nid = net_id_of(obj);

    uint32_t vptr = read_u32(obj);
    int is_rot = vptr == VT_ROT_BUNDLE;
    int is_engine = vptr == VT_ENGINE;

    /* Root pass: transforms and armor. */
    int is_root = (flags & FLAG_ROOT) != 0;
    if (is_root) {
        /* The replicated ScoreManager registers as a world object: found by
         * vtable, the tickets read off it (sample_tickets). */
        if (vptr == 0x0871c008u) g_score_manager = obj;   /* legacy find path */
        if (!nid) return;
        Mat4 m;
        if (!safe_read(&m, sizeof(m), obj + 0x74)) return;

        uint32_t tmpl = read_u32(obj + 0x4c);
        char name[128];
        read_string(tmpl + 8, name, sizeof(name));
        uint32_t tid = tmpl > 0x1000 ? read_u32(tmpl + 0x10) : 0;
        uint32_t gid = key;   /* the registered map's key: obj+0x48 (registerObject 0x0819b4a0) */

        float q[4];
        to_quat(&m, q);

        ArmorFields armor;
        int ti = hash_find(key, hash_of(key));
        if (ti < 0) {
            if (g_tracked_n >= MAX_TRACKED) return;
            ti = g_tracked_n++;
            g_tracked[ti].key = key;
            g_tracked[ti].nid = nid;
            hash_insert(key, ti, hash_of(key));
            Tracked *tr = &g_tracked[ti];
            tr->x = m.p[0]; tr->y = m.p[1]; tr->z = m.p[2];
            tr->qx = q[0]; tr->qy = q[1]; tr->qz = q[2]; tr->qw = q[3];
            tr->gen = g_gen;
            tr->armor_ptr = find_armor(obj);
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
                    g_t, nid, gid, name, tid, armor.maxHitPoints, armor.criticalDamage);
                write_line(line);
            } else {
                char line[512];
                snprintf(line, sizeof(line),
                    "{\"k\":\"o\",\"t\":%.3f,\"id\":%u,\"gid\":%u,\"tmpl\":\"%s\",\"tid\":%u}",
                    g_t, nid, gid, name, tid);
                write_line(line);
            }
            return;
        }

        Tracked *tr = &g_tracked[ti];
        tr->gen = g_gen;
        ArmorFields armor_now;
        int has_armor = read_armor_at(tr->armor_ptr, &armor_now);
        float dx = tr->x - m.p[0], dy = tr->y - m.p[1], dz = tr->z - m.p[2];
        float dq = tr->qx - q[0] + tr->qy - q[1] + tr->qz - q[2] + tr->qw - q[3];
        int moved = dx * dx + dy * dy + dz * dz >= 1e-4f || !(dq < 0.008f && dq > -0.008f);
        int hp_changed = has_armor && (!tr->has_armor
            || fabsf(armor_now.hitPoints - tr->hp) > 0.05f
            || armor_now.lastHitPlayer != tr->last_hit);
        if (moved) {
            tr->x = m.p[0]; tr->y = m.p[1]; tr->z = m.p[2];
            tr->qx = q[0]; tr->qy = q[1]; tr->qz = q[2]; tr->qw = q[3];
            char line[512];
            snprintf(line, sizeof(line),
                "{\"k\":\"s\",\"t\":%.3f,\"o\":[[%u,%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f]]}",
                g_t, nid, m.p[0], m.p[1], m.p[2], q[0], q[1], q[2], q[3]);
            write_line(line);
        }
        /* Hit points change on every hit, and fall steadily on their own once
         * below the critical threshold (burning): the smoke, fire and
         * destruction timeline, and the damage events the viewer feeds. */
        if (hp_changed) {
            tr->has_armor = 1;
            tr->hp = armor_now.hitPoints;
            tr->last_hit = armor_now.lastHitPlayer;
            char line[256];
            snprintf(line, sizeof(line),
                "{\"k\":\"a\",\"t\":%.3f,\"a\":[[%u,%.1f,%d]]}",
                g_t, nid, armor_now.hitPoints, armor_now.lastHitPlayer);
            write_line(line);
        }
        return;
    }

    /* Non-root pass 1: a watched kit (needs its net id). */
    if (nid) {
        for (int i = 0; i < g_kit_watch_n; i++) {
            if (!g_kit_watch[i].done && g_kit_watch[i].nid == nid) {
                uint32_t tmpl = read_u32(obj + 0x4c);
                char name[128];
                read_string(tmpl + 8, name, sizeof(name));
                uint32_t tid = tmpl > 0x1000 ? read_u32(tmpl + 0x10) : 0;
                Mat4 m;
                float q[4] = {0, 0, 0, 1};
                float px = 0, py = 0, pz = 0;
                if (safe_read(&m, sizeof(m), obj + 0x74)) {
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
                break;
            }
        }
    }

    /* Non-root pass 2: moving parts and engines under a root. A child's
     * networkable carries no id (getID() 0 for every child), so the pass
     * does not need one -- the gate above only applied to the kit watch. */
    if (!is_rot && !is_engine) return;

    uintptr_t root = root_of(obj);
    if (root < 0x1000 || root == obj) return;
    uint32_t root_nid = net_id_of(root);
    if (!root_nid) return;

    Mat4 top, part;
    const Mat4 *top_m, *part_m;
    if (!safe_read(&top, sizeof(top), root + 0x74)) return;
    if (!safe_read(&part, sizeof(part), obj + 0x74)) return;
    top_m = &top;
    part_m = &part;

    uint32_t tmpl = read_u32(obj + 0x4c);
    int first = 0;
    int id = part_id_of(obj, root_nid, tmpl, &first);

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
            read_string(tmpl + 8, name, sizeof(name));
            float at[3];
            local_pos(top_m, part_m->p, at);
            char line[512];
            snprintf(line, sizeof(line),
                "{\"k\":\"jn\",\"t\":%.3f,\"o\":[[%u,%d,\"%s\",%.2f,%.2f,%.2f]]}",
                g_t, root_nid, id, name, at[0], at[1], at[2]);
            write_line(line);
            if (id >= g_part_state_n) {
                for (int i = g_part_state_n; i <= id; i++)
                    memset(&g_part_state[i], 0, sizeof(PartState));
                g_part_state_n = id + 1;
            }
        } else {
            PartState *ps = &g_part_state[id];
            if (fabsf(ps->qx - qr[0]) < 0.002f && fabsf(ps->qy - qr[1]) < 0.002f
                && fabsf(ps->qz - qr[2]) < 0.002f && fabsf(ps->qw - qr[3]) < 0.002f)
                return;
            *ps = (PartState){ qr[0], qr[1], qr[2], qr[3] };
        }
        char line[512];
        snprintf(line, sizeof(line),
            "{\"k\":\"j\",\"t\":%.3f,\"o\":[[%u,%d,%.4f,%.4f,%.4f,%.4f]]}",
            g_t, root_nid, id, qr[0], qr[1], qr[2], qr[3]);
        write_line(line);
        return;
    }

    /* Engine: PhysicsEngine at Engine+0x60 (the physicsNode field; verified
     * against the vptr), revs +0xA0 (PhysicsEngine::updatePhysics 0x0824cbb0
     * reads and writes it), gear +0xBC (PhysicsEngine ctor sets 1). The
     * running/disabled flags and the throttle servo are read at the client
     * recorder's offsets until a live run verifies them (RECORDER_DEBUG
     * dumps an engine's dwords for exactly that check). */
    uint32_t pe = read_u32(obj + 0x60);
    if (pe < 0x1000 || read_u32(pe) != VT_PHYS_ENGINE) return;
    float revs;
    if (!safe_read(&revs, 4, pe + 0xa0)) return;
    int32_t gear = (int32_t)read_u32(pe + 0xbc);
    uint8_t flags2[2];
    safe_read(flags2, 2, obj + 0x15c);
    float throttle;
    safe_read(&throttle, 4, obj + 0x124);
    int eflags = (flags2[0] ? 1 : 0) | (flags2[1] ? 2 : 0);

    static float last_revs[MAX_PARTS];
    static int last_gear[MAX_PARTS];
    static float last_throttle[MAX_PARTS];
    static int last_flags[MAX_PARTS];
    if (id < MAX_PARTS && !first) {
        if (fabsf(last_revs[id] - revs) < 0.01f && last_gear[id] == gear
            && fabsf(last_throttle[id] - throttle) < 0.01f && last_flags[id] == eflags)
            return;
        last_revs[id] = revs;
        last_gear[id] = gear;
        last_throttle[id] = throttle;
        last_flags[id] = eflags;
    }
    char line[512];
    snprintf(line, sizeof(line),
        "{\"k\":\"g\",\"t\":%.3f,\"o\":[[%u,%.3f,%.3f,%d,%d,%d]]}",
        g_t, root_nid, revs, throttle, eflags, gear, id);
    write_line(line);

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
}

/* Soldier pass (roots only, vtable-identified): the animation state machines
 * (BFSoldier::getAnimationState 0x0826d060: soldier+0x2b4 + i*0x44 -- lower
 * machine i=0, upper i=1), the held item (getActiveItemIndex 0x0827f920:
 * +0x3b8) and the state bits (getStateBits 0x0827e1c0: +0x3e6). */
static void sample_soldier(uint32_t obj, uint32_t nid)
{
    int lower = (int)read_u32(obj + 0x2b4);
    int upper = (int)read_u32(obj + 0x2f8);
    int item = (int)read_u32(obj + 0x3b8);
    int bits = 0;
    safe_read(&bits, 2, obj + 0x3e6);

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
    if (s->lower == lower && s->upper == upper && s->item == item && s->bits == bits) return;
    s->lower = lower; s->upper = upper; s->item = item; s->bits = bits;
    /* Aim pitch and torso twist are the client recorder's soldier-view
     * refinements, read where the client has applied the replicated aim; the
     * server's own storage for them is not verified yet (0: no head aim). */
    char line[384];
    snprintf(line, sizeof(line),
        "{\"k\":\"st\",\"t\":%.3f,\"o\":[[%u,%d,%d,%.1f,%.1f,%d,%d]]}",
        g_t, nid, lower, upper, 0.0, 0.0, item, bits);
    write_line(line);
    if (!g_anim_written) { write_anim_states(g_t, obj); g_anim_written = 1; }
}

/* The registered-objects map (ObjectManager::registerObject 0x0819b4a0)
 * is an old SGI-STL _Rb_tree at om+0x94: header-node pointer at om+0x94,
 * node count at om+0x98. A node: parent +4, left +8, right +0xc; value
 * pair key +0x10, IObject* +0x14. Walk from the leftmost (header.left),
 * in-order successor: right subtree's leftmost, else climb to the ancestor
 * whose left child this is. */
static uint32_t successor(uint32_t node, uint32_t header)
{
    uint32_t right = read_u32(node + 0xc);
    if (right != header && right) {
        node = right;
        for (;;) {
            uint32_t left = read_u32(node + 8);
            if (!left || left == header) break;
            node = left;
        }
        return node;
    }
    uint32_t parent = read_u32(node + 4);
    while (parent && parent != header) {
        if (read_u32(parent + 8) == node) return parent;
        node = parent;
        parent = read_u32(node + 4);
    }
    return header;
}

/* --- the roster and the level ---------------------------------------------- */

static uint32_t kit_net_id_of(uint32_t soldier);

/* PlayerManager::getPlayers: the list at pm+0xc; a node: next +0,
 * BFPlayer* +8 (GameServer::updateGameLogic walks it so). BFPlayer: id u16
 * +0xc, name string +0x44, ai byte +0x78, team +0x7c, and -- the fields
 * GameEventManager::createPlayer 0x0812d080 fills its event from: the
 * controlled object (vehicle) +0x68, the camera +0x74. The kit is NOT a
 * BFPlayer field (the event builder takes it from the soldier's template,
 * class id 0x9493): the real createPlayer/pickupKit events the detour
 * captures carry it, so with the hook active no kit is written here. */
static void sample_players(void)
{
    uint32_t pm = read_u32(PLAYER_MANAGER_PTR);
    if (!pm || pm < 0x1000) return;

    uint32_t list = pm + 0xc;
    uint32_t node = read_u32(list);
    int walking = 0;
    for (int i = 0; node && node != list && i < MAX_PLAYERS + 8; i++) {
        uint32_t p = read_u32(node + 8);
        node = read_u32(node);
        walking++;
        if (!p || p < 0x1000) break;

        int pid = read_u32(p + 0xc) & 0xffff;
        if (!pid) continue;

        Plyr *pl = 0;
        for (int j = 0; j < g_players_n; j++)
            if (g_players[j].pid == pid) { pl = &g_players[j]; break; }

        char name[64];
        read_string(p + 0x44, name, sizeof(name));
        int ai = read_u32(p + 0x78) & 0xff;
        int team = read_u32(p + 0x7c);
        uint32_t veh = read_u32(p + 0x68);
        uint32_t nid = veh > 0x1000 ? net_id_of(veh) : 0;

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
            pl->pid = pid;
            json_escape(name, pl->name, sizeof(pl->name));
            pl->kit_nid = kit_nid;
            /* Synthesised createPlayer (hook inactive or the join's events
             * went by): the ids the event builder fills from +0x68 and
             * +0x74 -- vehicle/controlled and camera. No kit here. */
            uint32_t cam = read_u32(p + 0x74);
            uint32_t cam_nid = cam > 0x1000 ? net_id_of(cam) : 0;
            uint32_t veh_nid = veh > 0x1000 ? net_id_of(veh) : 0;
            char line[512];
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"createPlayer\",\"pid\":%d,"
                "\"name\":\"%s\",\"team\":%d,\"ai\":%d"
                ",\"vehNetId\":%u,\"camNetId\":%u,\"kitNetId\":%u}",
                g_t, pid, pl->name, team, ai, veh_nid, cam_nid, pl->kit_nid);
            write_line(line);
            pl->team = team;
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
        pl->seen = walking;

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
    }
    (void)walking;
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
    uint32_t tmpl = read_u32(soldier + 0x4c);
    if (tmpl < 0x1000) return 0;
    uint32_t tv = read_u32(tmpl);
    if (tv < 0x1000) return 0;
    uint32_t fn = read_u32(tv + 0xc);
    if (fn < 0x1000) return 0;
    if (((uint32_t (*)(uint32_t))fn)(tmpl) != 0x9493u) return 0;
    uint32_t sv = read_u32(soldier);
    if (sv < 0x1000) return 0;
    uint32_t gk = read_u32(sv + 0x17c);
    if (gk < 0x1000) return 0;
    uint32_t key = ((uint32_t (*)(uint32_t))gk)(soldier);
    if (!key) return 0;
    uint32_t om = read_u32(OBJECT_MANAGER_PTR);
    if (om < 0x1000) return 0;
    uint32_t ov = read_u32(om);
    if (ov < 0x1000) return 0;
    uint32_t kit = 0;
    uint32_t f1 = read_u32(ov + 0x20);
    if (f1 >= 0x1000) kit = ((uint32_t (*)(uint32_t, uint32_t))f1)(om, key);
    if (kit < 0x1000) {
        uint32_t f2 = read_u32(ov + 0x24);
        if (f2 >= 0x1000) kit = ((uint32_t (*)(uint32_t, uint32_t))f2)(om, key);
    }
    return kit >= 0x1000 ? net_id_of(kit) : 0;
}

/* The level and the mode, from the setup's current level entry
 * (Setup::getCurrentLevel 0x080bfeb0: the entry at this+0x23c, name
 * string +0, gpm enum +4; the enum's words from stringToGPM 0x08060620:
 * CQ=2, TDM=3, COOP=4, OBJECTIVEMODE=5). */
static void write_level(void)
{
    uint32_t setup = read_u32(SETUP_PTR);
    if (!setup || setup < 0x1000) return;
    char level[64];
    read_string(setup + 0x23c, level, sizeof(level));
    if (!level[0]) return;
    uint32_t gpm = read_u32(setup + 0x240);
    const char *mode = gpm == 2 ? "Conquest" : gpm == 3 ? "Tdm"
                     : gpm == 4 ? "CoOp" : gpm == 5 ? "ObjectiveMode"
                     : gpm == 1 ? "Ctf" : "";
    char line[256];
    snprintf(line, sizeof(line),
        "{\"k\":\"e\",\"t\":%.3f,\"e\":\"setLevel\",\"level\":\"%s\",\"mode\":\"%s\"}",
        g_t, level, mode);
    write_line(line);
    g_level_written = 1;
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

static void held_push(const char *line, int type)
{
    if (g_file) return;
    int kind = held_kind(type);
    if (kind && g_held) {
        for (int i = 0; i < g_held_n; i++)
            if (g_held[i].replace_kind == kind) {
                snprintf(g_held[i].line, sizeof(g_held[i].line), "%s", line);
                return;
            }
    }
    if (!g_held || g_held_n >= HELD_MAX) {
        if (!g_held) return;   /* buffer only once a run's config turned recording on */
        return;
    }
    HeldEvent *h = &g_held[g_held_n++];
    h->replace_kind = kind;
    h->order = g_held_order++;
    snprintf(h->line, sizeof(h->line), "%s", line);
}

static void held_flush(void)
{
    if (!g_held_n) return;
    /* In arrival order, at t 0 (the join's events, replayed at the file's
     * start exactly as the client recorder's held events are). */
    for (uint32_t o = 0; o < g_held_order; o++) {
        for (int i = 0; i < g_held_n; i++)
            if (g_held[i].order == o) write_line(g_held[i].line);
    }
    g_held_n = 0;
}

/* ScoreMsgEvent kind names for the debug log. */
static void emit_event_json(int type, const uint8_t *payload, size_t size, double t);

/* Called from the stub with the event the server just built. Payload after
 * the 12-byte GameEvent header (vptr, sequenceNumber, nextEvent). Struct
 * shapes are bf42plus src/bf/gameevent.h, which static_asserts them against
 * the client binary; the wire format is shared. */
static volatile int g_event_calls;
static int g_event_type_hist[64];

void recorder_on_event(uint32_t ev)
{
    g_event_calls++;
    if (ev < 0x1000) return;
    /* getType: vtable slot 0 (GameEvent's first virtual). A real event on
     * the game's own thread: the call is as safe as the engine's own. */
    uint32_t vt = read_u32(ev);
    if (vt < 0x1000) return;
    uint32_t fn = read_u32(vt);
    if (fn < 0x1000) return;
    int type = (int)((int (*)(uint32_t))fn)(ev);
    if (type >= 0 && type < 64) g_event_type_hist[type]++;
    if (type <= 0 || type > 0x3f) return;

    const uint8_t *p = (const uint8_t *)(uintptr_t)ev + 12;

    double t = g_t0 > 0.0 ? now_s() - g_t0 : 0.0;

    /* A new join starts a new file; the held events (last join's) drop. */
    if (type == 0x1a && g_file) {
        /* Map change: close this file; the sampler opens a fresh one with a
         * fresh clock, and the round state resets with it. */
        char line[64];
        snprintf(line, sizeof(line), "{\"k\":\"end\",\"t\":%.3f}", t);
        write_line(line);
        pthread_mutex_lock(&g_write_lock);
        if (g_file) { fflush(g_file); fclose(g_file); g_file = 0; }
        pthread_mutex_unlock(&g_write_lock);
        parts_reset();
        g_players_n = 0;
        g_kit_watch_n = 0;
        g_soldiers_n = 0;
        g_tracked_n = 0;
        hash_rebuild();
        g_level_written = 0;
        g_anim_written = 0;
        g_tickets[0] = g_tickets[1] = -1;
        g_score_manager = 0;
        return;
    }
    if (type == 0x1a && !g_file) g_held_n = 0;

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
    p = buf;

    emit_event_json(type, p, size, t);
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
            char esc[96]; json_escape(name, esc, sizeof(esc));
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
            int kind = I32(0);
            if (kind == 3 || kind == 6) {
                uint32_t wid = U32(8);
                template_name_by_id(wid, name, sizeof(name));
                char esc[128]; json_escape(name, esc, sizeof(esc));
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"score\",\"kind\":%d,\"pid\":%u"
                    ",\"victim\":%u,\"weapon\":%d,\"bodypart\":%d,\"weaponName\":\"%s\"}",
                    t, kind, U8(4), U8(5), (int32_t)wid, I32(12), esc);
            } else {
                snprintf(line, sizeof(line),
                    "{\"k\":\"e\",\"t\":%.3f,\"e\":\"score\",\"kind\":%d,\"pid\":%u"
                    ",\"victim\":%u,\"weapon\":%d,\"bodypart\":%d}",
                    t, kind, U8(4), U8(5), I32(8), I32(12));
            }
            break;
        }
        case 0x28: {  /* ChatFragmentEvent */
            memcpy(name, p + 10, 16); name[16] = 0;
            char esc[64]; json_escape(name, esc, sizeof(esc));
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
            char e1[96], e2[96];
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
            char e1[32], e2[32], e3[32];
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
            char esc[64]; json_escape(name, esc, sizeof(esc));
            snprintf(line, sizeof(line),
                "{\"k\":\"e\",\"t\":%.3f,\"e\":\"serverName\",\"name\":\"%s\"}", t, esc);
            break;
        }
        case 0x14: {  /* ChallengeEvent: the mod and pack */
            char m1[20];
            memcpy(m1, p + 10, 16); m1[16] = 0;
            char esc[32]; json_escape(m1, esc, sizeof(esc));
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

    if (!g_file) held_push(line, type);
    else write_line(line);
}

/* --- the fire detour (game thread) --------------------------------------------- */

/* FireArms::fireBarrel(IPlayer*, Mat4&, int) 0x0828aba0: the twin of the
 * client hook's Fire commit site (bf42plus 0x0053DCB1). Every round any
 * player or bot fires leaves through it -- on the server, every bot's shots,
 * not only what one client had live. The record is the client's `f` line:
 * the weapon's template, its root's net id, the firing player's id, and the
 * Mat4 the round left along (rows a, b, c are the X, Y, Z axes; a round
 * leaves along +Z). */
static uint32_t (*get_bf_player)(uint32_t) = (uint32_t(*)(uint32_t))GET_BF_PLAYER;
static uint32_t (*get_root_parent)(uint32_t) = (uint32_t(*)(uint32_t))GET_ROOT_PARENT;

void recorder_on_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr)
{
    if (!g_file || fire_arms < 0x1000 || mat4_addr < 0x1000) return;

    uint32_t tmpl = read_u32(fire_arms + 0x4c);
    char name[96];
    read_string(tmpl + 8, name, sizeof(name));

    int pid = -1;
    if (player >= 0x1000) {
        uint32_t bf = get_bf_player(player);
        if (bf >= 0x1000) pid = (int)(read_u32(bf + 0xc) & 0xffff);
    }

    int root_nid = -1;
    if (fire_arms >= 0x1000) {
        uint32_t root = get_root_parent(fire_arms);
        if (root >= 0x1000) root_nid = (int)net_id_of(root);
    }

    Mat4 m;
    if (!safe_read(&m, sizeof(m), mat4_addr)) return;

    char esc[112]; json_escape(name, esc, sizeof(esc));
    char line[512];
    snprintf(line, sizeof(line),
        "{\"k\":\"f\",\"t\":%.3f,\"id\":%d,\"pid\":%d,\"w\":\"%s\""
        ",\"p\":[%.2f,%.2f,%.2f],\"d\":[%.3f,%.3f,%.3f]}",
        now_s() - g_t0, root_nid, pid, esc,
        m.p[0], m.p[1], m.p[2], m.c[0], m.c[1], m.c[2]);
    write_line(line);
}

/* --- the sampler ------------------------------------------------------------------ */

/* --- detour stubs and installation ------------------------------------------------- */

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

__asm__(
".text\n"
".globl recorder_stub_event\n"
"recorder_stub_event:\n"          /* jmp'd here from 0x0812d730 */
"  pusha\n"
"  pushfl\n"
"  movl  44(%esp), %eax\n"        /* the event pointer ([esp+4] at entry) */
"  pushl %eax\n"
"  call  recorder_on_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *recorder_tramp_event\n"
".globl recorder_stub_fire\n"
"recorder_stub_fire:\n"           /* jmp'd here from 0x0828aba0 */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"        /* this    ([esp+4] at entry) */
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
"  movl  44(%esp), %eax\n"        /* the event ([esp+8] at entry) */
"  pushl %eax\n"
"  call  recorder_on_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *recorder_tramp_toall\n"
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
);

extern char recorder_stub_event;
extern char recorder_stub_fire;
extern char recorder_stub_toall;
extern uint32_t recorder_tramp_event;
extern uint32_t recorder_tramp_fire;
extern uint32_t recorder_tramp_toall;

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

static int install_detour(uintptr_t site, const uint8_t *expected, size_t len,
                          void *stub, const uint8_t *orig_bytes, uintptr_t back_to,
                          uintptr_t *tramp_out)
{
    uint8_t have[16];
    if (!safe_read(have, len, site) || memcmp(have, expected, len) != 0) {
        fprintf(stderr, "recorder: %08lx is not the expected code, detour skipped\n",
                (unsigned long)site);
        return 0;
    }
    if (!build_trampoline(orig_bytes, len, back_to, tramp_out)) return 0;
    uint8_t jmp[5];
    jmp[0] = 0xe9;
    int32_t rel = (int32_t)((uintptr_t)stub - (site + 5));
    memcpy(jmp + 1, &rel, 4);
    if (!patch_write(site, jmp, 5)) {
        fprintf(stderr, "recorder: patch at %08lx failed\n", (unsigned long)site);
        return 0;
    }
    {
        uint8_t back[5] = {};
        safe_read(back, 5, site);
        fprintf(stderr, "recorder: %08lx now %02x %02x %02x %02x %02x (stub %p)\n",
                (unsigned long)site, back[0], back[1], back[2], back[3], back[4], stub);
    }
    return 1;
}

static void install_hooks(void)
{
    uintptr_t tramp_event = 0, tramp_fire = 0, tramp_toall = 0;
    if (install_detour(ADD_EVENT_SEND_QUEUE, AETSQ_ORIG, AETSQ_LEN,
                       &recorder_stub_event, AETSQ_ORIG, AETSQ_BACK, &tramp_event)) {
        *(uint32_t *)&recorder_tramp_event = (uint32_t)tramp_event;
        g_hook_active = 1;
        fprintf(stderr, "recorder: event queue hooked at %08x\n", (unsigned)ADD_EVENT_SEND_QUEUE);
    }
    if (install_detour(SEND_EVENT_TO_ALL, TOALL_ORIG, TOALL_LEN,
                       &recorder_stub_toall, TOALL_ORIG, TOALL_BACK, &tramp_toall)) {
        *(uint32_t *)&recorder_tramp_toall = (uint32_t)tramp_toall;
        fprintf(stderr, "recorder: sendGameEventToAll hooked at %08x\n", (unsigned)SEND_EVENT_TO_ALL);
    }
    if (install_detour(FIRE_BARREL, FIRE_ORIG, FIRE_LEN,
                       &recorder_stub_fire, FIRE_ORIG, FIRE_BACK, &tramp_fire)) {
        *(uint32_t *)&recorder_tramp_fire = (uint32_t)tramp_fire;
        fprintf(stderr, "recorder: fireBarrel hooked at %08x\n", (unsigned)FIRE_BARREL);
    }
}

/* --- sampling ------------------------------------------------------------ */

static void *sampler(void *arg)
{
    (void)arg;
    const struct timespec tick = { 0, (long)(1e9 / 30.0) };
    double next_sample = 0.0;

    for (;;) {
        nanosleep(&tick, 0);
        if (!g_on) continue;
        if (!g_file) {
            pthread_mutex_lock(&g_write_lock);
            if (!g_file) {
                open_file_locked();
                if (g_file) { g_t0 = now_s(); next_sample = 1.0 / g_hz; held_flush(); }
            }
            pthread_mutex_unlock(&g_write_lock);
            if (!g_file) { g_on = 0; continue; }
        }

        double t = now_s() - g_t0;
        if (t < next_sample) continue;
        next_sample += 1.0 / g_hz;

        uint32_t om = read_u32(OBJECT_MANAGER_PTR);
        if (!om || om < 0x1000) continue;

        uint32_t header = read_u32(om + 0x94);
        if (!header || header < 0x1000) continue;

        if (g_debug) {
            static double last_dbg = 0.0;
            static int census_done = 0;
            if (!census_done && g_tracked_n > 0) {
                census_done = 1;
                /* One-shot census: every registered object's vptr, and the
                 * flags word, to see which classes the map holds. */
                struct { uint32_t vt; int n; } top[32] = {};
                int ntop = 0;
                uint32_t n2 = read_u32(header + 8);
                uint32_t ms2 = read_u32(om + 0x98) + 16;
                uint32_t st2 = 0;
                while (n2 && n2 != header && st2 < ms2) {
                    st2++;
                    uint32_t o2 = read_u32(n2 + 0x14);
                    if (o2 >= 0x1000) {
                        uint32_t v2 = read_u32(o2);
                        int found = 0;
                        for (int i = 0; i < ntop; i++)
                            if (top[i].vt == v2) { top[i].n++; found = 1; break; }
                        if (!found && ntop < 32) { top[ntop].vt = v2; top[ntop++].n = 1; }
                    }
                    n2 = successor(n2, header);
                }
                fprintf(stderr, "recorder dbg: vptr census:");
                for (int i = 0; i < ntop; i++)
                    fprintf(stderr, " %08x:%d", top[i].vt, top[i].n);
                fprintf(stderr, "\n");
                fprintf(stderr, "recorder dbg: expect rot=%08x engine=%08x soldier=%08x\n",
                        VT_ROT_BUNDLE, VT_ENGINE, VT_SOLDIER);
            }
            if (t - last_dbg > 5.0) {
                last_dbg = t;
                fprintf(stderr, "recorder dbg: count=%u tracked=%d players=%d parts=%d held=%d scoremgr=%08x evcalls=%d\n",
                        read_u32(om + 0x98), g_tracked_n, g_players_n, g_parts_n, g_held_n, g_score_manager, g_event_calls);
                if (g_debug) {
                    fprintf(stderr, "recorder dbg: types:");
                    for (int ty = 0; ty < 64; ty++)
                        if (g_event_type_hist[ty]) fprintf(stderr, " %02x:%d", ty, g_event_type_hist[ty]);
                    fprintf(stderr, "\n");
                }
            }
        }

        g_t = t;
        g_gen++;
        for (int i = 0; i < g_soldiers_n; i++) g_soldiers[i].seen = 0;

        if (!g_level_written) write_level();

        uint32_t node = read_u32(header + 8);
        uint32_t max_steps = read_u32(om + 0x98) + 16;
        uint32_t steps = 0;
        while (node && node != header && steps < max_steps) {
            steps++;
            uint32_t obj = read_u32(node + 0x14);
            if (obj >= 0x1000) {
                uint32_t flags = read_u32(obj + 4);
                uint32_t nid = net_id_of(obj);
                uint32_t vptr = read_u32(obj);
                /* A watched kit is emitted however it is flagged: a carried
                 * kit sits disabled in the map until dropped. */
                if (nid && kit_watch_pending(nid)) {
                    uint32_t key = read_u32(node + 0x10);
                    kit_watch_emit(obj, nid, key);
                }
                /* Child bundles and engines carry no net id: they are
                 * sampled for their parts regardless. Roots without one are
                 * skipped (the viewer has no id space for them). */
                if (!(flags & FLAG_DISABLED) && (nid || !(flags & FLAG_ROOT)))
                    sample_object(node);
                if (nid && !(flags & FLAG_DISABLED) && (flags & FLAG_ROOT)
                    && vptr == VT_SOLDIER)
                    sample_soldier(obj, nid);
            }
            node = successor(node, header);
        }

        sample_players();
        sample_tickets(t);

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
    }
    return 0;
}

/* --- entry --------------------------------------------------------------- */

__attribute__((constructor))
static void recorder_init(void)
{
    read_config();
    if (!g_on) return;
    g_tracked = calloc(MAX_TRACKED, sizeof(Tracked));
    g_hash = calloc(HASH_SLOTS, sizeof(int32_t));
    g_parts = calloc(MAX_PARTS, sizeof(PartId));
    g_part_state = calloc(MAX_PARTS + 1, sizeof(PartState));
    g_players = calloc(MAX_PLAYERS, sizeof(Plyr));
    g_held = calloc(HELD_MAX, sizeof(HeldEvent));
    if (!g_tracked || !g_hash || !g_parts || !g_part_state || !g_players || !g_held) {
        fprintf(stderr, "recorder: out of memory at load, not started\n");
        g_on = 0;
        return;
    }
    hash_rebuild();
    install_hooks();
    pthread_t th;
    if (pthread_create(&th, 0, sampler, 0) == 0)
        pthread_detach(th);
    fprintf(stderr, "recorder: sampler thread started\n");
}
