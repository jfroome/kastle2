#pragma once
#include "pico/types.h"
#ifdef __cplusplus
extern "C"
{
#endif
#define ADC_IRQ_FIFO 22
#define DMA_IRQ_0 11
    typedef void (*irq_handler_t)(void);
    void irq_set_exclusive_handler(uint num, irq_handler_t handler);
    void irq_set_enabled(uint num, bool enabled);
#ifdef __cplusplus
}
#endif
