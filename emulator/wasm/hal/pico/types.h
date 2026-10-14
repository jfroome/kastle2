#pragma once
// Minimal Raspberry Pi Pico SDK stand-in so the unmodified Kastle 2 firmware can be compiled to WebAssembly.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef unsigned int uint;

typedef struct
{
    uint64_t _private_us_since_boot;
} absolute_time_t;
