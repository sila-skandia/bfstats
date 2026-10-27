/*
 * lowfd.so -- a lab-only LD_PRELOAD for bf1942_lnxded that keeps its sockets
 * below FD_SETSIZE (1024).
 *
 * The server waits on its sockets with select(): SocketManager::sleep
 * (0x0843ea50) builds a 128-byte fd_set on its stack, sets each socket's bit
 * with `bts ecx,[ebp-0x98+edx*4]` and calls select(maxfd + 1, ...). Nothing
 * checks the fd against 1024. The server keeps every archive of every mod
 * path open (each twice), and opens its sockets after loading the level, so
 * an FHSWEurope level (FHSWEurope + FHSW + FH + bf1942 archives) leaves the
 * game socket at fd 1135. Its bit lands 0x8d bytes into the fd_set, on
 * sleep's saved ebx; select() writes the set back, clearing the bits of
 * every fd above the highest one asked for, and the caller's ebx -- the
 * address of NetServerThread::run's connection-id slot (0xea9761cc) -- comes
 * back as 0x61cc. The next packet that carries a connection id (a client's
 * ConnectAcceptAck) is stored through it: SIGSEGV in NetServer::_update
 * +1312 (0x08434380, `mov [edx],eax`), for any client, the real game's too.
 *
 * Under a 1024 soft limit (server1's systemd unit) the same level cannot
 * load at all: the server exits 0 once the archives use the fds up. The lab
 * starts the server from a login shell (soft limit 524288), so it loads, and
 * this shim moves each socket onto an fd it reserved at load time, before
 * any archive took the low numbers.
 *
 * Build: ./build.sh (gcc -m32). lab.py builds and preloads it on every start.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>

#define RESERVE 32

static int reserved[RESERVE];
static int nreserved;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static int (*real_socket)(int, int, int);

__attribute__((constructor)) static void lowfd_init(void)
{
    real_socket = (int (*)(int, int, int))dlsym(RTLD_NEXT, "socket");
    for (int i = 0; i < RESERVE; i++) {
        int fd = open("/dev/null", O_RDONLY | O_CLOEXEC);
        if (fd < 0 || fd >= FD_SETSIZE) {
            if (fd >= 0) close(fd);
            break;
        }
        reserved[nreserved++] = fd;
    }
}

int socket(int domain, int type, int protocol)
{
    if (!real_socket) real_socket = (int (*)(int, int, int))dlsym(RTLD_NEXT, "socket");
    int fd = real_socket(domain, type, protocol);
    if (fd < FD_SETSIZE) return fd;
    pthread_mutex_lock(&lock);
    int low = nreserved > 0 ? reserved[--nreserved] : -1;
    pthread_mutex_unlock(&lock);
    if (low < 0) {
        fprintf(stderr, "lowfd: socket fd %d is past FD_SETSIZE and no low fd is left\n", fd);
        return fd;
    }
    /* dup2 closes the /dev/null placeholder and puts the socket in its place. */
    if (dup2(fd, low) != low) {
        fprintf(stderr, "lowfd: dup2(%d, %d) failed\n", fd, low);
        return fd;
    }
    close(fd);
    fprintf(stderr, "lowfd: socket fd %d moved to %d\n", fd, low);
    return low;
}
