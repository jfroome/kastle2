#pragma once
#include <stdlib.h>
#include <string.h>
#ifdef __cplusplus
// Real pico headers pull these in transitively with libstdc++; libc++ needs them spelled out
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#endif
#include "pico/time.h"
#include "pico/types.h"
#include "hardware/gpio.h"
#include "hardware/clocks.h"

#ifdef __cplusplus
extern "C" void emu_tight_loop(void);
static inline void tight_loop_contents(void) { emu_tight_loop(); }
#else
void emu_tight_loop(void);
static inline void tight_loop_contents(void) { emu_tight_loop(); }
#endif
