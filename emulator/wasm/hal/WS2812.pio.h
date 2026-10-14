#pragma once
#include "hardware/pio.h"
static const pio_program_t ws2812_program = {0};
static inline void ws2812_program_init(PIO, uint, uint, uint, float, uint) {}
