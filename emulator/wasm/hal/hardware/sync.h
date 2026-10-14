#pragma once
#include "pico/types.h"
static inline uint32_t save_and_disable_interrupts(void) { return 0; }
static inline void restore_interrupts(uint32_t) {}
typedef volatile uint32_t io_rw_32;
static inline void hw_set_bits(io_rw_32 *addr, uint32_t mask) { *addr |= mask; }
static inline void hw_clear_bits(io_rw_32 *addr, uint32_t mask) { *addr &= ~mask; }
