#pragma once
#include "hardware/sync.h"
#include "pico/types.h"

typedef struct { io_rw_32 cs; } adc_hw_t;
extern adc_hw_t emu_adc_hw;
#define adc_hw (&emu_adc_hw)
#define ADC_CS_START_ONCE_BITS 0x00000004u

#ifdef __cplusplus
extern "C"
{
#endif
    void adc_init(void);
    void adc_gpio_init(uint pin);
    void adc_select_input(uint input);
    void adc_fifo_setup(bool en, bool dreq_en, uint16_t dreq_thresh, bool err_in_fifo, bool byte_shift);
    uint16_t adc_fifo_get(void);
    void adc_irq_set_enabled(bool enabled);
#ifdef __cplusplus
}
#endif
