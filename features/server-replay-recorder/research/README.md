# Research

How the recorder came to be what the [README](../README.md) describes: the
dated notes, measurements and reviews, kept as they were written. Where one
of these disagrees with the README or the source, the README and the source
are right.

| file | what it answers |
|---|---|
| [01-poc-and-stage-3.md](01-poc-and-stage-3.md) | The first recorder, a sampler thread reading through `/proc/self/mem`: the layout it read, what its first runs showed, the first detours, an adversarial review, the hand-off. |
| [02-windows-port.md](02-windows-port.md) | How the recorder was ported to `BF1942_w32ded.exe` as a proxy `WINMM.dll`. |
| [w32ded-offsets.md](w32ded-offsets.md) | The Windows server's offsets and how each was derived, pass by pass. |
| [03-send-path-review.md](03-send-path-review.md) | Why sampling the world beats hooking the path the server sends clients their updates by; what a server file lacked against a client's at the time. |
| [04-best-capture-and-parity-round.md](04-best-capture-and-parity-round.md) | The capture options ranked, and the round recorded by a client and the server together that showed the server holds everything a client draws. |
| [05-tick-recorder-build-log.md](05-tick-recorder-build-log.md) | Building the current recorder: sampling on the game thread, cost, the second parity round and the soak, events against a client, projectile pools, the 2026-10-12 review fixes. |
| [verification-2026-10-02.md](verification-2026-10-02.md) | An adversarial check of the engine-offset fix and the shared-core refactor; it found the refactor had reverted the fix. |
