#pragma once
#include "pico/types.h"
#ifdef __cplusplus
extern "C"
{
#endif
    bool set_sys_clock_khz(uint32_t khz, bool required);
    bool set_sys_clock_hz(uint32_t hz, bool required);
    uint32_t clock_get_hz(int clk);
#define clk_sys 5
#ifdef __cplusplus
}
#endif
