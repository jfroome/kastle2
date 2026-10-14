#pragma once
// Shared state of the emulated RP2040 board: everything the firmware sees through the pico-sdk shims.
#include <cstddef>
#include <cstdint>

namespace emu
{
constexpr int kGpioCount = 30;
constexpr size_t kEepromSize = 256; // AT24C02
constexpr size_t kCodecRegs = 0x50;

struct Board
{
    // GPIO. `level_in` is what the outside world drives; outputs are what the firmware wrote.
    bool level_in[kGpioCount] = {};
    bool level_out[kGpioCount] = {};
    bool is_output[kGpioCount] = {};

    // ADC: raw 12-bit counts per [hardware ADC input][mux address]
    uint16_t adc_raw[4][8] = {};
    uint32_t adc_selected = 0;
    uint16_t adc_fifo = 0;

    // PWM outputs (value written to the channel level register)
    uint16_t pwm_level[8][2] = {};

    // WS2812 pixel colours as written by the firmware (0xRRGGBB)
    uint32_t pixels[3] = {};

    // Codec register file (what the firmware programmed) and EEPROM contents
    uint16_t codec_regs[kCodecRegs] = {};
    uint8_t eeprom[kEepromSize] = {};
    bool eeprom_dirty = false;

    // MIDI byte stream in (UART) and USB MIDI packets out
    static constexpr size_t kMidiQueue = 1024;
    uint8_t midi_in[kMidiQueue] = {};
    size_t midi_in_read = 0, midi_in_write = 0;
    uint8_t midi_out[kMidiQueue][4] = {};
    size_t midi_out_read = 0, midi_out_write = 0;

    // Second core bookkeeping (not emulated)
    void (*core1_entry)() = nullptr;
};

extern Board board;

/// Runs `n` ADC conversions (the real chip does one every ~2 us).
void PumpAdc(int n);
}
