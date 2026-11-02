/*
 * The Windows recorder's fault handling, under Wine (run.sh builds it with
 * mingw-w64 when both are on the path). It includes target_w32ded.c whole and
 * drives its copy, guard and handler directly; this exe stands in for the
 * server, so its own image plays the server's code range.
 *
 *   copy        a read of unmapped memory fails; a readable one succeeds
 *   guardpage   a read of a guard page fails, and the page is a guard page
 *               again afterwards (another thread's stack can still grow)
 *   ownfault    a fault in the recorder's own code ends the pass, returns 0,
 *               and the write lock it held is free again
 *   nested      a fault in an inner guard returns to the inner one only
 *   x87         the x87 stack a cut-short pass left values on is empty again
 *   clean       a pass that does not fault returns 1
 *
 * Child modes, run as separate processes because they must end the process
 * the way the server would end without the recorder:
 *   crash-outside   a fault outside any guard is not swallowed
 *   crash-libc      a fault inside msvcrt inside a guard is not swallowed (it
 *                   may hold the CRT's locks; recovering would hang the
 *                   server at its next malloc)
 */

#include "../src/target_w32ded.c"

static int fails;
#define CHECK(c, what) do { if (c) printf("ok   %s\n", what); \
                            else { printf("FAIL %s\n", what); fails++; } } while (0)

static volatile int *g_bad = (volatile int *)0x10;

static void fault_plain(void *a) { (void)a; *g_bad = 1; }

static void fault_with_lock(void *a)
{
    (void)a;
    w32_lock();
    w32_lock();   /* taken twice: both must be released */
    *g_bad = 1;
}

static int g_inner_ret = -1, g_after_inner;
static void inner_then_continue(void *a)
{
    (void)a;
    g_inner_ret = w32_run_guarded(fault_plain, 0);
    g_after_inner = 1;   /* the outer pass carries on */
}

static void x87_fault(void *a)
{
    (void)a;
    __asm__ volatile("fld1\n fld1\n fld1\n" ::: "memory");
    *g_bad = 1;
}

static void libc_fault(void *a)
{
    (void)a;
    /* Through a pointer, so the fault is in msvcrt's strlen, not an inlined
     * copy in this image. */
    size_t (*volatile sl)(const char *) = strlen;
    volatile size_t n = sl((const char *)(uintptr_t)0x10);
    (void)n;
}

static int g_clean_ran;
static void clean(void *a) { (void)a; g_clean_ran = 1; }

static DWORD WINAPI try_lock_thread(LPVOID out)
{
    *(int *)out = TryEnterCriticalSection(&g_rec_cs);
    if (*(int *)out) LeaveCriticalSection(&g_rec_cs);
    return 0;
}

static void setup(void)
{
    /* As DllMain would on the server: this exe is both "the server's code"
     * and "the recorder's", the handler and the guard's TLS slot. */
    const uint8_t *me = (const uint8_t *)GetModuleHandleA(NULL);
    const IMAGE_NT_HEADERS32 *nt =
        (const IMAGE_NT_HEADERS32 *)(me + ((const IMAGE_DOS_HEADER *)me)->e_lfanew);
    g_self_lo = (uintptr_t)me;
    g_self_hi = g_self_lo + nt->OptionalHeader.SizeOfImage;
    g_tls = TlsAlloc();
    AddVectoredExceptionHandler(1, w32_veh);
    InitializeCriticalSection(&g_rec_cs);
}

int main(int argc, char **argv)
{
    setvbuf(stdout, NULL, _IONBF, 0);
    /* The child modes end in a crash on purpose: no crash dialog for it
     * (Wine starts its debugger's window otherwise). */
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    setup();
    if (argc > 1 && !strcmp(argv[1], "crash-outside")) {
        *g_bad = 1;
        printf("survived\n");
        return 0;
    }
    if (argc > 1 && !strcmp(argv[1], "crash-libc")) {
        w32_run_guarded(libc_fault, 0);
        printf("survived\n");
        return 0;
    }

    char buf[16];
    int v = 42;
    CHECK(w32_safe_read(buf, 4, 0x1000) == 0, "copy: low address refused");
    CHECK(w32_copy(buf, (const void *)0x10, 4) == 0, "copy: unmapped read fails");
    CHECK(w32_safe_read(buf, 4, (uintptr_t)&v) == 1 && *(int *)buf == 42, "copy: readable read succeeds");
    {
        uint8_t *page = VirtualAlloc(NULL, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE | PAGE_GUARD);
        CHECK(page && w32_safe_read(buf, 4, (uintptr_t)page) == 0, "guardpage: read fails");
        MEMORY_BASIC_INFORMATION mbi;
        VirtualQuery(page, &mbi, sizeof(mbi));
        CHECK((mbi.Protect & PAGE_GUARD) != 0, "guardpage: still a guard page afterwards");
    }
    CHECK(w32_run_guarded(fault_plain, 0) == 0, "ownfault: the pass returns 0");
    CHECK(w32_run_guarded(fault_with_lock, 0) == 0, "ownfault: with the lock held, returns 0");
    {
        int got = 0;
        HANDLE th = CreateThread(NULL, 0, try_lock_thread, &got, 0, NULL);
        WaitForSingleObject(th, 5000);
        CloseHandle(th);
        CHECK(got == 1, "ownfault: the write lock is free again");
    }
    CHECK(w32_run_guarded(inner_then_continue, 0) == 1 && g_inner_ret == 0 && g_after_inner,
          "nested: the inner fault returns to the inner guard");
    {
        CHECK(w32_run_guarded(x87_fault, 0) == 0, "x87: the pass returns 0");
        uint16_t sw = 0, tw = 0;
        uint8_t env[28];
        __asm__ volatile("fnstsw %0" : "=m"(sw));
        __asm__ volatile("fnstenv %0\n fldenv %0" : "=m"(env));
        memcpy(&tw, env + 8, 2);
        CHECK(tw == 0xffff, "x87: the stack is empty again");
        volatile double d = 1.5;
        d = d * 2.0;
        CHECK(d == 3.0, "x87: arithmetic still right");
    }
    CHECK(w32_run_guarded(clean, 0) == 1 && g_clean_ran, "clean: a pass without a fault returns 1");
    /* A guard's TLS slot is restored after each pass. */
    CHECK(TlsGetValue(g_tls) == NULL, "tls: no guard left behind");
    printf(fails ? "w32 guard: %d failed\n" : "w32 guard: all passed\n", fails);
    return fails ? 1 : 0;
}
