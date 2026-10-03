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
 * Stage-1 port history: object map walk, transforms, template names,
 * destruction (the h/o/s/d records). Stage 3 is now in: the two detour
 * sites (addEventToSendQueue 0x00478490, sendGameEventToAll 0x00471090),
 * the roster walk, engines, armor, tickets and kits live in the shared
 * core; their w32 layouts are in w32ded-offsets.md pass 4. fireBarrel's
 * w32 address is still open (FIRE_SITE 0 = the detour is not installed).
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

/* Stage 3 patches .text: VirtualProtect to RWX, copy, restore, flush. */
static int w32_patch_write(uintptr_t addr, const void *src, size_t len)
{
    DWORD old;
    if (!VirtualProtect((void *)addr, len + 16, PAGE_EXECUTE_READWRITE, &old))
        return 0;
    memcpy((void *)addr, src, len);
    DWORD tmp;
    VirtualProtect((void *)addr, len + 16, old, &tmp);
    FlushInstructionCache(GetCurrentProcess(), (void *)addr, len);
    return 1;
}

static uint32_t w32_net_id_of(uintptr_t obj)
{
    /* IObject+0x68 -> NetworkableBase, u16 at +4 (the read the createPlayer
     * event builder 0x004787e0 makes for vehicle/camera/kit net ids). */
    uint32_t net = read_u32(obj + 0x68);
    if (net < 0x1000) return 0;
    return read_u32(net + 4) & 0xffff;
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

/* A VC7.0 Dinkumware string by value (the shape the live template-name
 * reader confirmed): 28 bytes, chars inline at +4 (16-byte buffer) with the
 * length at +0x14; longer strings keep a pointer at +0. */
static void w32_dinkum_string(char *s, char *out, size_t cap)
{
    out[0] = 0;
    if (!w32_safe_read(s, 0x1c, (uintptr_t)s)) return;
    uint32_t len = read_u32((uintptr_t)s + 0x14);
    if (len == 0 || len > 63) return;
    uintptr_t chars = len <= 15 ? (uintptr_t)s + 4 : read_u32((uintptr_t)s);
    if (chars < 0x10000) return;
    if (len >= cap) len = cap - 1;
    if (!w32_safe_read(out, len, chars)) { out[0] = 0; return; }
    out[len] = 0;
}

/* SEH is unavailable on i386 mingw, so every sampler-thread virtual call is
 * guarded instead: IsBadCodePtr vetoes wild/garbage slot values (a dead
 * object's freed vtable reads zeros or reuse garbage; the live coop crash
 * was a call through such a pointer). */
static int w32_vt_call_ok(uint32_t fn)
{
    if (fn < 0x10000 || (fn & 3)) return 0;
    return !IsBadCodePtr((FARPROC)(uintptr_t)fn);
}

static int w32_seh_name(uintptr_t player, char *buf)
{
    uint32_t vt = read_u32(player);
    if (vt < 0x10000) return 0;
    uint32_t fn = read_u32(vt + 0x18);
    if (!w32_vt_call_ok(fn)) return 0;
    ((void (REC_VTCALL *)(void *, char *))fn)((void *)player, buf);
    return 1;
}

static int w32_seh_ai(uintptr_t player)
{
    uint32_t vt = read_u32(player);
    if (vt < 0x10000) return 0;
    uint32_t fn = read_u32(vt + 0x44);
    if (!w32_vt_call_ok(fn)) return 0;
    return (int)(((uint32_t (REC_VTCALL *)(void *))fn)((void *)player)) & 0xff;
}

/* BFPlayer::getName is virtual (vt slot 6, the call the createPlayer event
 * builder makes); there is no plain name field on w32ded. Returns the string
 * by value (hidden return buffer as the first stack argument). */
static void w32_read_player_name(uintptr_t player, char *out, size_t cap)
{
    out[0] = 0;
    if (player < 0x10000) return;
    char buf[32] = {};
    if (!w32_seh_name(player, buf)) return;
    w32_dinkum_string(buf, out, cap);
}

/* BFPlayer::getIsAIPlayer, virtual vt slot 17 (createPlayer's ev+0x2f fill). */
static int w32_read_player_ai(uintptr_t player)
{
    if (player < 0x10000) return 0;
    return w32_seh_ai(player);
}

/* getBFPlayer(IPlayer*) is the identity on the server (lnxded 0x08052ac0 is
 * literally mov eax,[esp+4]; the w32 IPlayer is the BFPlayer). */
static uint32_t w32_get_bf_player(uint32_t p) { return p; }

/* getRootParent(ICompositeObject const*) 0x0818d4b0's walk: root-flagged
 * objects return themselves, everything else climbs +0x50 until the root
 * flag (same layout: w32 BObject zeroes +0x50/+0x54 in its ctor). */
static uint32_t w32_root_parent(uint32_t obj)
{
    uint32_t cur = obj;
    for (int i = 0; i < 32 && cur >= 0x1000; i++) {
        if (read_u32(cur + 4) & 0x02000000u) return cur;
        uint32_t parent = read_u32(cur + 0x50);
        if (parent < 0x1000) return cur;
        cur = parent;
    }
    return cur;
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

/* --- threads and file plumbing                                           */
/* ------------------------------------------------------------------ */

static CRITICAL_SECTION g_rec_cs;
static int g_rec_cs_init;

static void w32_lock(void)
{
    if (!g_rec_cs_init) {
        InitializeCriticalSection(&g_rec_cs);
        g_rec_cs_init = 1;
    }
    EnterCriticalSection(&g_rec_cs);
}

static void w32_unlock(void)
{
    if (g_rec_cs_init) LeaveCriticalSection(&g_rec_cs);
}

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
/* stage 3: the detour layer (VirtualProtect byte patches + RWX        */
/* trampolines; sites and prologues in w32ded-offsets.md pass 4)       */
/* ------------------------------------------------------------------ */

extern volatile int g_hook_active;
extern void recorder_on_event(uint32_t ev);
extern void recorder_on_queue_event(uint32_t ev);
extern void recorder_on_fire(uint32_t fire_arms, uint32_t player,
                             uint32_t mat4_addr);

#define AETSQ_SITE  0x00478490u  /* GameEventManager::addEventToSendQueue */
#define TOALL_SITE  0x00471090u  /* GameServer::sendGameEventToAll */  /* GameServer::sendGameEventToAll */
#define FIRE_SITE   0u           /* FireArms::fireBarrel: not located yet */

/* addEventToSendQueue's prologue, 13 bytes (objdump 0x00478490):
 *   8b 44 24 04     mov  0x4(%esp),%eax     ; the event ([esp+4] at entry)
 *   85 c0           test %eax,%eax
 *   75 05           jne  +5
 *   32 c0           xor  %al,%al
 *   c2 04 00        ret  $0x4               ; next instruction 0x0047849d */
static const uint8_t AETSQ_ORIG[] = {
    0x8b, 0x44, 0x24, 0x04, 0x85, 0xc0, 0x75, 0x05,
    0x32, 0xc0, 0xc2, 0x04, 0x00
};
#define AETSQ_LEN sizeof(AETSQ_ORIG)

/* sendGameEventToAll's first 10 bytes (objdump 0x00471090):
 *   51                 push %ecx
 *   56                 push %esi
 *   8b f1              mov  %ecx,%esi
 *   8b 86 d8 01 00 00  mov  0x1d8(%esi),%eax
 * None of them is relative, and no branch in the body lands inside them
 * (its targets are +0x28, +0x36, +0x42, +0x59), so the trampoline carries
 * these and jumps back to 0x0047109a. The 14-byte cut would take the
 * `je +0x4b` along (relative, wrong once copied), and copying the whole
 * 94-byte body is worse: its two `call rel32` (addEvent 0x00478a50, the
 * set iterator 0x0047ccc0) are relative too, and run off into the heap the
 * first time a client is connected. */
static const uint8_t TOALL_ORIG[] = {
    0x51, 0x56, 0x8b, 0xf1, 0x8b, 0x86, 0xd8, 0x01, 0x00, 0x00
};
#define TOALL_LEN sizeof(TOALL_ORIG)
#define TOALL_BACK (TOALL_SITE + TOALL_LEN)

/* The stubs: entered by a jmp, so the caller's frame is intact -- pusha
 * (32) + pushfl (4) puts entry [esp+0] at [esp+36]. thiscall: [esp+4] at
 * entry is the first stack argument (the event / the player). */
__asm__(
".text\n"
".globl _recorder_stub_event\n"
"_recorder_stub_event:\n"          /* addEventToSendQueue(ecx=GEM, ev@+4) */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"         /* the event */
"  pushl %eax\n"
"  call  _recorder_on_queue_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_event\n"
".globl _recorder_stub_toall\n"
"_recorder_stub_toall:\n"          /* sendGameEventToAll(ecx=this, ev@+4, bool@+8) */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"         /* the event */
"  pushl %eax\n"
"  call  _recorder_on_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_toall\n"
".globl _recorder_stub_fire\n"
"_recorder_stub_fire:\n"           /* fireBarrel(ecx=this, player@+4, Mat4&@+8, barrel@+0xc) */
"  pusha\n"
"  pushfl\n"
"  movl  28(%esp), %eax\n"         /* this: pusha's saved ecx (36 is the return address) */
"  movl  40(%esp), %edx\n"         /* player */
"  movl  44(%esp), %ecx\n"         /* Mat4* */
"  pushl %ecx\n"
"  pushl %edx\n"
"  pushl %eax\n"
"  call  _recorder_on_fire\n"
"  addl  $12, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_fire\n"
".data\n"
".globl _recorder_tramp_event\n"
".align 4\n"
"_recorder_tramp_event: .long 0\n"
".globl _recorder_tramp_fire\n"
"_recorder_tramp_fire: .long 0\n"
".globl _recorder_tramp_toall\n"
"_recorder_tramp_toall: .long 0\n"
);

extern char recorder_stub_event;
extern char recorder_stub_fire;
extern char recorder_stub_toall;
extern uint32_t recorder_tramp_event;
extern uint32_t recorder_tramp_fire;
extern uint32_t recorder_tramp_toall;

/* One RWX page holds every trampoline: the copied prologue, then a jmp
 * back to the first unpatched instruction. */
static uint8_t *g_tramp_page;
static size_t g_tramp_used;

static int build_trampoline(const void *orig_bytes, size_t len,
                            uintptr_t back_to, uintptr_t *out)
{
    if (!g_tramp_page) {
        g_tramp_page = VirtualAlloc(NULL, 4096,
                                    MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
        if (!g_tramp_page) return 0;
    }
    uintptr_t at = (uintptr_t)g_tramp_page + g_tramp_used;
    if (g_tramp_used + len + 5 > 4096) return 0;
    memcpy((void *)at, orig_bytes, len);
    uint8_t jmp[5];
    jmp[0] = 0xe9;
    int32_t rel = (int32_t)(back_to - (at + len + 5));
    memcpy(jmp + 1, &rel, 4);
    memcpy((void *)(at + len), jmp, 5);
    FlushInstructionCache(GetCurrentProcess(), (void *)at, len + 5);
    g_tramp_used += len + 5;
    *out = at;
    return 1;
}

static int install_detour(uintptr_t site, const uint8_t *expected, size_t len,
                          void *stub, const uint8_t *orig_bytes,
                          uintptr_t back_to, uint32_t *tramp_out)
{
    if (!site) return 0;
    uint8_t have[20];
    if (!w32_safe_read(have, len, site) || memcmp(have, expected, len) != 0) {
        fprintf(stderr, "recorder: %08lx is not the expected code, detour skipped\n",
                (unsigned long)site);
        return 0;
    }
    uintptr_t tramp = 0;
    if (!build_trampoline(orig_bytes, len, back_to, &tramp)) {
        fprintf(stderr, "recorder: trampoline for %08lx failed\n", (unsigned long)site);
        return 0;
    }
    /* The tramp pointer MUST be live before the site is patched: another
     * thread can hit the jmp the instant the bytes land (first live run
     * died exactly there -- the stub jumped through a still-null pointer). */
    *tramp_out = (uint32_t)tramp;
    uint8_t patch[160];
    patch[0] = 0xe9;
    int32_t rel = (int32_t)((uintptr_t)stub - (site + 5));
    memcpy(patch + 1, &rel, 4);
    for (size_t i = 5; i < len; i++) patch[i] = 0x90;   /* jmp + trailing nops */
    if (len > sizeof(patch)) return 0;
    if (!w32_patch_write(site, patch, len)) {
        fprintf(stderr, "recorder: patch at %08lx failed\n", (unsigned long)site);
        return 0;
    }
    {
        uint8_t back[8] = {};
        w32_safe_read(back, 5, site);
        fprintf(stderr, "recorder: %08lx now %02x %02x %02x %02x %02x (stub %p)\n",
                (unsigned long)site, back[0], back[1], back[2], back[3],
                back[4], stub);
    }
    *tramp_out = (uint32_t)tramp;
    return 1;
}

static int w32_install_detours(void)
{
    uint32_t t3 = 0;
    /* tramp_out points straight at the globals the stubs jump through:
     * they must be live before the site bytes land (see install_detour). */
    g_hook_active = 1;
    install_detour(AETSQ_SITE, AETSQ_ORIG, AETSQ_LEN,
                   &recorder_stub_event, AETSQ_ORIG,
                   AETSQ_SITE + AETSQ_LEN, &recorder_tramp_event);
    install_detour(TOALL_SITE, TOALL_ORIG, TOALL_LEN,
                   &recorder_stub_toall, TOALL_ORIG,
                   TOALL_BACK, &recorder_tramp_toall);
    if (FIRE_SITE) install_detour(FIRE_SITE, 0, 0, 0, 0, 0, &t3);
    return 1;
}

/* ------------------------------------------------------------------ */
/* the target table (w32ded-offsets.md)                                */
/* ------------------------------------------------------------------ */

const struct rec_target w32ded_target = {
    .name = "w32ded",
    .header_plus = "server-replay-recorder-w32ded",
    .header_version = 5,

    .object_manager_ptr = 0x0074c52cu,  /* dice::ref2::world::objectManager */
    .player_manager_ptr = 0x0074c534u,  /* dice::ref2::world::playerManager */
    .template_manager_ptr = 0x0074c530u,/* dice::ref2::world::objectTemplateManager */
    .setup_ptr = 0u,                    /* not located; write_level skips */
    .score_manager_ptr = 0x00749c70u,   /* the "Tickets: Axis" printer's global */
    /* vtables: MSVC vptr = the vtable itself. rot/engine/soldier/physengine
     * come from the live vptr census (no RTTI in this binary). */
    .vt_rot_bundle = 0u,
    .vt_engine = 0u,
    .vt_soldier = 0u,
    .vt_phys_engine = 0u,
    .vt_score_manager = 0x006e8858u,    /* ScoreManager ctor 0x00466930 */

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

    /* stage 3 (w32ded-offsets.md pass 4) */
    .obj_parent_off = 0x50u,            /* BObject ctor zeroes +0x50/+0x54 */
    .obj_compmap_off = 0xe0u,           /* candidate: ctor zeroes +0xe0..+0xe8; verify in run */
    .armor_iid = 0xc4a4u,               /* the queryComponent key (0x004044cb) */
    .armor_hp_off = 0x38u,              /* Armor ctor 0x0047f9f0: heal/damage read/write +0x38 */
    .armor_maxhp_off = 0x3cu,           /* setter clamps at 128 (slot 4) */
    .armor_crit_off = 0xf0u,            /* carried over from lnxded (class layout) */
    .armor_lasthit_off = 0x14u,         /* setter skips -1 (slot 29) */
    .eng_pe_off = 0x60u,                /* PhysicsEngine* (layout carries over) */
    .pe_revs_off = 0xa0u,
    .pe_gear_off = 0xbcu,
    .eng_flags_off = 0x142u,            /* running +0x142, disabled +0x143 */
    .eng_throttle_off = 0x124u,
    .sol_lower_off = 0x2b4u,            /* BFSoldier anim machines (carried over; verify) */
    .sol_upper_off = 0x2f8u,
    .sol_item_off = 0x3b8u,
    .sol_bits_off = 0x3e6u,
    .pm_list_off = 0x10u,               /* sentinel node pointer (ctor 0x005342f0) */
    .pl_node_player_off = 8u,           /* node {next+0, prev+4, BFPlayer*+8} */
    .pm_sentinel_indirect = 1,          /* walk starts at *(pm+0x10) */
    .bf_id_off = 0xcu,                  /* createPlayer builder: ev id = BFPlayer+0x0c */
    .bf_name_off = 0u,                  /* virtual only: read_player_name */
    .bf_ai_off = 0u,                    /* virtual only: read_player_ai */
    .bf_team_off = 0xacu,
    .bf_veh_off = 0xa4u,                /* controlled object (ev vehicle net id) */
    .bf_cam_off = 0x98u,                /* free camera */
    .kit_class_id = 0x9493u,            /* BFSoldier template class id (id table 0x6ea4a0) */
    .kit_getkit_slot = 0x100u,          /* soldier vt+0x100 = getKit */
    .om_get_slot1 = 0x20u,              /* objectManager lookup vslots */
    .om_get_slot2 = 0x24u,
    .score_base_off = 0x60u,            /* ScoreManager ctor: team array */
    .score_stride_off = 0x50u,
    .score_tickets_off = 0x48u,         /* the "Tickets: Axis" row */
    .setup_level_off = 0u,
    .setup_gpm_off = 0u,
    .get_bf_player_addr = (uint32_t)w32_get_bf_player,  /* identity */
    .get_root_parent_addr = (uint32_t)w32_root_parent,

    .walk_clamp_count = 1,      /* clamp the walk bound's count at 100000 */
    .sample_reset_next = 1,     /* next_sample = t + 1/hz */
    .flush_each_line = 1,       /* the detour threads also write */

    .safe_read = w32_safe_read,
    .patch_write = w32_patch_write,
    .now_s = w32_now_s,
    .net_id_of = w32_net_id_of,
    .read_string = w32_read_string,
    .read_player_name = w32_read_player_name,
    .read_player_ai = w32_read_player_ai,
    .vt_call_ok = w32_vt_call_ok,
    .read_template_name = w32_read_template_name,
    .tree_successor = w32_tree_successor,
    .make_replays_dir = w32_make_replays_dir,
    .rec_lock = w32_lock,
    .rec_unlock = w32_unlock,
    .rec_sleep = w32_sleep,
    .install_detours = w32_install_detours,
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
