/*
 * realfire.so -- a lab-only LD_PRELOAD for bf1942_lnxded that makes every
 * bot's shot a real one.
 *
 * A bot shooting a bot that no human is near fires *fake*: FireArms::Fire
 * (0x0828a090) tests the fakeFire byte (+0x295) at 0x0828a217 and, set,
 * skips fireBarrel, so no projectile is made and the AI rolls the hit
 * (ledger AI-134). On a bots-only server that is nearly every ground
 * weapon's every shot: a 12-minute Desert Combat El Alamein round recorded
 * 156 T-72 shots and one T-72 shell in flight. The server recorder can only
 * measure a round that exists, so for the projectile laws (launch speed,
 * gravity, a rocket's motor) the lab runs some rounds with this loaded.
 *
 * FireArms::setFakeFire (0x0828e310) is the only writer of the byte (AI-134;
 * FireArmsBundle::setFakeFire 0x08290e90 calls it on each child through the
 * vtable). Its `mov eax,[ebp+0xc]` (the bool argument) becomes `xor eax,eax;
 * nop`, so it always stores 0. Nothing else changes: the round is the
 * engine's own projectile with the engine's own physics. What does change is
 * the game -- hits land by flight, not by the AI's dice -- so a round played
 * with this is ground truth for how rounds fly, not for how a bot round goes.
 *
 * The bytes are checked before the patch; on any other binary it does
 * nothing. Build: ./build.sh (gcc -m32).
 */
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#define SET_FAKE_FIRE 0x0828e310u

/* push ebp; mov ebp,esp; mov edx,[ebp+8]; mov eax,[ebp+0xc]; mov [edx+0x295],al */
static const unsigned char expect[] = {
    0x55, 0x89, 0xe5, 0x8b, 0x55, 0x08, 0x8b, 0x45, 0x0c, 0x88, 0x82, 0x95, 0x02, 0x00, 0x00,
};
static const unsigned char patch[] = { 0x31, 0xc0, 0x90 };   /* xor eax,eax; nop */

__attribute__((constructor)) static void realfire_init(void)
{
    unsigned char have[sizeof(expect)];
    /* Read through /proc/self/mem: on a binary that maps nothing there this
     * fails instead of faulting. */
    int fd = open("/proc/self/mem", O_RDONLY);
    if (fd < 0 || pread(fd, have, sizeof(have), (off_t)SET_FAKE_FIRE) != (ssize_t)sizeof(have)) {
        if (fd >= 0) close(fd);
        fprintf(stderr, "realfire: no FireArms::setFakeFire at %#x; nothing patched\n", SET_FAKE_FIRE);
        return;
    }
    close(fd);
    if (memcmp(have, expect, sizeof(expect))) {
        fprintf(stderr, "realfire: FireArms::setFakeFire's bytes differ (another binary?); nothing patched\n");
        return;
    }
    long pg = sysconf(_SC_PAGESIZE);
    uintptr_t at = SET_FAKE_FIRE + 6;
    uintptr_t base = at & ~(uintptr_t)(pg - 1);
    if (mprotect((void *)base, (size_t)pg * 2, PROT_READ | PROT_WRITE | PROT_EXEC)) {
        perror("realfire: mprotect");
        return;
    }
    memcpy((void *)at, patch, sizeof(patch));
    mprotect((void *)base, (size_t)pg * 2, PROT_READ | PROT_EXEC);
    fprintf(stderr, "realfire: FireArms::setFakeFire now stores 0: every shot is real\n");
}
