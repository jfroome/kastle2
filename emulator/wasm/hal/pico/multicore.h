#pragma once
#include "pico/types.h"
#ifdef __cplusplus
extern "C"
{
#endif
    // The second core is not emulated: apps that use it need a cooperative replacement
    void multicore_reset_core1(void);
    void multicore_launch_core1(void (*entry)(void));
    bool multicore_fifo_wready(void);
    bool multicore_fifo_rvalid(void);
    void multicore_fifo_push_blocking(uint32_t data);
    uint32_t multicore_fifo_pop_blocking(void);
#ifdef __cplusplus
}
#endif
