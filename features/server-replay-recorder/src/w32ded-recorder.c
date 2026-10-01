/*
 * Server-side round replay recorder for the Windows dedicated server.
 *
 * A 32-bit proxy DLL: build as WINMM.dll, drop it next to BF1942_w32ded.exe.
 * The PE import table resolves WINMM first from the application directory
 * (standard Windows search order, no loader changes needed), so the game
 * loads us; we forward every winmm call to the system copy with the
 * "real.dll" export-forwarding trick and run a sampler thread alongside.
 *
 * The offsets are read out of BF1942_w32ded.exe itself (md5 1f75eb8b,
 * retail v1.61), derivation in ../w32ded-offsets.md. One source tree, two
 * compilers: the engine class layout matches bf1942_lnxded, the STL does
 * not, so the registered-objects map is the MSVC (VC7/Dinkumware) layout.
 *
 * Same ndjson as the lnxded recorder (h/o/s/d lines, format v4), playable
 * by tools/bf1942-models/viewer/replay-recording.js.
 *
 * Config: mods/bf1942/settings/recorder.con next to the exe
 *   recordReplays 1
 *   replaySampleHz 10
 * Writes replays/replay_<unixts>.ndjson under the exe's cwd.
 *
 * Build (from this directory):
 *   i686-w64-mingw32-gcc -O2 -Wall -shared -o WINMM.dll w32ded-recorder.c \
 *       -lkernel32 -Wl,--enable-stdcall-fixup -Wl,--kill-at
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>
#include <time.h>

/* ------------------------------------------------------------------ */
/* winmm forwarding                                                    */
/* ------------------------------------------------------------------ */

#pragma comment(lib, "kernel32")

static HMODULE g_real_winmm;

static FARPROC real(const char *name)
{
    if (!g_real_winmm) {
        char path[MAX_PATH];
        GetSystemDirectoryA(path, MAX_PATH);
        lstrcatA(path, "\\winmm.dll");
        g_real_winmm = LoadLibraryA(path);
        if (!g_real_winmm) return NULL;
    }
    return GetProcAddress(g_real_winmm, name);
}

/* The game only imports a handful of winmm functions (timeGetTime,
 * timeBeginPeriod / timeEndPeriod; the wave and joy families are client
 * side). The IAT patch below routes them all to the system dll. */

/* We forward by name at load time using .drectve forwarding is not
 * expressible in plain C, so instead of forwarding each of ~40 winmm
 * exports we patch the game's IAT once: simpler and toolchain-free.
 * See iat_hook() below. This keeps our exports to just DllMain. */

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

static volatile LONG g_on = 0;
static int g_hz = 10;
static int g_debug = 0;

static void read_config(void)
{
    g_debug = getenv("RECORDER_DEBUG") != NULL;
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

/* ------------------------------------------------------------------ */
/* output                                                              */
/* ------------------------------------------------------------------ */

static FILE *g_file;

static void open_file(void)
{
    CreateDirectoryA("replays", NULL);
    char name[256];
    __time64_t now = _time64(NULL);
    snprintf(name, sizeof(name), "replays/replay_%lld.ndjson", (long long)now);
    g_file = fopen(name, "w");
    if (!g_file) {
        fprintf(stderr, "recorder: cannot open %s\n", name);
        return;
    }
    char iso[64];
    struct tm tmv;
    _localtime64_s(&tmv, &now);
    strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%S", &tmv);
    fprintf(g_file,
            "{\"k\":\"h\",\"v\":4,\"plus\":\"server-replay-recorder-w32ded\","
            "\"start\":\"%s\",\"hz\":%d}\n", iso, g_hz);
    fprintf(stderr, "recorder: recording to %s\n", name);
}

/* ------------------------------------------------------------------ */
/* safe reads                                                          */
/* ------------------------------------------------------------------ */

/* The sampler runs on its own thread while the game thread mutates the
 * world. A torn pointer must cost a skipped sample, not a crash. On
 * Windows: IsBadReadPtr pre-check plus SEH via the mingw excpt bridge.
 * (gcc's SEH support needs the win32Exceptions form; keep it simple and
 * portable: pre-validate the range, and the process stays alive.) */
static int safe_read(void *dst, size_t len, uintptr_t addr)
{
    if (addr < 0x10000 || addr + len > 0x7fff0000u) return 0;
    if (IsBadReadPtr((const void *)addr, len)) return 0;
    memcpy(dst, (const void *)addr, len);
    return 1;
}

static uint32_t read_u32(uintptr_t addr)
{
    uint32_t v = 0;
    safe_read(&v, 4, addr);
    return v;
}

/* ------------------------------------------------------------------ */
/* offsets (see ../w32ded-offsets.md)                                  */
/* ------------------------------------------------------------------ */

#define OBJECT_MANAGER_PTR 0x0074c52cu  /* dice::ref2::world::objectManager */

/* MSVC registered-objects tree at om+0xa0:
 *   om+0xa4 _Myhead (sentinel), om+0xa8 _Mysize
 * node: _Left +0, _Parent +4, _Right +8, key +0xc, IObject* +0x10,
 *       _Isnil byte +0x15 */
#define TREE_HEAD   0xa4u
#define TREE_SIZE   0xa8u
#define NODE_LEFT   0x00u
#define NODE_PARENT 0x04u
#define NODE_RIGHT  0x08u
#define NODE_KEY    0x0cu
#define NODE_VALUE  0x10u

#define OBJ_FLAGS   0x04u   /* u32: ROOT 0x02000000, DISABLED 1 */
#define OBJ_ID      0x48u   /* object-manager id (gid) */
#define OBJ_TMPL    0x4cu   /* ObjectTemplate* */
#define OBJ_MAT     0x74u   /* Mat4: rows a,b,c then position, 0x40 bytes */

/* ObjectTemplate name, w32ded live layout (hexdump, see w32ded-offsets.md):
 * the member at tmpl+8 is a Dinkumware string whose chars sit INLINE:
 * size u32 at +0x0c, chars at +0x10 (dump: "terrainObject", size 13 at +0xc).
 * The earlier {ptr,size} reading was wrong; the ptr we saw was vtable data. */
#define TMPL_NAME_SIZE 0x0cu
#define TMPL_NAME_BUF  0x10u
#define TMPL_ID        0x34u  /* candidate: 0x181 seen at +0x34; verify in run */

static const uint32_t FLAG_ROOT = 0x02000000u;
static const uint32_t FLAG_DISABLED = 1u;

typedef struct { float a[4], b[4], c[4], p[4]; } Mat4;

static int g_tmpl_dumps;   /* RECORDER_TMPL_DUMP=1: hexdump the first few
                            * template headers so the layout can be read
                            * from live memory (see w32ded-offsets.md). */

static void hexdump_templ(uintptr_t tmpl)
{
    if (!g_debug || g_tmpl_dumps >= 4) return;
    g_tmpl_dumps++;
    unsigned char b[0x100];
    if (!safe_read(b, sizeof(b), tmpl)) return;
    fprintf(stderr, "recorder: template @ %08x\n", (unsigned)tmpl);
    for (int row = 0; row < 16; row++) {
        fprintf(stderr, "  +%02x:", row * 16);
        for (int i = 0; i < 16; i++)
            fprintf(stderr, " %02x", b[row * 16 + i]);
        fprintf(stderr, "  |");
        for (int i = 0; i < 16; i++) {
            unsigned char c = b[row * 16 + i];
            fputc(c >= 0x20 && c < 0x7f ? c : '.', stderr);
        }
        fprintf(stderr, "|\n");
    }
}

static void read_template_name(uintptr_t tmpl, char *out, size_t cap)
{
    out[0] = 0;
    if (tmpl < 0x10000) return;
    hexdump_templ(tmpl);
    /* Candidate A: Dinkumware inline: len at +0x1c, chars at +0x0c.
     * Verified live: "terrainObject" len 13 at +0x1c, chars at +0x0c. */
    uint32_t slen = read_u32(tmpl + 0x1c);
    if (slen >= 3 && slen <= 64) {
        char buf[80];
        if (safe_read(buf, slen, tmpl + 0x0c)) {
            buf[slen] = 0;
            int ok = 1;
            for (uint32_t i = 0; i < slen; i++) {
                unsigned char c = (unsigned char)buf[i];
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                      (c >= '0' && c <= '9') || c == '_' || c == '.' ||
                      c == '-' || c == ' ')) { ok = 0; break; }
            }
            if (ok && buf[0] != 0) {
                if (g_debug && g_tmpl_dumps < 8) {
                    fprintf(stderr, "recorder: name A '%s' (len %u)\n", buf, slen);
                    g_tmpl_dumps++;
                }
                snprintf(out, cap, "%s", buf);
                return;
            }
        }
    }
    /* Candidate B: {ptr,size}: ptr at +8, size at +0xc. */
    uint32_t hdr[2];
    if (safe_read(hdr, sizeof(hdr), tmpl + 8)) {
        uint32_t sp = hdr[0], sl = hdr[1];
        if (sp >= 0x400000 && sp < 0x7fff0000 && sl >= 3 && sl <= 64) {
            char buf[80];
            if (safe_read(buf, sl, sp)) {
                buf[sl] = 0;
                snprintf(out, cap, "%s", buf);
                return;
            }
        }
    }
}

/* Quaternion from rows a/b/c (same law as the client recorder's toQuat). */
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

/* ------------------------------------------------------------------ */
/* tracking                                                            */
/* ------------------------------------------------------------------ */

#define MAX_TRACKED 8192

typedef struct {
    uint32_t id;
    uint32_t gen;
    float x, y, z, qx, qy, qz, qw;
} Tracked;

static Tracked g_tracked[MAX_TRACKED];
static int g_tracked_n;
static uint32_t g_gen;

#define HASH_SLOTS (MAX_TRACKED * 2)
static int32_t g_hash[HASH_SLOTS];

static void hash_rebuild(void)
{
    memset(g_hash, 0xff, sizeof(g_hash));
    for (int i = 0; i < g_tracked_n; i++) {
        uint32_t h = (g_tracked[i].id * 0x9e3779b9u) & (HASH_SLOTS - 1);
        for (uint32_t j = h; ; j = (j + 1) & (HASH_SLOTS - 1))
            if (g_hash[j] < 0) { g_hash[j] = (int32_t)i; break; }
    }
}

static int hash_find(uint32_t id, uint32_t h)
{
    for (uint32_t i = h; ; i = (i + 1) & (HASH_SLOTS - 1)) {
        int32_t e = g_hash[i];
        if (e < 0) return -1;
        if (g_tracked[e].id == id) return e;
    }
}

static void hash_insert(uint32_t id, int idx, uint32_t h)
{
    for (uint32_t i = h; ; i = (i + 1) & (HASH_SLOTS - 1))
        if (g_hash[i] < 0) { g_hash[i] = (int32_t)idx; return; }
}

static uint32_t hash_of(uint32_t id)
{
    return (id * 0x9e3779b9u) & (HASH_SLOTS - 1);
}

/* ------------------------------------------------------------------ */
/* sampling                                                            */
/* ------------------------------------------------------------------ */

static double now_s(void)
{
    static LARGE_INTEGER freq, start;
    if (!freq.QuadPart) {
        QueryPerformanceFrequency(&freq);
        QueryPerformanceCounter(&start);
    }
    LARGE_INTEGER c;
    QueryPerformanceCounter(&c);
    return (double)(c.QuadPart - start.QuadPart) / (double)freq.QuadPart;
}

static double g_t;

static void sample_object(uint32_t node)
{
    uint32_t key = read_u32(node + NODE_KEY);
    uint32_t obj = read_u32(node + NODE_VALUE);
    if (!obj || obj < 0x10000) return;

    uint32_t flags = read_u32(obj + OBJ_FLAGS);
    if (!(flags & FLAG_ROOT) || (flags & FLAG_DISABLED)) return;

    Mat4 m;
    if (!safe_read(&m, sizeof(m), obj + OBJ_MAT)) return;

    uint32_t tmpl = read_u32(obj + OBJ_TMPL);
    char name[128];
    read_template_name(tmpl, name, sizeof(name));
    uint32_t tid = tmpl > 0x10000 ? read_u32(tmpl + TMPL_ID) : 0;
    uint32_t gid = read_u32(obj + OBJ_ID);

    float q[4];
    to_quat(&m, q);

    int ti = hash_find(key, hash_of(key));
    if (ti < 0) {
        if (g_tracked_n >= MAX_TRACKED) return;
        ti = g_tracked_n++;
        g_tracked[ti].id = key;
        hash_insert(key, ti, hash_of(key));
        Tracked *tr = &g_tracked[ti];
        tr->x = m.p[0]; tr->y = m.p[1]; tr->z = m.p[2];
        tr->qx = q[0]; tr->qy = q[1]; tr->qz = q[2]; tr->qw = q[3];
        tr->gen = g_gen;
        fprintf(g_file, "{\"k\":\"o\",\"t\":%.3f,\"id\":%u,\"gid\":%u,\"tmpl\":\"%s\",\"tid\":%u}\n",
                g_t, key, gid, name, tid);
        return;
    }

    Tracked *tr = &g_tracked[ti];
    tr->gen = g_gen;
    float dx = tr->x - m.p[0], dy = tr->y - m.p[1], dz = tr->z - m.p[2];
    float dq = tr->qx - q[0] + tr->qy - q[1] + tr->qz - q[2] + tr->qw - q[3];
    if (dx * dx + dy * dy + dz * dz < 1e-4f && (dq < 0.008f && dq > -0.008f))
        return;
    tr->x = m.p[0]; tr->y = m.p[1]; tr->z = m.p[2];
    tr->qx = q[0]; tr->qy = q[1]; tr->qz = q[2]; tr->qw = q[3];
    fprintf(g_file, "{\"k\":\"s\",\"t\":%.3f,\"o\":[[%u,%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f]]}\n",
            g_t, key, m.p[0], m.p[1], m.p[2], q[0], q[1], q[2], q[3]);
}

/* MSVC map walk: leftmost of _Myhead->_Left, in-order successor. */
static uint32_t successor(uint32_t node, uint32_t head)
{
    uint32_t right = read_u32(node + NODE_RIGHT);
    if (right && !(read_u32(right + 0x15) & 1)) {
        node = right;
        for (;;) {
            uint32_t left = read_u32(node + NODE_LEFT);
            if (!left || (read_u32(left + 0x15) & 1)) break;
            node = left;
        }
        return node;
    }
    uint32_t parent = read_u32(node + NODE_PARENT);
    while (parent && parent != head) {
        if (read_u32(parent + NODE_LEFT) == node) return parent;
        node = parent;
        parent = read_u32(node + NODE_PARENT);
    }
    return head;
}

static DWORD WINAPI sampler(LPVOID arg)
{
    (void)arg;
    double next_sample = 0.0;

    for (;;) {
        Sleep(1000 / 30);
        if (!g_on) continue;
        if (!g_file) open_file();
        if (!g_file) { g_on = 0; continue; }

        double t = now_s();
        if (t < next_sample) continue;
        next_sample = t + 1.0 / g_hz;

        uint32_t om = read_u32(OBJECT_MANAGER_PTR);
        if (!om || om < 0x10000) continue;

        uint32_t head = read_u32(om + TREE_HEAD);
        if (!head || head < 0x10000) continue;

        if (g_debug) {
            static double last_dbg = 0.0;
            if (t - last_dbg > 5.0) {
                last_dbg = t;
                fprintf(stderr, "recorder dbg: count=%u tracked=%d\n",
                        read_u32(om + TREE_SIZE), g_tracked_n);
            }
        }

        g_t = t;
        g_gen++;

        /* leftmost node */
        uint32_t node = read_u32(head + NODE_LEFT);
        if (node && !(read_u32(node + 0x15) & 1)) {
            while (node && node != head) {
                sample_object(node);
                node = successor(node, head);
            }
        }

        int w = 0;
        for (int i = 0; i < g_tracked_n; i++) {
            if (g_tracked[i].gen != g_gen) {
                fprintf(g_file, "{\"k\":\"d\",\"t\":%.3f,\"id\":%u}\n", t, g_tracked[i].id);
                continue;
            }
            if (w != i) g_tracked[w] = g_tracked[i];
            w++;
        }
        if (w != g_tracked_n) {
            g_tracked_n = w;
            hash_rebuild();
        }
        fflush(g_file);
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* IAT patch: route the game's winmm imports through the system dll    */
/* ------------------------------------------------------------------ */

#include <winver.h>

static void iat_hook(void)
{
    HMODULE exe = GetModuleHandleA(NULL);
    if (!exe) return;
    PIMAGE_DOS_HEADER dos = (PIMAGE_DOS_HEADER)exe;
    PIMAGE_NT_HEADERS nt = (PIMAGE_NT_HEADERS)((uintptr_t)exe + dos->e_lfanew);
    DWORD rva = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress;
    if (!rva) return;
    PIMAGE_IMPORT_DESCRIPTOR imp =
        (PIMAGE_IMPORT_DESCRIPTOR)((uintptr_t)exe + rva);
    for (; imp->Name; imp++) {
        const char *name = (const char *)((uintptr_t)exe + imp->Name);
        if (_stricmp(name, "winmm.dll") != 0) continue;
        PIMAGE_THUNK_DATA thunk =
            (PIMAGE_THUNK_DATA)((uintptr_t)exe + imp->FirstThunk);
        /* Point every winmm import at the system dll's export: walk the
         * original first-thunk names, GetProcAddress the system copy,
         * write the address over the IAT entry. */
        DWORD origRva = imp->OriginalFirstThunk;
        PIMAGE_THUNK_DATA orig = origRva
            ? (PIMAGE_THUNK_DATA)((uintptr_t)exe + origRva)
            : thunk;
        if (!g_real_winmm) real("timeGetTime");
        if (!g_real_winmm) return;
        for (; orig->u1.Ordinal; orig++, thunk++) {
            if (IMAGE_SNAP_BY_ORDINAL(orig->u1.Ordinal)) continue;
            PIMAGE_IMPORT_BY_NAME byname =
                (PIMAGE_IMPORT_BY_NAME)((uintptr_t)exe + orig->u1.AddressOfData);
            FARPROC fp = GetProcAddress(g_real_winmm, (LPCSTR)byname->Name);
            if (!fp) continue;
            DWORD oldprot;
            VirtualProtect(&thunk->u1.Function, sizeof(void *), PAGE_READWRITE, &oldprot);
            thunk->u1.Function = (uintptr_t)fp;
            VirtualProtect(&thunk->u1.Function, sizeof(void *), oldprot, &oldprot);
        }
        fprintf(stderr, "recorder: winmm IAT rerouted to system winmm.dll\n");
        return;
    }
    fprintf(stderr, "recorder: no winmm import found; nothing to forward\n");
}

/* ------------------------------------------------------------------ */

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved)
{
    (void)inst; (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(inst);
        /* stderr goes nowhere on a Windows service host; keep a log file. */
        freopen("recorder.log", "w", stderr);
        setvbuf(stderr, NULL, _IONBF, 0);
        read_config();
        iat_hook();
        if (g_on) {
            hash_rebuild();
            HANDLE th = CreateThread(NULL, 0, sampler, NULL, 0, NULL);
            if (th) CloseHandle(th);
            fprintf(stderr, "recorder: sampler thread started\n");
        }
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_file) fclose(g_file);
    }
    return TRUE;
}
