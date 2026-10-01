/*
 * The w32ded target layer (BF1942_w32ded.exe, retail v1.61).
 *
 * A 32-bit proxy DLL: build as WINMM.dll, drop it next to
 * BF1942_w32ded.exe. The PE import table resolves WINMM first from the
 * application directory (standard Windows search order, no loader changes
 * needed), so the game loads us; we forward every winmm call to the system
 * copy by patching the game's IAT and run a sampler thread alongside.
 * Offsets are read out of BF1942_w32ded.exe itself (md5 1f75eb8b),
 * derivation in ../w32ded-offsets.md. One source tree, two compilers: the
 * engine class layout matches bf1942_lnxded, the STL does not, so the
 * registered-objects map is the MSVC (VC7/Dinkumware) layout.
 *
 * Stage-1 port (REC_STAGE3=0): object map walk, transforms, template names,
 * destruction -- the h/o/s/d records, format v4. The stage-3 surfaces (the
 * three detours, joints, engines, armor, tickets, kits) live in the shared
 * core already and are NOT compiled in; porting them means cross-matching
 * the detour sites and stage-3 layouts through the anchor chain in
 * w32ded-offsets.md and filling this target's table, not copying code.
 *
 * The detour layer is a deliberate stub: RWX trampolines patched through
 * /proc/self/mem have no Windows equivalent; the Windows side wants IAT
 * patches or VirtualProtect byte patches. install_detours is a no-op until
 * then.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "core.h"

#pragma comment(lib, "kernel32")

/* ------------------------------------------------------------------ */
/* winmm forwarding                                                    */
/* ------------------------------------------------------------------ */

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
 * This keeps our exports to just DllMain. */

/* ------------------------------------------------------------------ */
/* safe reads                                                          */
/* ------------------------------------------------------------------ */

/* The sampler runs on its own thread while the game thread mutates the
 * world. A torn pointer must cost a skipped sample, not a crash. On
 * Windows: IsBadReadPtr pre-check plus bounds (the /proc/self/mem pread
 * trick is Linux-only). No SEH needed in practice; a racing destroy
 * costs a skipped sample. */
static int w32_safe_read(void *dst, size_t len, uintptr_t addr)
{
    if (addr < 0x10000 || addr + len > 0x7fff0000u) return 0;
    if (IsBadReadPtr((const void *)addr, len)) return 0;
    memcpy(dst, (const void *)addr, len);
    return 1;
}

/* Stage 3 patches .text through /proc/self/mem on lnxded. On Windows the
 * detour layer is stubbed until its sites are cross-matched (w32ded wants
 * IAT patches or VirtualProtect byte patches). */
static int w32_patch_write(uintptr_t addr, const void *src, size_t len)
{
    (void)addr; (void)src; (void)len;
    return 0;
}

static uint32_t w32_net_id_of(uintptr_t obj)
{
    /* The net-id read is a stage-3 layout item (lnxded: IObject+0x68 ->
     * NetworkableBase, word at +4); unverified on w32ded, so a stage-1
     * record keys on the registered map's key. */
    (void)obj;
    return 0;
}

/* Stage 3 reads a player name / kit name through a std::string; the SGI
 * one-pointer shape is a libstdc++ detail, so this is the lnxded shim.
 * Unused at stage 1 (and to be re-derived for the Dinkumware string when
 * the stage-3 port lands). */
static void w32_read_string(uintptr_t str_obj, char *out, size_t cap)
{
    (void)str_obj; (void)cap;
    out[0] = 0;
}

static double w32_now_s(void)
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

/* ------------------------------------------------------------------ */
/* template names (w32ded live layout, see w32ded-offsets.md)          */
/* ------------------------------------------------------------------ */

static int g_tmpl_dumps;   /* RECORDER_TMPL_DUMP-style hexdump, debug only:
                            * read the template header from live memory. */

static void hexdump_templ(uintptr_t tmpl)
{
    if (!g_debug || g_tmpl_dumps >= 4) return;
    g_tmpl_dumps++;
    unsigned char b[0x100];
    if (!w32_safe_read(b, sizeof(b), tmpl)) return;
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

static void w32_read_template_name(uintptr_t tmpl, char *out, size_t cap)
{
    out[0] = 0;
    if (tmpl < 0x10000) return;
    hexdump_templ(tmpl);
    /* Candidate A: Dinkumware inline: len at +0x1c, chars at +0x0c.
     * Verified live: "terrainObject" len 13 at +0x1c, chars at +0x0c. */
    uint32_t slen = read_u32(tmpl + 0x1c);
    if (slen >= 3 && slen <= 64) {
        char buf[80];
        if (w32_safe_read(buf, slen, tmpl + 0x0c)) {
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
    if (w32_safe_read(hdr, sizeof(hdr), tmpl + 8)) {
        uint32_t sp = hdr[0], sl = hdr[1];
        if (sp >= 0x400000 && sp < 0x7fff0000 && sl >= 3 && sl <= 64) {
            char buf[80];
            if (w32_safe_read(buf, sl, sp)) {
                buf[sl] = 0;
                snprintf(out, cap, "%s", buf);
                return;
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* the MSVC registered-objects tree walk                               */
/* ------------------------------------------------------------------ */

/* MSVC map walk: leftmost of _Myhead->_Left, in-order successor.
 * Tree at om+0xa0 (lnxded: om+0x94, SGI layout). Node: _Left +0,
 * _Parent +4, _Right +8, key +0xc, IObject* +0x10, _Isnil byte +0x15. */
static uint32_t w32_tree_successor(uint32_t node, uint32_t head)
{
    uint32_t right = read_u32(node + 0x08);
    if (right && !(read_u32(right + 0x15) & 1)) {
        node = right;
        for (;;) {
            uint32_t left = read_u32(node + 0x00);
            if (!left || (read_u32(left + 0x15) & 1)) break;
            node = left;
        }
        return node;
    }
    uint32_t parent = read_u32(node + 0x04);
    while (parent && parent != head) {
        if (read_u32(parent + 0x00) == node) return parent;
        node = parent;
        parent = read_u32(node + 0x04);
    }
    return head;
}

/* ------------------------------------------------------------------ */
/* threads and file plumbing                                           */
/* ------------------------------------------------------------------ */

static void w32_lock(void)   { }
static void w32_unlock(void) { }

static void w32_sleep(void)
{
    Sleep(1000 / 30);
}

static void w32_make_replays_dir(void)
{
    CreateDirectoryA("replays", NULL);
}

static void *(*g_core_sampler)(void *);

static DWORD WINAPI sampler_thunk(LPVOID arg)
{
    (void)arg;
    g_core_sampler(0);
    return 0;
}

static int w32_start_sampler_thread(void *(*fn)(void *))
{
    g_core_sampler = fn;
    HANDLE th = CreateThread(NULL, 0, sampler_thunk, NULL, 0, NULL);
    if (th) CloseHandle(th);
    return th != NULL;
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
/* the target table (w32ded-offsets.md)                                */
/* ------------------------------------------------------------------ */

const struct rec_target w32ded_target = {
    .name = "w32ded",
    .header_plus = "server-replay-recorder-w32ded",
    .header_version = 4,

    .object_manager_ptr = 0x0074c52cu,  /* dice::ref2::world::objectManager */

    /* stage 3: not ported; sites and layouts to cross-match through the
     * anchor chain in w32ded-offsets.md. */
    .player_manager_ptr = 0u,
    .template_manager_ptr = 0u,
    .setup_ptr = 0u,
    .score_manager_ptr = 0u,
    .vt_rot_bundle = 0u,
    .vt_engine = 0u,
    .vt_soldier = 0u,
    .vt_phys_engine = 0u,
    .vt_score_manager = 0u,

    /* The MSVC registered-objects tree at om+0xa0: om+0xa4 _Myhead
     * (sentinel), om+0xa8 _Mysize; node _Left +0, _Parent +4, _Right +8,
     * key +0xc, IObject* +0x10, _Isnil byte +0x15. */
    .map_head_off = 0xa4u,
    .map_count_off = 0xa8u,
    .node_leftmost_off = 0x00u,         /* _Myhead->_Left */
    .node_parent_off = 0x04u,
    .node_left_off = 0x00u,
    .node_right_off = 0x08u,
    .node_key_off = 0x0cu,
    .node_value_off = 0x10u,
    .node_isnil_off = 0x15u,

    .min_addr = 0x10000u,
    .min_tmpl_addr = 0x10000u,
    .obj_flags_off = 0x04u,             /* u32: ROOT 0x02000000, DISABLED 1 */
    .obj_id_off = 0x48u,                /* object-manager id (gid) */
    .obj_tmpl_off = 0x4cu,
    .obj_mat_off = 0x74u,               /* Mat4: rows a,b,c then position */
    .tmpl_id_off = 0x34u,               /* candidate: 0x181 seen at +0x34; verify in run */

    /* stage 3: unverified on w32ded (all zeros until cross-matched). */
    .obj_parent_off = 0u,
    .obj_compmap_off = 0u,
    .armor_iid = 0u,
    .armor_hp_off = 0x104u,             /* save 0x004fdc80 (hitPoints) */
    .armor_maxhp_off = 0x108u,
    .armor_crit_off = 0x164u,
    .armor_lasthit_off = 0u,
    .eng_pe_off = 0u,
    .pe_revs_off = 0u,
    .pe_gear_off = 0u,
    .eng_flags_off = 0x142u,            /* engine layout carries over (running +0x142, disabled +0x143) */
    .eng_throttle_off = 0x124u,         /* engine layout carries over */
    .sol_lower_off = 0u,
    .sol_upper_off = 0u,
    .sol_item_off = 0u,
    .sol_bits_off = 0u,
    .pm_list_off = 0u,
    .pl_node_player_off = 0u,
    .bf_id_off = 0u,
    .bf_name_off = 0u,
    .bf_ai_off = 0u,
    .bf_team_off = 0u,
    .bf_veh_off = 0u,
    .bf_cam_off = 0u,
    .kit_class_id = 0u,
    .kit_getkit_slot = 0u,
    .om_get_slot1 = 0u,
    .om_get_slot2 = 0u,
    .score_base_off = 0u,
    .score_stride_off = 0u,
    .score_tickets_off = 0u,
    .setup_level_off = 0u,
    .setup_gpm_off = 0u,
    .get_bf_player_addr = 0u,
    .get_root_parent_addr = 0u,

    .walk_clamp_count = 1,      /* clamp the walk bound's count at 100000 */
    .sample_reset_next = 1,     /* next_sample = t + 1/hz */
    .flush_each_line = 0,       /* the sampler flushes once per pass */

    .safe_read = w32_safe_read,
    .patch_write = w32_patch_write,
    .now_s = w32_now_s,
    .net_id_of = w32_net_id_of,
    .read_string = w32_read_string,
    .read_template_name = w32_read_template_name,
    .tree_successor = w32_tree_successor,
    .make_replays_dir = w32_make_replays_dir,
    .rec_lock = w32_lock,
    .rec_unlock = w32_unlock,
    .rec_sleep = w32_sleep,
    .install_detours = 0,       /* stubbed: no detours at stage 1 */
    .start_sampler_thread = w32_start_sampler_thread,
};

/* ------------------------------------------------------------------ */

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved)
{
    (void)inst; (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(inst);
        /* stderr goes nowhere on a Windows service host; keep a log file. */
        freopen("recorder.log", "w", stderr);
        setvbuf(stderr, NULL, _IONBF, 0);
        iat_hook();
        recorder_core_init(&w32ded_target);
    } else if (reason == DLL_PROCESS_DETACH) {
        /* the sampler's file handle lives in the core */
        recorder_core_shutdown();
    }
    return TRUE;
}
