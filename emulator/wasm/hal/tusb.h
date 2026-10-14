#pragma once
#include "pico/types.h"
#ifdef __cplusplus
extern "C"
{
#endif
    bool tusb_init(void);
    bool tud_init(uint8_t rhport);
    void tud_task(void);
    bool tud_cdc_connected(void);
    uint32_t tud_cdc_available(void);
    int32_t tud_cdc_read_char(void);
    uint32_t tud_cdc_write_available(void);
    uint32_t tud_cdc_write(const void *buffer, uint32_t bufsize);
    uint32_t tud_cdc_write_flush(void);
    bool tud_cdc_n_read_flush(uint8_t itf);
    bool tud_midi_available(void);
    bool tud_midi_packet_read(uint8_t packet[4]);
    bool tud_midi_packet_write(uint8_t const packet[4]);
#ifdef __cplusplus
}
#endif
