/*
 * The w32ded target layer (BF1942_w32ded.exe, retail v1.61).
 *
 * A 32-bit proxy DLL: built as WINMM.dll and dropped next to
 * BF1942_w32ded.exe. Windows looks for a dll in the application's folder
 * before the system folder, so the server loads this one; every winmm export
 * is a jump to the system's own winmm.dll (winmm_exports.py). Offsets are
 * read out of BF1942_w32ded.exe itself (md5 1f75eb8b), derivation in
 * ../research/w32ded-offsets.md. The engine class layout matches
 * bf1942_lnxded, the STL does not: strings and the registered-objects map are
 * MSVC 7.0 (Dinkumware) layouts.
 *
 * The rule this file is built around: the recorder may lose data, never the
 * server. So:
 *   - Nothing starts unless the exe is the build the offsets are for; any
 *     other exe gets a plain winmm proxy and nothing else.
 *   - Every read of the game's memory is w32_copy, a copy whose fault is a
 *     failed read (an exception handler moves the faulting copy to its
 *     failure exit), never IsBadReadPtr (racy, and it disarms another
 *     thread's stack guard page).
 *   - The sampler thread, the writer thread and the game thread's detours
 *     each run inside a guard: any fault in them ends that pass, releases the
 *     write lock if it held it, and is counted; too many in one file and
 *     recording stops (recorder_core_fault).
 *   - The recorder's own threads never call a function of the game's; the
 *     game thread calls only into the exe's own code.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "core.h"

/* ------------------------------------------------------------------ */
/* the exe this build is for                                           */
/* ------------------------------------------------------------------ */

/* BF1942_w32ded.exe v1.61 (md5 1f75eb8b55ab5bb4d6782dd6f3be2e45): its PE
 * header's link time and image size. */
#define EXE_TIMESTAMP  0x417565a6u
#define EXE_IMAGE_SIZE 0x0039b000u

static uintptr_t g_text_lo, g_text_hi;   /* the exe's .text */

/* 1 when the process is that exe; also notes its .text bounds. The headers
 * are the loader's own mapping of the exe, always readable. */
static int exe_is_known(void)
{
    const uint8_t *exe = (const uint8_t *)GetModuleHandleA(NULL);
    if (!exe) return 0;
    const IMAGE_DOS_HEADER *dos = (const IMAGE_DOS_HEADER *)exe;
    const IMAGE_NT_HEADERS32 *nt = (const IMAGE_NT_HEADERS32 *)(exe + dos->e_lfanew);
    if (nt->FileHeader.TimeDateStamp != EXE_TIMESTAMP ||
        nt->OptionalHeader.SizeOfImage != EXE_IMAGE_SIZE) {
        fprintf(stderr, "recorder: this exe (link time %08lx, image %08lx) is not BF1942_w32ded.exe 1.61 "
                "(%08x, %08x); the recorder stays off, winmm calls go through as usual\n",
                (unsigned long)nt->FileHeader.TimeDateStamp,
                (unsigned long)nt->OptionalHeader.SizeOfImage, EXE_TIMESTAMP, EXE_IMAGE_SIZE);
        return 0;
    }
    const IMAGE_SECTION_HEADER *sec = IMAGE_FIRST_SECTION(nt);
    for (int i = 0; i < nt->FileHeader.NumberOfSections; i++, sec++) {
        if (memcmp(sec->Name, ".text", 6) == 0) {
            g_text_lo = (uintptr_t)exe + sec->VirtualAddress;
            g_text_hi = g_text_lo + sec->Misc.VirtualSize;
        }
    }
    return g_text_hi > g_text_lo;
}

/* ------------------------------------------------------------------ */
/* winmm forwarding                                                    */
/* ------------------------------------------------------------------ */

/* From winmm_exports.S: one table entry an export, first pointing at its
 * resolver, the names, and how many there are. */
extern void *w32p_table[];
extern const char *const w32p_names[];
extern const uint32_t w32p_count;

static HMODULE volatile g_real_winmm;

/* A name the system winmm.dll does not have (none of the server's): 0. */
static uint32_t WINAPI w32p_missing(void) { return 0; }

/* The system's winmm.dll, by full path (a bare name would find this proxy,
 * already loaded under that name). Loaded on the first winmm call, not in
 * DllMain. Under WOW64 the system folder of a 32-bit process is SysWOW64. */
static HMODULE real_winmm(void)
{
    HMODULE m = g_real_winmm;
    if (m) return m;
    char path[MAX_PATH];
    UINT n = GetSystemDirectoryA(path, MAX_PATH - 12);
    if (!n || n >= MAX_PATH - 12) return 0;
    lstrcatA(path, "\\winmm.dll");
    m = LoadLibraryA(path);
    if (m) g_real_winmm = m;
    return m;
}

/* An export's first call (winmm_exports.S): the real function's address,
 * kept in the table so later calls jump there directly. */
void *w32_winmm_resolve(uint32_t i)
{
    void *fp = 0;
    if (i < w32p_count) {
        HMODULE m = real_winmm();
        if (m) fp = (void *)GetProcAddress(m, w32p_names[i]);
        if (!fp) fp = (void *)w32p_missing;
        w32p_table[i] = fp;
    } else {
        fp = (void *)w32p_missing;
    }
    return fp;
}

/* ------------------------------------------------------------------ */
/* faults: the copy, the guard and the handler                         */
/* ------------------------------------------------------------------ */

/* w32_copy(dst, src, len): 1, or 0 when the source could not be read. A
 * fault on the rep movsb lands in w32_veh, which resumes at the fixup. */
int w32_copy(void *dst, const void *src, size_t len);
extern char w32_copy_lo, w32_copy_hi, w32_copy_fixup;

/* A pass inside a guard. The asm keeps where to come back to; w32_veh sends
 * a fault there. `locks` counts the write lock's entries the pass holds. */
struct w32_guard {
    uint32_t esp;           /* +0: esp inside w32_guarded_asm */
    uint32_t seh;           /* +4: fs:[0] at entry */
    uint16_t fpucw;         /* +8: the x87 control word at entry */
    uint16_t pad;
    volatile int active;    /* +12 */
    int locks;
    DWORD code;             /* the fault, for the log */
    uint32_t eip;
    struct w32_guard *prev; /* the guard this one is inside, if any */
};

int w32_guarded_asm(struct w32_guard *g, void (*fn)(void *), void *arg);
extern char w32_guarded_recover;

/* Each asm block names its sections and ends in .text: the compiler does not
 * see a section change made here, and puts the C functions after it wherever
 * the block left off. In .data they cannot run where the host enforces DEP.
 * (PE's assembler has no pushsection/popsection.) */
__asm__(
".text\n"
".globl _w32_copy\n"
"_w32_copy:\n"
"  pushl %esi\n"
"  pushl %edi\n"
"  movl  12(%esp), %edi\n"
"  movl  16(%esp), %esi\n"
"  movl  20(%esp), %ecx\n"
"  cld\n"
".globl _w32_copy_lo\n"
"_w32_copy_lo:\n"
"  rep movsb\n"
".globl _w32_copy_hi\n"
"_w32_copy_hi:\n"
"  movl  $1, %eax\n"
"  popl  %edi\n"
"  popl  %esi\n"
"  ret\n"
".globl _w32_copy_fixup\n"
"_w32_copy_fixup:\n"
"  cld\n"
"  xorl  %eax, %eax\n"
"  popl  %edi\n"
"  popl  %esi\n"
"  ret\n"

/* int w32_guarded_asm(g, fn, arg): fn(arg), then 1. The registers the
 * caller keeps, the stack pointer, the SEH chain head and the x87 control
 * word are saved in g first: a fault in fn resumes at w32_guarded_recover
 * with esp = g->esp and eax = g, which puts them back and returns 0. */
".globl _w32_guarded_asm\n"
"_w32_guarded_asm:\n"
"  pushl %ebp\n"
"  pushl %ebx\n"
"  pushl %esi\n"
"  pushl %edi\n"
"  movl  20(%esp), %eax\n"         /* g */
"  movl  %esp, 0(%eax)\n"
"  movl  %fs:0, %ecx\n"
"  movl  %ecx, 4(%eax)\n"
"  fnstcw 8(%eax)\n"
"  movl  28(%esp), %ecx\n"         /* arg */
"  pushl %ecx\n"
"  call  *28(%esp)\n"              /* fn, one push further down */
"  addl  $4, %esp\n"
"  movl  $1, %eax\n"
"  popl  %edi\n"
"  popl  %esi\n"
"  popl  %ebx\n"
"  popl  %ebp\n"
"  ret\n"
".globl _w32_guarded_recover\n"
"_w32_guarded_recover:\n"
"  movl  4(%eax), %ecx\n"
"  movl  %ecx, %fs:0\n"            /* SEH frames the cut-short pass pushed are gone */
"  cld\n"
"  fninit\n"                       /* an x87 stack the pass left half full */
"  fldcw 8(%eax)\n"
"  xorl  %eax, %eax\n"
"  popl  %edi\n"
"  popl  %esi\n"
"  popl  %ebx\n"
"  popl  %ebp\n"
"  ret\n"
".text\n"
);

static DWORD g_tls = TLS_OUT_OF_INDEXES;   /* this thread's innermost guard */
static uintptr_t g_self_lo, g_self_hi;     /* this dll's image */
static volatile LONG g_copy_faults, g_guard_faults;

static int is_fault(DWORD code)
{
    switch (code) {
    case EXCEPTION_ACCESS_VIOLATION:
    case EXCEPTION_IN_PAGE_ERROR:
    case EXCEPTION_GUARD_PAGE:
    case EXCEPTION_DATATYPE_MISALIGNMENT:
    case EXCEPTION_ARRAY_BOUNDS_EXCEEDED:
    case EXCEPTION_ILLEGAL_INSTRUCTION:
    case EXCEPTION_PRIV_INSTRUCTION:
    case EXCEPTION_INT_DIVIDE_BY_ZERO:
    case EXCEPTION_INT_OVERFLOW:
    case EXCEPTION_FLT_DENORMAL_OPERAND:
    case EXCEPTION_FLT_DIVIDE_BY_ZERO:
    case EXCEPTION_FLT_INEXACT_RESULT:
    case EXCEPTION_FLT_INVALID_OPERATION:
    case EXCEPTION_FLT_OVERFLOW:
    case EXCEPTION_FLT_STACK_CHECK:
    case EXCEPTION_FLT_UNDERFLOW:
        return 1;
    }
    return 0;
}

/* A guard page the recorder touched: Windows took the guard off as it
 * raised the exception. Put it back, or the thread whose stack it guards
 * can no longer grow its stack and dies at its next deep call. */
static void rearm_guard_page(const EXCEPTION_RECORD *er)
{
    if (er->NumberParameters < 2) return;
    void *at = (void *)er->ExceptionInformation[1];
    MEMORY_BASIC_INFORMATION mbi;
    if (!VirtualQuery(at, &mbi, sizeof(mbi))) return;
    DWORD old;
    VirtualProtect((void *)((uintptr_t)at & ~(uintptr_t)0xfff), 1,
                   mbi.Protect | PAGE_GUARD, &old);
}

/* First in line for every exception in the process. Only a fault inside
 * the recorder's copy or inside a guarded pass on this thread is handled;
 * everything else (the game's own exceptions, C++ throws, a fault anywhere
 * outside the recorder) goes on to whoever handled it before. */
static LONG CALLBACK w32_veh(EXCEPTION_POINTERS *ep)
{
    EXCEPTION_RECORD *er = ep->ExceptionRecord;
    CONTEXT *c = ep->ContextRecord;
    if (!is_fault(er->ExceptionCode)) return EXCEPTION_CONTINUE_SEARCH;
    if (c->Eip >= (DWORD)(uintptr_t)&w32_copy_lo && c->Eip < (DWORD)(uintptr_t)&w32_copy_hi) {
        if (er->ExceptionCode == EXCEPTION_GUARD_PAGE) rearm_guard_page(er);
        c->Eip = (DWORD)(uintptr_t)&w32_copy_fixup;
        InterlockedIncrement(&g_copy_faults);
        return EXCEPTION_CONTINUE_EXECUTION;
    }
    if (g_tls == TLS_OUT_OF_INDEXES) return EXCEPTION_CONTINUE_SEARCH;
    DWORD err = GetLastError();
    struct w32_guard *g = (struct w32_guard *)TlsGetValue(g_tls);
    SetLastError(err);
    if (!g || !g->active) return EXCEPTION_CONTINUE_SEARCH;
    /* Only a fault in the recorder's own code, or in the exe's code it
     * called. One inside the heap or the C runtime may hold their locks:
     * cutting it short would leave the next malloc on the game thread
     * waiting for good, and a hung server is worse than a crashed one, which
     * its host restarts. Those go on as if the recorder were not here. */
    uintptr_t at = c->Eip;
    if (!((at >= g_self_lo && at < g_self_hi) || (at >= g_text_lo && at < g_text_hi)))
        return EXCEPTION_CONTINUE_SEARCH;
    if (er->ExceptionCode == EXCEPTION_GUARD_PAGE) rearm_guard_page(er);
    g->active = 0;
    g->code = er->ExceptionCode;
    g->eip = c->Eip;
    c->Esp = g->esp;
    c->Eax = (DWORD)(uintptr_t)g;
    c->Eip = (DWORD)(uintptr_t)&w32_guarded_recover;
    InterlockedIncrement(&g_guard_faults);
    return EXCEPTION_CONTINUE_EXECUTION;
}

static CRITICAL_SECTION g_rec_cs;

/* fn(arg) inside a guard (core.h run_guarded). 0 when a fault cut it short;
 * the write lock is released as many times as the pass took it. */
static int w32_run_guarded(void (*fn)(void *), void *arg)
{
    struct w32_guard g;
    memset(&g, 0, sizeof(g));
    g.prev = (struct w32_guard *)TlsGetValue(g_tls);
    g.active = 1;
    TlsSetValue(g_tls, &g);
    int ok = w32_guarded_asm(&g, fn, arg);
    g.active = 0;
    while (g.locks > 0) {
        g.locks--;
        LeaveCriticalSection(&g_rec_cs);
    }
    TlsSetValue(g_tls, g.prev);
    if (!ok && g_guard_faults <= 5)
        fprintf(stderr, "recorder: fault %08lx at %08lx caught\n",
                (unsigned long)g.code, (unsigned long)g.eip);
    return ok;
}

/* ------------------------------------------------------------------ */
/* reads                                                               */
/* ------------------------------------------------------------------ */

static int w32_safe_read(void *dst, size_t len, uintptr_t addr)
{
    if (addr < 0x10000 || len > 0x10000000u || addr + len < addr || addr + len > 0x7fff0000u)
        return 0;
    return w32_copy(dst, (const void *)addr, len);
}

/* Stage 3 patches .text: VirtualProtect to RWX, copy, restore, flush. */
static int w32_patch_write(uintptr_t addr, const void *src, size_t len)
{
    DWORD old;
    if (!VirtualProtect((void *)addr, len, PAGE_EXECUTE_READWRITE, &old))
        return 0;
    memcpy((void *)addr, src, len);
    DWORD tmp;
    VirtualProtect((void *)addr, len, old, &tmp);
    FlushInstructionCache(GetCurrentProcess(), (void *)addr, len);
    return 1;
}

static uint32_t w32_net_id_of(uintptr_t obj)
{
    /* IObject+0x68 -> NetworkableBase, u16 at +4 (the read the createPlayer
     * event builder 0x004787e0 makes for vehicle/camera/kit net ids). */
    uint32_t net = read_u32(obj + 0x68);
    if (net < 0x10000) return 0;
    return read_u32(net + 4) & 0xffff;
}

/* A VC7.0 Dinkumware std::string at `s`, 28 bytes: the allocator +0, the
 * characters +4 (inline while the capacity +0x18 is under 16, otherwise a
 * pointer to them there), the length +0x14. Empty when it does not look
 * like one. */
static void w32_read_string(uintptr_t s, char *out, size_t cap)
{
    out[0] = 0;
    if (cap < 2) return;
    uint8_t b[0x1c];
    if (!w32_safe_read(b, sizeof(b), s)) return;
    uint32_t len, res, ptr;
    memcpy(&len, b + 0x14, 4);
    memcpy(&res, b + 0x18, 4);
    memcpy(&ptr, b + 4, 4);
    if (len == 0 || len > res || len > 4096) return;
    size_t n = len < cap - 1 ? len : cap - 1;
    if (res < 16) {
        memcpy(out, b + 4, n);
    } else if (!w32_safe_read(out, n, ptr)) {
        out[0] = 0;
        return;
    }
    out[n] = 0;
}

/* BFPlayer (vtable 0x006d9f08): getName (vt+0x18, 0x00405b80) returns this
 * + 0x44, a std::string; getId (vt+0x44) reads +0x70; getIsAIPlayer
 * (vt+0x58) the byte at +0xa8. Read as fields: no call into the game. */
#define BF_NAME_OFF 0x44u

static void w32_read_player_name(uintptr_t player, char *out, size_t cap)
{
    out[0] = 0;
    if (player < 0x10000) return;
    w32_read_string(player + BF_NAME_OFF, out, cap);
}

/* An ObjectTemplate's name: getName (vtable +0x14) returns tmpl + 8, a
 * std::string. Names are identifiers; anything else is not a template. */
static void w32_read_template_name(uintptr_t tmpl, char *out, size_t cap)
{
    out[0] = 0;
    if (tmpl < 0x10000) return;
    w32_read_string(tmpl + 8, out, cap);
    for (const char *c = out; *c; c++) {
        unsigned char u = (unsigned char)*c;
        if (!((u >= 'a' && u <= 'z') || (u >= 'A' && u <= 'Z') || (u >= '0' && u <= '9') ||
              u == '_' || u == '.' || u == '-' || u == ' ')) {
            out[0] = 0;
            return;
        }
    }
}

/* The recorder's own threads (sampler, writer): they never call into the
 * game. */
#define MAX_OWN 4
static volatile DWORD g_own_tid[MAX_OWN];
static volatile LONG g_own_n;

static int on_own_thread(void)
{
    DWORD me = GetCurrentThreadId();
    for (LONG i = 0; i < g_own_n && i < MAX_OWN; i++)
        if (g_own_tid[i] == me) return 1;
    return 0;
}

/* A virtual call the core is about to make: only off the recorder's own
 * threads (in practice the game thread inside a detour, on an object the
 * game handed it), and only into the exe's own code. */
static int w32_vt_call_ok(uint32_t fn)
{
    if (on_own_thread()) return 0;
    return fn >= g_text_lo && fn < g_text_hi;
}

/* getBFPlayer(IPlayer*) is the identity on the server (lnxded 0x08052ac0 is
 * literally mov eax,[esp+4]; the w32 IPlayer is the BFPlayer). */
static uint32_t w32_get_bf_player(uint32_t p) { return p; }

/* getRootParent's walk: root-flagged objects return themselves, everything
 * else climbs +0x50 until the root flag. */
static uint32_t w32_root_parent(uint32_t obj)
{
    uint32_t cur = obj;
    for (int i = 0; i < 32 && cur >= 0x10000; i++) {
        if (read_u32(cur + 4) & 0x02000000u) return cur;
        uint32_t parent = read_u32(cur + 0x50);
        if (parent < 0x10000) return cur;
        cur = parent;
    }
    return cur;
}

/* Seconds since the first call, from the performance counter. */
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

/* MSVC map walk: leftmost of _Myhead->_Left, in-order successor.
 * Node: _Left +0, _Parent +4, _Right +8, key +0xc, IObject* +0x10, _Isnil
 * byte +0x15. Bounded: a node the game frees mid-walk can point anywhere. */
static uint32_t w32_tree_successor(uint32_t node, uint32_t head)
{
    uint32_t right = read_u32(node + 0x08);
    if (right && !(read_u32(right + 0x15) & 1)) {
        node = right;
        for (int d = 0; d < 64; d++) {
            uint32_t left = read_u32(node + 0x00);
            if (!left || (read_u32(left + 0x15) & 1)) break;
            node = left;
        }
        return node;
    }
    uint32_t parent = read_u32(node + 0x04);
    for (int d = 0; d < 64 && parent && parent != head; d++) {
        if (read_u32(parent + 0x00) == node) return parent;
        node = parent;
        parent = read_u32(node + 0x04);
    }
    return head;
}

/* ------------------------------------------------------------------ */
/* threads, the write lock, files                                      */
/* ------------------------------------------------------------------ */

static struct w32_guard *my_guard(void)
{
    return g_tls == TLS_OUT_OF_INDEXES ? 0 : (struct w32_guard *)TlsGetValue(g_tls);
}

/* The core's write lock, a critical section. The innermost guard on this
 * thread counts what it holds, so a fault inside the lock releases it. */
static void w32_lock(void)
{
    EnterCriticalSection(&g_rec_cs);
    struct w32_guard *g = my_guard();
    if (g) g->locks++;
}

static int w32_trylock(void)
{
    if (!TryEnterCriticalSection(&g_rec_cs)) return 0;
    struct w32_guard *g = my_guard();
    if (g) g->locks++;
    return 1;
}

static void w32_unlock(void)
{
    struct w32_guard *g = my_guard();
    if (g && g->locks > 0) g->locks--;
    LeaveCriticalSection(&g_rec_cs);
}

/* One 30 Hz tick (33 ms). */
static void w32_sleep(void)
{
    Sleep(1000 / 30);
}

static void w32_make_replays_dir(void)
{
    CreateDirectoryA("replays", NULL);
}

/* The core's threads (the sampler and the writer), below the game's
 * priority: on a busy or single-core host the game runs first and the
 * recorder takes what is left. */
static DWORD WINAPI thread_thunk(LPVOID fn)
{
    LONG i = InterlockedIncrement(&g_own_n) - 1;
    if (i < MAX_OWN) g_own_tid[i] = GetCurrentThreadId();
    ((void *(*)(void *))fn)(0);
    return 0;
}

static int w32_start_thread(void *(*fn)(void *))
{
    HANDLE th = CreateThread(NULL, 0, thread_thunk, (LPVOID)fn, CREATE_SUSPENDED, NULL);
    if (!th) return 0;
    SetThreadPriority(th, THREAD_PRIORITY_BELOW_NORMAL);
    ResumeThread(th);
    CloseHandle(th);
    return 1;
}

/* ------------------------------------------------------------------ */
/* stage 3: the detours (VirtualProtect byte patches + RWX trampolines; */
/* sites and prologues in research/w32ded-offsets.md pass 4)           */
/* ------------------------------------------------------------------ */

extern volatile int g_hook_active;
extern void recorder_on_event(uint32_t ev);
extern void recorder_on_queue_event(uint32_t ev);

#define AETSQ_SITE  0x00478490u  /* GameEventManager::addEventToSendQueue */
#define TOALL_SITE  0x00471090u  /* GameServer::sendGameEventToAll */

/* addEventToSendQueue's prologue, 13 bytes (objdump 0x00478490):
 *   8b 44 24 04     mov  0x4(%esp),%eax     ; the event ([esp+4] at entry)
 *   85 c0           test %eax,%eax
 *   75 05           jne  +5
 *   32 c0           xor  %al,%al
 *   c2 04 00        ret  $0x4               ; next instruction 0x0047849d
 * The jne is relative, and lands 5 bytes on: in the trampoline that is the
 * jmp back to 0x0047849d, where it lands in the original too. */
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
 * these and jumps back to 0x0047109a. */
static const uint8_t TOALL_ORIG[] = {
    0x51, 0x56, 0x8b, 0xf1, 0x8b, 0x86, 0xd8, 0x01, 0x00, 0x00
};
#define TOALL_LEN sizeof(TOALL_ORIG)

/* The shot and hit sites, found through the retail client (research/
 * w32ded-offsets.md, "Shot and hit functions"). tests/w32_sites.py checks each
 * against the exe: these bytes at the site, whole instructions, and no
 * branch anywhere in .text landing inside the bytes the patch overwrites.
 *
 * FireArms::fireBarrel(IPlayer*, Mat4&, int) 0x00506bf0, thiscall, ret 0xc:
 *   81 ec b8 01 00 00  sub  esp,0x1b8
 * (6 bytes, nothing relative.) */
#define FIRE_SITE 0x00506bf0u
static const uint8_t FIRE_ORIG[] = { 0x81, 0xec, 0xb8, 0x01, 0x00, 0x00 };

/* FireArms::Fire(IPlayer*) 0x005075d0, the tail every round reaches, real or
 * fake: the fakeFire test (0x0050792f, the byte at +0x2c5 that setFakeFire
 * 0x005036e0 writes) jumps here for a fake round, and every fireBarrel call
 * comes back here. Fire keeps `this` in ebp and the IPlayer in ebx for its
 * whole body (0x005075d4, 0x005075db); the launch Mat4 each fireBarrel call
 * is handed is at [esp+0x3c] (`push arg; lea reg,[esp+0x40]`).
 *   8b cd              mov  ecx,ebp
 *   e8 5f be ff ff     call 0x00503930      (relative: re-aimed in the copy)
 * (7 bytes; next instruction 0x00507ad1.) */
#define FAKE_SITE 0x00507acau
static const uint8_t FAKE_ORIG[] = { 0x8b, 0xcd, 0xe8, 0x5f, 0xbe, 0xff, 0xff };
#define FAKE_REL_AT 3

/* BFPlayer::addBulletsGivingDamage(unsigned) 0x004058b0, thiscall, ret 4:
 *   83 ec 10           sub  esp,0x10
 *   53                 push ebx
 *   56                 push esi
 * (5 bytes.) */
#define HIT_SITE 0x004058b0u
static const uint8_t HIT_ORIG[] = { 0x83, 0xec, 0x10, 0x53, 0x56 };

/* GameServer::handleCollisionForProjectile 0x00473b40 (GameServer vtable
 * 0x006e7060 +0x30), thiscall with seven stack arguments, ret 0x1c:
 *   83 ec 28           sub  esp,0x28
 *   53                 push ebx
 *   55                 push ebp
 *   56                 push esi
 * (6 bytes.) Wrapped, as on lnxded: the round read before, the line written
 * after, knowing whether a hit was credited inside. */
#define IMPACT_SITE 0x00473b40u
static const uint8_t IMPACT_ORIG[] = { 0x83, 0xec, 0x28, 0x53, 0x55, 0x56 };

/* GameServer::_giveDamage 0x00475330 at 0x004759eb, mid-function, where the
 * eight sector branches meet (0x0047595b reaches it through 0x004759e9's
 * fstp): the seated player's BFPlayer in esi, the sector byte at
 * [esp+0x14], the strength byte (_ftol's, 0x00475480) at [esp+0x28]; the
 * HitFromPosEvent built at 0x00475a0d reads the same two. The x87 stack is
 * empty on every path in.
 *   8b 0d 34 c5 74 00  mov  ecx,ds:0x0074c534   (playerManager; absolute)
 * (6 bytes.) */
#define HITFROM_SITE 0x004759ebu
static const uint8_t HITFROM_ORIG[] = { 0x8b, 0x0d, 0x34, 0xc5, 0x74, 0x00 };

/* What the stubs call, on the game thread: the core's hook inside a guard.
 * Off, or on a thread of the recorder's own, it does nothing. */
static void event_body(void *ev) { recorder_on_event((uint32_t)(uintptr_t)ev); }
static void queue_body(void *ev) { recorder_on_queue_event((uint32_t)(uintptr_t)ev); }

void w32_hook_event(uint32_t ev)
{
    if (!recorder_core_on() || on_own_thread()) return;
    if (!w32_run_guarded(event_body, (void *)(uintptr_t)ev)) recorder_core_fault("event hook");
}

void w32_hook_queue_event(uint32_t ev)
{
    if (!recorder_core_on() || on_own_thread()) return;
    if (!w32_run_guarded(queue_body, (void *)(uintptr_t)ev)) recorder_core_fault("send-queue hook");
}

extern void recorder_on_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr);
extern void recorder_on_fake_fire(uint32_t fire_arms, uint32_t player, uint32_t mat4_addr);
extern void recorder_on_hit(uint32_t bf, uint32_t tid);
extern void recorder_on_hit_from(uint32_t bf, uint32_t sector, uint32_t strength);
extern void recorder_on_impact_begin(uint32_t proj, uint32_t other, uint32_t contact);
extern void recorder_on_impact_end(void);

/* A hook's arguments, through the guard's one pointer. */
struct w32_args { uint32_t a, b, c; };

static void fire_body(void *p)   { struct w32_args *x = p; recorder_on_fire(x->a, x->b, x->c); }
static void fake_body(void *p)   { struct w32_args *x = p; recorder_on_fake_fire(x->a, x->b, x->c); }
static void hit_body(void *p)    { struct w32_args *x = p; recorder_on_hit(x->a, x->b); }
static void hitfrom_body(void *p){ struct w32_args *x = p; recorder_on_hit_from(x->a, x->b, x->c); }
static void ibegin_body(void *p) { struct w32_args *x = p; recorder_on_impact_begin(x->a, x->b, x->c); }
static void iend_body(void *p)   { (void)p; recorder_on_impact_end(); }

/* The hook bodies, on the game thread, each in a guard. */
static void w32_hook(void (*body)(void *), uint32_t a, uint32_t b, uint32_t c, const char *where)
{
    if (!recorder_core_on() || on_own_thread()) return;
    struct w32_args x = { a, b, c };
    if (!w32_run_guarded(body, &x)) recorder_core_fault(where);
}

void w32_hook_fire(uint32_t fa, uint32_t player, uint32_t mat)
{
    w32_hook(fire_body, fa, player, mat, "fire hook");
}

void w32_hook_fake_fire(uint32_t fa, uint32_t player, uint32_t mat)
{
    w32_hook(fake_body, fa, player, mat, "fake-fire hook");
}

void w32_hook_hit(uint32_t bf, uint32_t tid)
{
    w32_hook(hit_body, bf, tid, 0, "hit hook");
}

void w32_hook_hit_from(uint32_t bf, uint32_t sector, uint32_t strength)
{
    w32_hook(hitfrom_body, bf, sector, strength, "hit-sector hook");
}

void w32_hook_impact_begin(uint32_t proj, uint32_t other, uint32_t contact)
{
    w32_hook(ibegin_body, proj, other, contact, "impact hook");
}

/* The impact's end runs whether or not recording is on now: it closes the
 * nesting count the begin opened, and writes nothing unless a file is open. */
void w32_hook_impact_end(void)
{
    if (on_own_thread()) return;
    if (!w32_run_guarded(iend_body, 0)) recorder_core_fault("impact hook");
}

/* The stubs: entered by a jmp, so the caller's frame is intact -- pusha
 * (32) + pushfl (4) puts entry [esp+0] at [esp+36]. thiscall: [esp+4] at
 * entry is the first stack argument (the event). Every register and the
 * flags go back as they came, then on into the trampoline. */
__asm__(
".text\n"
".globl _recorder_stub_event\n"
"_recorder_stub_event:\n"          /* addEventToSendQueue(ecx=GEM, ev@+4) */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"
"  pushl %eax\n"
"  call  _w32_hook_queue_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_event\n"
".globl _recorder_stub_toall\n"
"_recorder_stub_toall:\n"          /* sendGameEventToAll(ecx=this, ev@+4, bool@+8) */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"
"  pushl %eax\n"
"  call  _w32_hook_event\n"
"  addl  $4, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_toall\n"
".globl _recorder_stub_fire\n"
"_recorder_stub_fire:\n"           /* fireBarrel(ecx=this, player@+4, Mat4*@+8, int@+0xc) */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"         /* the IPlayer */
"  movl  44(%esp), %edx\n"         /* the Mat4 */
"  pushl %edx\n"
"  pushl %eax\n"
"  pushl %ecx\n"                   /* this, the FireArms */
"  call  _w32_hook_fire\n"
"  addl  $12, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_fire\n"
".globl _recorder_stub_fakefire\n"
"_recorder_stub_fakefire:\n"       /* inside Fire: this in ebp, the IPlayer in ebx */
"  pusha\n"
"  pushfl\n"
"  leal  96(%esp), %eax\n"         /* the launch Mat4, [esp+0x3c] at the site */
"  pushl %eax\n"
"  pushl %ebx\n"
"  pushl %ebp\n"
"  call  _w32_hook_fake_fire\n"
"  addl  $12, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_fakefire\n"
".globl _recorder_stub_hit\n"
"_recorder_stub_hit:\n"            /* addBulletsGivingDamage(ecx=BFPlayer, stat id@+4) */
"  pusha\n"
"  pushfl\n"
"  movl  40(%esp), %eax\n"
"  pushl %eax\n"
"  pushl %ecx\n"
"  call  _w32_hook_hit\n"
"  addl  $8, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_hit\n"
".globl _recorder_stub_hitfrom\n"
"_recorder_stub_hitfrom:\n"        /* inside _giveDamage: BFPlayer in esi */
"  pusha\n"
"  pushfl\n"
"  movzbl 76(%esp), %eax\n"        /* strength, [esp+0x28] at the site */
"  movzbl 56(%esp), %edx\n"        /* sector, [esp+0x14] */
"  pushl %eax\n"
"  pushl %edx\n"
"  pushl %esi\n"
"  call  _w32_hook_hit_from\n"
"  addl  $12, %esp\n"
"  popfl\n"
"  popa\n"
"  jmp   *_recorder_tramp_hitfrom\n"
/* handleCollisionForProjectile is wrapped: the caller sees a thiscall that
 * pops its seven arguments, with ebx, esi, edi and ebp kept and eax
 * returned. this is kept at ebp-4; the arguments are at ebp+8 (projectile),
 * +0xc (other), +0x10 (normal), +0x14 (velocity), +0x18 (contact) and the
 * two ints at +0x1c and +0x20. */
".globl _recorder_stub_impact\n"
"_recorder_stub_impact:\n"
"  pushl %ebp\n"
"  movl  %esp, %ebp\n"
"  pushl %ecx\n"
"  pushl 0x18(%ebp)\n"
"  pushl 0x0c(%ebp)\n"
"  pushl 0x08(%ebp)\n"
"  call  _w32_hook_impact_begin\n"
"  addl  $12, %esp\n"
"  pushl 0x20(%ebp)\n"
"  pushl 0x1c(%ebp)\n"
"  pushl 0x18(%ebp)\n"
"  pushl 0x14(%ebp)\n"
"  pushl 0x10(%ebp)\n"
"  pushl 0x0c(%ebp)\n"
"  pushl 0x08(%ebp)\n"
"  movl  -4(%ebp), %ecx\n"
"  call  *_recorder_tramp_impact\n" /* pops its seven */
"  pushl %eax\n"
"  call  _w32_hook_impact_end\n"
"  popl  %eax\n"
"  leave\n"
"  ret   $0x1c\n"
".data\n"
".align 4\n"
".globl _recorder_tramp_event\n"
"_recorder_tramp_event: .long 0\n"
".globl _recorder_tramp_toall\n"
"_recorder_tramp_toall: .long 0\n"
".globl _recorder_tramp_fire\n"
"_recorder_tramp_fire: .long 0\n"
".globl _recorder_tramp_fakefire\n"
"_recorder_tramp_fakefire: .long 0\n"
".globl _recorder_tramp_hit\n"
"_recorder_tramp_hit: .long 0\n"
".globl _recorder_tramp_hitfrom\n"
"_recorder_tramp_hitfrom: .long 0\n"
".globl _recorder_tramp_impact\n"
"_recorder_tramp_impact: .long 0\n"
".text\n"
);

extern char recorder_stub_event, recorder_stub_toall, recorder_stub_fire, recorder_stub_fakefire,
    recorder_stub_hit, recorder_stub_hitfrom, recorder_stub_impact;
extern uint32_t recorder_tramp_event, recorder_tramp_toall, recorder_tramp_fire, recorder_tramp_fakefire,
    recorder_tramp_hit, recorder_tramp_hitfrom, recorder_tramp_impact;
extern volatile int g_hitfrom_hooked;

/* One RWX page holds every trampoline: the copied prologue, then a jmp
 * back to the first unpatched instruction. */
static uint8_t *g_tramp_page;
static size_t g_tramp_used;

/* `rel_at`: where in the copied bytes a call's rel32 starts, or -1. The
 * copy then calls what the original called from the site. */
static int build_trampoline(const uint8_t *orig, size_t len, int rel_at, uintptr_t site,
                            uintptr_t back_to, uintptr_t *out)
{
    if (!g_tramp_page) {
        g_tramp_page = VirtualAlloc(NULL, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
        if (!g_tramp_page) return 0;
    }
    if (g_tramp_used + len + 5 > 4096) return 0;
    if (rel_at >= 0 && (size_t)rel_at + 4 > len) return 0;
    uintptr_t at = (uintptr_t)g_tramp_page + g_tramp_used;
    memcpy((void *)at, orig, len);
    if (rel_at >= 0) {
        int32_t old;
        memcpy(&old, orig + rel_at, 4);
        uintptr_t target = site + (uintptr_t)rel_at + 4 + (uintptr_t)(intptr_t)old;
        int32_t moved = (int32_t)(target - (at + (uintptr_t)rel_at + 4));
        memcpy((void *)(at + (uintptr_t)rel_at), &moved, 4);
    }
    uint8_t jmp[5] = { 0xe9 };
    int32_t rel = (int32_t)(back_to - (at + len + 5));
    memcpy(jmp + 1, &rel, 4);
    memcpy((void *)(at + len), jmp, 5);
    FlushInstructionCache(GetCurrentProcess(), (void *)at, len + 5);
    g_tramp_used += len + 5;
    *out = at;
    return 1;
}

/* Detour `site` to `stub`: only when the site still holds `orig` (any
 * other build or a patched exe is left alone), with the trampoline built
 * and its pointer live before the site's bytes change. 1 when installed. */
static int install_detour(uintptr_t site, const uint8_t *orig, size_t len, int rel_at,
                          void *stub, uint32_t *tramp_out)
{
    uint8_t have[32], patch[32];
    if (len < 5 || len > sizeof(have)) return 0;
    if (!w32_safe_read(have, len, site) || memcmp(have, orig, len) != 0) {
        fprintf(stderr, "recorder: %08lx is not the expected code, detour skipped\n",
                (unsigned long)site);
        return 0;
    }
    uintptr_t tramp = 0;
    if (!build_trampoline(orig, len, rel_at, site, site + len, &tramp)) {
        fprintf(stderr, "recorder: trampoline for %08lx failed\n", (unsigned long)site);
        return 0;
    }
    *tramp_out = (uint32_t)tramp;
    patch[0] = 0xe9;
    int32_t rel = (int32_t)((uintptr_t)stub - (site + 5));
    memcpy(patch + 1, &rel, 4);
    for (size_t i = 5; i < len; i++) patch[i] = 0x90;
    if (!w32_patch_write(site, patch, len)) {
        fprintf(stderr, "recorder: patch at %08lx failed\n", (unsigned long)site);
        return 0;
    }
    fprintf(stderr, "recorder: detour at %08lx\n", (unsigned long)site);
    return 1;
}

/* The detours, as lnxded's: the two event sites, the shots, and the hits
 * and impacts as recorder.con asks. Called from DllMain, before the
 * server's own code has run: nothing executes the sites while they change. */
static int w32_install_detours(void)
{
    g_hook_active = 1;
    install_detour(AETSQ_SITE, AETSQ_ORIG, AETSQ_LEN, -1, &recorder_stub_event, &recorder_tramp_event);
    install_detour(TOALL_SITE, TOALL_ORIG, TOALL_LEN, -1, &recorder_stub_toall, &recorder_tramp_toall);
    install_detour(FIRE_SITE, FIRE_ORIG, sizeof(FIRE_ORIG), -1, &recorder_stub_fire, &recorder_tramp_fire);
    install_detour(FAKE_SITE, FAKE_ORIG, sizeof(FAKE_ORIG), FAKE_REL_AT,
                   &recorder_stub_fakefire, &recorder_tramp_fakefire);
    /* The hit detour also feeds the impacts' dmg, so it goes in when either
     * record is on. */
    if (g_rec_hits || g_rec_impacts)
        install_detour(HIT_SITE, HIT_ORIG, sizeof(HIT_ORIG), -1, &recorder_stub_hit, &recorder_tramp_hit);
    if (g_rec_impacts)
        install_detour(IMPACT_SITE, IMPACT_ORIG, sizeof(IMPACT_ORIG), -1,
                       &recorder_stub_impact, &recorder_tramp_impact);
    /* Every player's hit direction, bots' too; the queue's copies (one
     * connection's, no player named) stop once it is in. */
    if (install_detour(HITFROM_SITE, HITFROM_ORIG, sizeof(HITFROM_ORIG), -1,
                       &recorder_stub_hitfrom, &recorder_tramp_hitfrom))
        g_hitfrom_hooked = 1;
    return 1;
}

/* ------------------------------------------------------------------ */
/* the target table (research/w32ded-offsets.md)                       */
/* ------------------------------------------------------------------ */

const struct rec_target w32ded_target = {
    .name = "w32ded",
    .code_lo = 0x00401000u,             /* .text, 0x2d77d0 bytes */
    .code_hi = 0x006d87d0u,
    .header_plus = "server-replay-recorder-w32ded",
    .header_version = 5,

    .object_manager_ptr = 0x0074c52cu,  /* dice::ref2::world::objectManager */
    .player_manager_ptr = 0x0074c534u,  /* dice::ref2::world::playerManager */
    .template_manager_ptr = 0x0074c530u,/* dice::ref2::world::objectTemplateManager */
    /* lnxded's id map at +8, as an MSVC map: its allocator word, then
     * _Myhead and _Mysize (the registered-objects map's shape, om+0xa0). */
    .tmgr_id_map_off = 0x0cu,
    .setup_ptr = 0x00747278u,           /* dice::bf::setup: EventLogger::beginRound's "map" setting (0x00407b32) */
    .score_manager_ptr = 0x00749c70u,   /* the "Tickets: Axis" printer's global */
    /* vtables: MSVC vptr = the vtable itself. */
    .vt_rot_bundle = 0u,
    .vt_engine = 0u,
    .vt_soldier = 0u,
    .vt_phys_engine = 0u,
    .vt_score_manager = 0x006e8858u,    /* ScoreManager ctor 0x00466930 */

    /* The MSVC registered-objects tree at om+0xa0: om+0xa4 _Myhead
     * (sentinel), om+0xa8 _Mysize. */
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
    .obj_tmpl_off = 0x4cu,              /* BObject ctor 0x004d0220 */
    .obj_mat_off = 0x74u,               /* Mat4: rows a,b,c then position */
    .tmpl_id_off = 0x40u,               /* ObjectTemplate::getId (vt+0x1c) is `mov eax,[ecx+0x40]` in all 46
                                         * template vtables whose getName is +8; 0x34 read the name's bytes */

    /* stage 3 (research/w32ded-offsets.md pass 4) */
    .obj_parent_off = 0x50u,            /* BObject ctor zeroes +0x50/+0x54 */
    .obj_compmap_off = 0xe0u,           /* candidate: ctor zeroes +0xe0..+0xe8 */
    .armor_iid = 0xc4a4u,               /* the queryComponent key (0x004044cb) */
    .armor_hp_off = 0x38u,              /* Armor ctor 0x0047f9f0 */
    .armor_maxhp_off = 0x3cu,
    .armor_crit_off = 0xf0u,            /* carried over from lnxded */
    .armor_lasthit_off = 0x14u,
    .eng_pe_off = 0x60u,
    .pe_revs_off = 0xa0u,
    .pe_gear_off = 0xbcu,
    .eng_flags_off = 0x142u,
    .eng_throttle_off = 0x124u,
    .sol_lower_off = 0x2b4u,            /* carried over from lnxded; unverified */
    .sol_upper_off = 0x2f8u,
    .sol_item_off = 0x3b8u,
    .sol_bits_off = 0x3e6u,
    .pm_list_off = 0x10u,               /* sentinel node pointer (ctor 0x005342f0) */
    .pl_node_player_off = 8u,           /* node {next+0, prev+4, BFPlayer*+8} */
    .pm_sentinel_indirect = 1,          /* walk starts at *(pm+0x10) */
    /* BFPlayer, vtable 0x006d9f08. The lnxded createPlayer builder
     * (0x0812d080) beside this one (0x004787e0) names each field: +0xc is
     * the network id, not the player id; getId (vt+0x44, 0x00405bf0) reads
     * +0x70; getIsAIPlayer (vt+0x58, 0x00405c20) the byte at +0xa8; the
     * event's vehicle id comes from +0x98, its camera's from +0xa4. */
    .bf_id_off = 0x70u,
    .bf_name_off = 0u,                  /* a Dinkumware string at +0x44: read_player_name */
    .bf_ai_off = 0xa8u,
    .bf_team_off = 0xacu,               /* createPlayer: ev team = BFPlayer+0xac */
    .bf_veh_off = 0x98u,                /* the controlled object (ev+0x32) */
    .bf_cam_off = 0xa4u,                /* the free camera (ev+0x34) */
    .kit_class_id = 0x9493u,
    .kit_getkit_slot = 0x100u,          /* soldier vt+0x100 = getKit */
    .om_get_slot1 = 0x20u,
    .om_get_slot2 = 0x24u,
    .score_base_off = 0x60u,            /* ScoreManager ctor: team array */
    .score_stride_off = 0x50u,
    .score_tickets_off = 0x48u,         /* the "Tickets: Axis" row */
    .setup_level_off = 0x488u,          /* Setup::getCurrentLevel 0x0042d210: lea eax,[ecx+0x488] */
    .setup_gpm_off = 0x4a4u,            /* the gpm beside the level's name, a 0x1c-byte string here */
    /* Shots, hits and flights (research/w32ded-offsets.md, "Shot and hit
     * functions"); tests/w32_sites.py checks each against the instruction
     * it was read from. */
    .fa_fake_off = 0x2c5u,              /* setFakeFire 0x005036e0 writes it; Fire tests it at 0x0050792f */
    .proj_owner_off = 0x120u,           /* fireBarrel 0x005072a0: IPlayer::getId (vt+0x44) */
    .proj_origin_off = 0x14cu,          /* fireBarrel 0x005072be: the barrel position */
    .proj_stat_off = 0x158u,            /* fireBarrel 0x00507311: the stat id */
    .proj_pos_slot = 0x34u,             /* getAbsolutePosition; handleCollisionForProjectile 0x00473c16 */
    .vt_projectile = 0x00702b28u,       /* Projectile ctor 0x004f7d03; its own +0x50/+0x54 are handleUpdate/handleCollision */
    .vt_fire_arms = 0x00704b48u,        /* FireArms ctor 0x00506670 */
    .vt_hand_fire_arms = 0x00704e98u,   /* HandFireArms ctor, after FireArms' at 0x00509499 */
    .fa_proj_tmpl_off = 0x1b4u,         /* fireBarrel 0x00506bfa */
    .fa_pool_off = 0x204u,              /* initProjectilePool 0x00505830: push_back into the vector at +0x200, begin +4 */
    .fa_pool_count_off = 0x210u,        /* initProjectilePool 0x00505a3a */
    .get_bf_player_addr = (uint32_t)w32_get_bf_player,
    .get_root_parent_addr = (uint32_t)w32_root_parent,

    .walk_clamp_count = 1,
    .sample_reset_next = 1,

    .safe_read = w32_safe_read,
    .patch_write = w32_patch_write,
    .now_s = w32_now_s,
    .net_id_of = w32_net_id_of,
    .read_string = w32_read_string,
    .read_player_name = w32_read_player_name,
    .read_player_ai = 0,
    .vt_call_ok = w32_vt_call_ok,
    .read_template_name = w32_read_template_name,
    .tree_successor = w32_tree_successor,
    .make_replays_dir = w32_make_replays_dir,
    .rec_lock = w32_lock,
    .rec_unlock = w32_unlock,
    .rec_sleep = w32_sleep,
    .rec_trylock = w32_trylock,
    .run_guarded = w32_run_guarded,
    .install_detours = w32_install_detours,
    .start_sampler_thread = w32_start_thread,
};

/* ------------------------------------------------------------------ */

/* Attach runs as the loader resolves the exe's WINMM import, before the
 * server's entry point. It always returns TRUE: a dll that fails here stops
 * the server from starting. Anything missing turns the recorder off and
 * leaves a plain winmm proxy. */
BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved)
{
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(inst);
        /* No console on a service host; the log is a file, or nowhere. */
        if (!freopen("recorder.log", "w", stderr)) freopen("NUL", "w", stderr);
        setvbuf(stderr, NULL, _IONBF, 0);
        if (!exe_is_known()) return TRUE;
        {
            const uint8_t *me = (const uint8_t *)inst;
            const IMAGE_NT_HEADERS32 *nt =
                (const IMAGE_NT_HEADERS32 *)(me + ((const IMAGE_DOS_HEADER *)me)->e_lfanew);
            g_self_lo = (uintptr_t)me;
            g_self_hi = g_self_lo + nt->OptionalHeader.SizeOfImage;
        }
        g_tls = TlsAlloc();
        if (g_tls == TLS_OUT_OF_INDEXES || !AddVectoredExceptionHandler(1, w32_veh)) {
            fprintf(stderr, "recorder: no fault handler, the recorder stays off\n");
            return TRUE;
        }
        InitializeCriticalSection(&g_rec_cs);
        recorder_core_init(&w32ded_target);
    } else if (reason == DLL_PROCESS_DETACH) {
        /* A process exit (reserved non-NULL) has already killed the other
         * threads; the core only try-locks then. */
        (void)reserved;
        if (g_tls != TLS_OUT_OF_INDEXES && T) recorder_core_shutdown();
    }
    return TRUE;
}
