#pragma once
// WebAssembly has no RAM/flash split: FASTCODE just keeps the noinline behaviour.
#define FASTCODE __attribute__((noinline))
inline void copy_fastcode_to_ram(void) {}
