#pragma once
#include "pico/types.h"
#ifdef __cplusplus
extern "C"
{
#endif
#define GPIO_OUT 1
#define GPIO_IN 0
    enum gpio_function
    {
        GPIO_FUNC_XIP = 0, GPIO_FUNC_SPI = 1, GPIO_FUNC_UART = 2, GPIO_FUNC_I2C = 3, GPIO_FUNC_PWM = 4,
        GPIO_FUNC_SIO = 5, GPIO_FUNC_PIO0 = 6, GPIO_FUNC_PIO1 = 7, GPIO_FUNC_NULL = 0x1f
    };
    enum gpio_drive_strength { GPIO_DRIVE_STRENGTH_2MA = 0, GPIO_DRIVE_STRENGTH_4MA, GPIO_DRIVE_STRENGTH_8MA, GPIO_DRIVE_STRENGTH_12MA };

    void gpio_init(uint pin);
    void gpio_deinit(uint pin);
    void gpio_set_dir(uint pin, bool out);
    void gpio_put(uint pin, bool value);
    bool gpio_get(uint pin);
    void gpio_set_pulls(uint pin, bool up, bool down);
    void gpio_set_function(uint pin, enum gpio_function fn);
    void gpio_set_drive_strength(uint pin, enum gpio_drive_strength strength);
#ifdef __cplusplus
}
#endif
