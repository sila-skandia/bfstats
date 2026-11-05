# The Linux lab server where the host cannot run it: a Mac (Apple silicon or
# Intel), or any machine without 32-bit glibc. bf1942_lnxded is a 32-bit x86
# binary from 2004. This image is i386 Debian, run in the emulated x86_64 VM
# lab.sh starts, where the server runs as it does on an x86 PC (lab.sh says
# why not in an arm64 VM).
#
# The libraries are the ones hootmeow/bf1942-linux's installer puts on the
# system (installers/debian/deb_12_bfsmd_setup.sh, STEP 2, which covers
# Debian 13 too), plus python3 for lab.py and gcc for the lab's LD_PRELOAD
# shims (lowfd, realfire). Debian 13 rather than 12: the server recorder's
# recorder.so needs glibc 2.38, and bookworm has 2.36.
FROM --platform=linux/386 debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libc6 libstdc++6 libgcc-s1 zlib1g libcurl4t64 libxext6 libx11-6 libncurses6 \
      python3 gcc libc6-dev procps wget ca-certificates tini tzdata \
 && rm -rf /var/lib/apt/lists/*

# libstdc++.so.5 and libncurses.so.5, which the server links against. These
# builds rotate off deb.debian.org when Debian archives a release, so each
# falls back to archive.debian.org, as the installer's fetch_legacy_deb does.
# libstdc++5 still depends on libgcc1, a name trixie no longer has, so dpkg
# leaves it unconfigured with its files in place; the installer tolerates
# that the same way, then checks that the libraries landed.
RUN set -e; cd /tmp; \
    for path in \
      pool/main/n/ncurses/libtinfo5_6.2+20201114-2+deb11u2_i386.deb \
      pool/main/n/ncurses/libncurses5_6.2+20201114-2+deb11u2_i386.deb \
      pool/main/g/gcc-3.3/libstdc++5_3.3.6-34_i386.deb; do \
      wget -q "http://deb.debian.org/debian/$path" || wget -q "http://archive.debian.org/debian/$path"; \
    done; \
    dpkg -i libtinfo5_*.deb libncurses5_*.deb libstdc++5_*.deb || true; \
    rm -f /tmp/*.deb; ldconfig; \
    ldconfig -p | grep -q 'libstdc++\.so\.5'; ldconfig -p | grep -q 'libncurses\.so\.5'

# The run's container sets TZ to the host's zone: the server names each event
# log for the local minute, and lab.py pairs logs with client recordings by
# those times.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
