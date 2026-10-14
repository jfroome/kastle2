#pragma once
#include "pico/types.h"
typedef struct pio_hw *PIO;
#define pio0 ((PIO)0)
#define pio1 ((PIO)1)

typedef struct { int dummy; } pio_program_t;

#ifdef __cplusplus
extern "C"
{
#endif
    static inline uint pio_add_program(PIO, const pio_program_t *) { return 0; }
    // Captures the 24-bit words the firmware sends to the WS2812 LED chain
    void pio_sm_put_blocking(PIO pio, uint sm, uint32_t data);
#ifdef __cplusplus
}
#endif
