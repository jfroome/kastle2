// Minimal bare-metal support so the firmware host links for Cortex-M0+ and can run in an instruction-set simulator.
#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>

static uint8_t heap[8 * 1024 * 1024] __attribute__((aligned(8)));
static size_t heap_used;

void *_sbrk(ptrdiff_t incr)
{
    if (heap_used + (size_t)incr > sizeof(heap))
    {
        errno = ENOMEM;
        return (void *)-1;
    }
    void *p = heap + heap_used;
    heap_used += (size_t)incr;
    return p;
}
void _exit(int code) { for (;;) { (void)code; } }
int _close(int f) { (void)f; return -1; }
int _lseek(int f, int o, int w) { (void)f; (void)o; (void)w; return 0; }
int _read(int f, char *b, int n) { (void)f; (void)b; (void)n; return 0; }
int _write(int f, char *b, int n) { (void)f; (void)b; return n; }
int _fstat(int f, struct stat *s) { (void)f; s->st_mode = S_IFCHR; return 0; }
int _isatty(int f) { (void)f; return 1; }
int _kill(int p, int s) { (void)p; (void)s; return -1; }
int _getpid(void) { return 1; }
void *__dso_handle = 0;
