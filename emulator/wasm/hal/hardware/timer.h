#pragma once
#include "pico/time.h"
typedef struct { volatile uint32_t dbgpause; } timer_hw_t;
extern timer_hw_t emu_timer_hw;
#define timer_hw (&emu_timer_hw)
