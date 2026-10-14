#pragma once
#include "pico/types.h"

#ifdef __cplusplus
extern "C"
{
#endif
    extern uint64_t emu_time_us;
    void emu_advance_time_us(uint64_t us);

    static inline absolute_time_t get_absolute_time(void)
    {
        absolute_time_t t = {emu_time_us};
        return t;
    }
    static inline absolute_time_t make_timeout_time_us(uint64_t us)
    {
        absolute_time_t t = {emu_time_us + us};
        return t;
    }
    static inline absolute_time_t make_timeout_time_ms(uint32_t ms)
    {
        return make_timeout_time_us((uint64_t)ms * 1000u);
    }
    static inline int64_t absolute_time_diff_us(absolute_time_t from, absolute_time_t to)
    {
        return (int64_t)(to._private_us_since_boot - from._private_us_since_boot);
    }
    static inline uint32_t to_ms_since_boot(absolute_time_t t)
    {
        return (uint32_t)(t._private_us_since_boot / 1000u);
    }
    static inline uint64_t to_us_since_boot(absolute_time_t t)
    {
        return t._private_us_since_boot;
    }
    static inline uint32_t time_us_32(void)
    {
        return (uint32_t)emu_time_us;
    }
    static inline uint64_t time_us_64(void)
    {
        return emu_time_us;
    }
    void sleep_us(uint64_t us);
    void sleep_ms(uint32_t ms);
#ifdef __cplusplus
}
#endif
