#pragma once
#include "pico/types.h"
#ifdef __cplusplus
extern "C"
{
#endif
#define PWM_CHAN_A 0
#define PWM_CHAN_B 1
    void pwm_set_clkdiv(uint slice, float div);
    void pwm_set_wrap(uint slice, uint16_t wrap);
    void pwm_set_chan_level(uint slice, uint chan, uint16_t level);
    void pwm_set_enabled(uint slice, bool enabled);
    uint pwm_gpio_to_slice_num(uint gpio);
    uint pwm_gpio_to_channel(uint gpio);
#ifdef __cplusplus
}
#endif
