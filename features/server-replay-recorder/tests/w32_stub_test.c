/*
 * The Windows recorder's shot and hit stubs, under Wine (run.sh builds it
 * with mingw-w64 when both are on the path). It includes target_w32ded.c
 * whole, with the core's hook entries renamed to the sinks below, and runs
 * each stub the way the exe enters it:
 *
 *   fire      fireBarrel's entry, a thiscall: the hook gets this, the IPlayer
 *             and the Mat4, and the original gets ecx and its three
 *             arguments as they came
 *   hit       addBulletsGivingDamage's entry: this and the stat id
 *   impact    handleCollisionForProjectile, wrapped: begin gets the round,
 *             the other object and the contact; the original gets ecx and
 *             all seven; end runs after it; the caller gets eax back and its
 *             seven arguments popped
 *   fakefire  Fire's tail, mid-function: this from ebp, the IPlayer from
 *             ebx, the Mat4 at [esp+0x3c]; every register and esp reach the
 *             trampoline as they came
 *   hitfrom   _giveDamage's sector site: the BFPlayer from esi, the sector
 *             byte at [esp+0x14] and the strength at [esp+0x28]; the same
 *   reaim     a trampoline copied from FAKE_ORIG calls what the site called
 *             and jumps back to the byte after the site
 *   off       with recording off, the stubs still reach the original, and
 *             no hook runs
 */

#define recorder_on_fire test_on_fire
#define recorder_on_fake_fire test_on_fake_fire
#define recorder_on_hit test_on_hit
#define recorder_on_hit_from test_on_hit_from
#define recorder_on_impact_begin test_on_impact_begin
#define recorder_on_impact_end test_on_impact_end
#define recorder_core_on test_core_on
#include "../src/target_w32ded.c"

static int fails;
#define CHECK(c, what) do { if (c) printf("ok   %s\n", what); \
                            else { printf("FAIL %s\n", what); fails++; } } while (0)

static int g_on = 1;
int test_core_on(void) { return g_on; }

/* What the hooks were handed, and how many times each ran. */
static uint32_t hook[3];
static int hook_calls, end_calls;
void test_on_fire(uint32_t a, uint32_t b, uint32_t c) { hook[0] = a; hook[1] = b; hook[2] = c; hook_calls++; }
void test_on_fake_fire(uint32_t a, uint32_t b, uint32_t c) { hook[0] = a; hook[1] = b; hook[2] = c; hook_calls++; }
void test_on_hit(uint32_t a, uint32_t b) { hook[0] = a; hook[1] = b; hook_calls++; }
void test_on_hit_from(uint32_t a, uint32_t b, uint32_t c) { hook[0] = a; hook[1] = b; hook[2] = c; hook_calls++; }
void test_on_impact_begin(uint32_t a, uint32_t b, uint32_t c) { hook[0] = a; hook[1] = b; hook[2] = c; hook_calls++; }
static int orig_ran_before_end;
static int impact_orig_calls;
void test_on_impact_end(void) { end_calls++; orig_ran_before_end = impact_orig_calls; }

/* The originals the trampolines stand in for. */
static uint32_t orig[9];
#define THISCALL __attribute__((thiscall))
static void THISCALL orig_fire(uint32_t self, uint32_t player, uint32_t mat, uint32_t idx)
{ orig[0] = self; orig[1] = player; orig[2] = mat; orig[3] = idx; }
static void THISCALL orig_hit(uint32_t self, uint32_t tid) { orig[0] = self; orig[1] = tid; }
static uint32_t THISCALL orig_impact(uint32_t self, uint32_t a, uint32_t b, uint32_t c, uint32_t d,
                                     uint32_t e, uint32_t f, uint32_t g)
{
    orig[0] = self; orig[1] = a; orig[2] = b; orig[3] = c; orig[4] = d;
    orig[5] = e; orig[6] = f; orig[7] = g;
    impact_orig_calls++;
    return 0x1234;
}

typedef void (THISCALL *fire_fn)(uint32_t, uint32_t, uint32_t, uint32_t);
typedef void (THISCALL *hit_fn)(uint32_t, uint32_t);
typedef uint32_t (THISCALL *impact_fn)(uint32_t, uint32_t, uint32_t, uint32_t, uint32_t,
                                       uint32_t, uint32_t, uint32_t);

/* The two mid-function sites. Each frame function sets the registers the
 * exe has there, makes room for the site's stack (esp kept in site_esp),
 * fills the bytes the stub reads, and jumps into the stub; the trampoline
 * is the `_back` label, which notes every register and esp and unwinds.
 *   uint32_t fake_frame(this, player)        -> ebp, ebx
 *   uint32_t hitfrom_frame(bf, sector, str)  -> esi, [esp+0x14], [esp+0x28] */
uint32_t site_esp, back_esp, back_regs[7];
extern uint32_t fake_frame(uint32_t self, uint32_t player);
extern uint32_t hitfrom_frame(uint32_t bf, uint32_t sector, uint32_t strength);
extern char fake_back, hitfrom_back;
__asm__(
".text\n"
".globl _fake_frame\n"
"_fake_frame:\n"
"  pushl %ebp\n  pushl %ebx\n  pushl %esi\n  pushl %edi\n"
"  movl  20(%esp), %ebp\n"
"  movl  24(%esp), %ebx\n"
"  subl  $0x80, %esp\n"
"  movl  %esp, _site_esp\n"
"  movl  $0x11111111, %esi\n  movl $0x22222222, %edi\n"
"  movl  $0x33333333, %eax\n  movl $0x44444444, %ecx\n  movl $0x55555555, %edx\n"
"  jmp   _recorder_stub_fakefire\n"
".globl _fake_back\n"
"_fake_back:\n"
"  movl  %esp, _back_esp\n"
"  movl  %eax, _back_regs\n  movl %ecx, _back_regs+4\n  movl %edx, _back_regs+8\n"
"  movl  %ebx, _back_regs+12\n  movl %ebp, _back_regs+16\n  movl %esi, _back_regs+20\n"
"  movl  %edi, _back_regs+24\n"
"  addl  $0x80, %esp\n"
"  popl  %edi\n  popl %esi\n  popl %ebx\n  popl %ebp\n"
"  ret\n"
".globl _hitfrom_frame\n"
"_hitfrom_frame:\n"
"  pushl %ebp\n  pushl %ebx\n  pushl %esi\n  pushl %edi\n"
"  movl  20(%esp), %esi\n"
"  movl  24(%esp), %eax\n"
"  movl  28(%esp), %edx\n"
"  subl  $0x80, %esp\n"
"  movl  $0xffffffff, 0x14(%esp)\n"   /* the byte's neighbours set: only the byte is read */
"  movl  $0xffffffff, 0x28(%esp)\n"
"  movb  %al, 0x14(%esp)\n"
"  movb  %dl, 0x28(%esp)\n"
"  movl  %esp, _site_esp\n"
"  movl  $0x66666666, %ebx\n  movl $0x77777777, %ebp\n  movl $0x22222222, %edi\n"
"  movl  $0x33333333, %eax\n  movl $0x44444444, %ecx\n  movl $0x55555555, %edx\n"
"  jmp   _recorder_stub_hitfrom\n"
".globl _hitfrom_back\n"
"_hitfrom_back:\n"
"  movl  %esp, _back_esp\n"
"  movl  %eax, _back_regs\n  movl %ecx, _back_regs+4\n  movl %edx, _back_regs+8\n"
"  movl  %ebx, _back_regs+12\n  movl %ebp, _back_regs+16\n  movl %esi, _back_regs+20\n"
"  movl  %edi, _back_regs+24\n"
"  addl  $0x80, %esp\n"
"  popl  %edi\n  popl %esi\n  popl %ebx\n  popl %ebp\n"
"  ret\n"
);

/* The re-aimed call: a site whose bytes are FAKE_ORIG's shape, calling
 * reaim_target; the trampoline built from it, run, calls the target and
 * jumps on to reaim_after. */
static int reaim_hit;
static void THISCALL reaim_target(void) { reaim_hit++; }
extern void reaim_run(uint32_t tramp);
extern char reaim_after;
uint32_t reaim_ebp;
__asm__(
".text\n"
".globl _reaim_run\n"
"_reaim_run:\n"
"  pushl %ebp\n"
"  movl  8(%esp), %eax\n"
"  movl  _reaim_ebp, %ebp\n"
"  jmp   *%eax\n"
".globl _reaim_after\n"
"_reaim_after:\n"
"  popl  %ebp\n"
"  ret\n"
);

static void setup(void)
{
    const uint8_t *me = (const uint8_t *)GetModuleHandleA(NULL);
    const IMAGE_NT_HEADERS32 *nt =
        (const IMAGE_NT_HEADERS32 *)(me + ((const IMAGE_DOS_HEADER *)me)->e_lfanew);
    g_self_lo = (uintptr_t)me;
    g_self_hi = g_self_lo + nt->OptionalHeader.SizeOfImage;
    g_tls = TlsAlloc();
    AddVectoredExceptionHandler(1, w32_veh);
    InitializeCriticalSection(&g_rec_cs);
}

static void reset(void)
{
    memset(hook, 0, sizeof hook);
    memset(orig, 0, sizeof orig);
    hook_calls = end_calls = 0;
}

static void test_fire(void)
{
    reset();
    recorder_tramp_fire = (uint32_t)(uintptr_t)orig_fire;
    ((fire_fn)(uintptr_t)&recorder_stub_fire)(0xfa000, 0xb0000, 0xa7000, 2);
    CHECK(hook_calls == 1 && hook[0] == 0xfa000 && hook[1] == 0xb0000 && hook[2] == 0xa7000,
          "fire: the hook gets this, the IPlayer and the Mat4");
    CHECK(orig[0] == 0xfa000 && orig[1] == 0xb0000 && orig[2] == 0xa7000 && orig[3] == 2,
          "fire: fireBarrel gets ecx and its three arguments");
}

static void test_hit(void)
{
    reset();
    recorder_tramp_hit = (uint32_t)(uintptr_t)orig_hit;
    ((hit_fn)(uintptr_t)&recorder_stub_hit)(0xbf000, 0x4d2);
    CHECK(hook_calls == 1 && hook[0] == 0xbf000 && hook[1] == 0x4d2, "hit: the hook gets this and the stat id");
    CHECK(orig[0] == 0xbf000 && orig[1] == 0x4d2, "hit: addBulletsGivingDamage gets ecx and the stat id");
}

static void test_impact(void)
{
    reset();
    impact_orig_calls = 0;
    recorder_tramp_impact = (uint32_t)(uintptr_t)orig_impact;
    uint32_t r = ((impact_fn)(uintptr_t)&recorder_stub_impact)(0x65000, 0x11, 0x22, 0x33, 0x44, 0x55, 6, 7);
    CHECK(hook[0] == 0x11 && hook[1] == 0x22 && hook[2] == 0x55,
          "impact: begin gets the round, the other object and the contact");
    uint32_t want[8] = { 0x65000, 0x11, 0x22, 0x33, 0x44, 0x55, 6, 7 };
    CHECK(memcmp(orig, want, sizeof want) == 0, "impact: the original gets ecx and all seven arguments");
    CHECK(end_calls == 1 && orig_ran_before_end == 1, "impact: end runs once, after the original");
    CHECK(r == 0x1234, "impact: the caller gets the original's eax");
    /* A thiscall's caller does not pop: had the stub left the seven on the
     * stack, this second call (and the function's return) would see a
     * shifted esp; gcc's frame would make the test crash or misread. */
    reset();
    r = ((impact_fn)(uintptr_t)&recorder_stub_impact)(0x66000, 1, 2, 3, 4, 5, 6, 7);
    CHECK(r == 0x1234 && orig[0] == 0x66000 && orig[7] == 7, "impact: a second call after the first pops its own");
}

static int regs_kept(uint32_t a, uint32_t c, uint32_t d, uint32_t b, uint32_t bp, uint32_t si, uint32_t di)
{
    return back_regs[0] == a && back_regs[1] == c && back_regs[2] == d && back_regs[3] == b &&
           back_regs[4] == bp && back_regs[5] == si && back_regs[6] == di;
}

static void test_fakefire(void)
{
    reset();
    recorder_tramp_fakefire = (uint32_t)(uintptr_t)&fake_back;
    fake_frame(0xfa100, 0xb0100);
    CHECK(hook_calls == 1 && hook[0] == 0xfa100 && hook[1] == 0xb0100 && hook[2] == site_esp + 0x3c,
          "fakefire: this from ebp, the IPlayer from ebx, the Mat4 at [esp+0x3c]");
    CHECK(back_esp == site_esp && regs_kept(0x33333333, 0x44444444, 0x55555555, 0xb0100, 0xfa100,
                                            0x11111111, 0x22222222),
          "fakefire: every register and esp reach the trampoline as they came");
}

static void test_hitfrom(void)
{
    reset();
    recorder_tramp_hitfrom = (uint32_t)(uintptr_t)&hitfrom_back;
    hitfrom_frame(0xbf200, 5, 191);
    CHECK(hook_calls == 1 && hook[0] == 0xbf200 && hook[1] == 5 && hook[2] == 191,
          "hitfrom: the BFPlayer from esi, the sector byte at [esp+0x14], the strength at [esp+0x28]");
    CHECK(back_esp == site_esp && regs_kept(0x33333333, 0x44444444, 0x55555555, 0x66666666, 0x77777777,
                                            0xbf200, 0x22222222),
          "hitfrom: every register and esp reach the trampoline as they came");
}

static void test_reaim(void)
{
    /* A copy of the site's bytes somewhere else, its call re-pointed at
     * reaim_target: what the exe's would be relative to 0x00507acc. */
    uint8_t *site = VirtualAlloc(NULL, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    memcpy(site, FAKE_ORIG, sizeof FAKE_ORIG);
    int32_t rel = (int32_t)((uintptr_t)reaim_target - ((uintptr_t)site + FAKE_REL_AT + 4));
    memcpy(site + FAKE_REL_AT, &rel, 4);
    uintptr_t tramp = 0;
    int ok = build_trampoline(site, sizeof FAKE_ORIG, FAKE_REL_AT, (uintptr_t)site,
                              (uintptr_t)&reaim_after, &tramp);
    reaim_hit = 0;
    if (ok) reaim_run((uint32_t)tramp);
    CHECK(ok && reaim_hit == 1, "reaim: the trampoline's copy calls what the site called, then jumps back");
    CHECK(ok && *(uint8_t *)tramp == 0x8b && *(uint8_t *)(tramp + 1) == 0xcd,
          "reaim: the bytes before the call are copied as they were");
}

static void test_off(void)
{
    g_on = 0;
    reset();
    recorder_tramp_fire = (uint32_t)(uintptr_t)orig_fire;
    ((fire_fn)(uintptr_t)&recorder_stub_fire)(0xfa300, 0xb0300, 0xa7300, 0);
    recorder_tramp_hit = (uint32_t)(uintptr_t)orig_hit;
    ((hit_fn)(uintptr_t)&recorder_stub_hit)(0xbf300, 9);
    CHECK(hook_calls == 0 && orig[0] == 0xbf300, "off: no hook runs, the originals still do");
    g_on = 1;
}

int main(void)
{
    setup();
    test_fire();
    test_hit();
    test_impact();
    test_fakefire();
    test_hitfrom();
    test_reaim();
    test_off();
    printf(fails ? "%d FAILED\n" : "all passed\n", fails);
    return fails != 0;
}
