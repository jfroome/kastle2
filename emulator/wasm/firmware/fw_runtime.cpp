// Host for the unmodified Kastle 2 firmware (Base, Hardware, Memory, MIDI, the app) compiled to WebAssembly.
// The pico-sdk calls are served by ../hal. This file exposes a small C API so JavaScript can act as the board:
// it sets pots/CV/buttons, steps time block by block and reads LEDs, outputs and audio.
#include <cstdint>
#include <cstring>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE // native debug build (see build_native.sh)
#endif

#include "common/core/Kastle2.hpp"
#include "hal_state.hpp"

using namespace kastle2;

// Implemented by the per-app glue (glue_*.cpp), mirroring each app's main.cpp
void fw_app_boot();
void fw_app_ui();
const char *fw_app_name();

namespace
{
constexpr size_t kBlock = 48;
int32_t g_in[2 * kBlock];
int32_t g_out[2 * kBlock];
double g_us_accumulator = 0.0;
constexpr double kBlockUs = 1e6 * kBlock / 44000.0;
#ifndef FW_USER_DATA_BYTES
#define FW_USER_DATA_BYTES 65536
#endif
uint8_t g_user_data[FW_USER_DATA_BYTES];
size_t g_user_data_size = 0;
bool g_booted = false;
} // namespace

extern "C" size_t emu_user_data_base(void)
{
    return reinterpret_cast<size_t>(g_user_data);
}

#define EXPORT extern "C" EMSCRIPTEN_KEEPALIVE

EXPORT const char *fw_name() { return fw_app_name(); }
EXPORT int32_t *fw_input() { return g_in; }
EXPORT uint8_t *fw_scratch()
{
    static uint8_t scratch[16];
    return scratch;
}
EXPORT int32_t *fw_output() { return g_out; }
EXPORT int fw_block_size() { return static_cast<int>(kBlock); }
EXPORT uint8_t *fw_user_data_ptr() { return g_user_data; }
EXPORT int fw_user_data_capacity() { return static_cast<int>(sizeof(g_user_data)); }

// ---- board inputs
EXPORT void fw_set_adc(int hw_adc, int mux, int raw)
{
    if (hw_adc >= 0 && hw_adc < 4 && mux >= 0 && mux < 8)
        emu::board.adc_raw[hw_adc][mux] = static_cast<uint16_t>(raw < 0 ? 0 : raw > 4095 ? 4095 : raw);
}
EXPORT void fw_set_pin(int pin, int level)
{
    if (pin >= 0 && pin < emu::kGpioCount) emu::board.level_in[pin] = level != 0;
}
EXPORT void fw_midi_in(int byte)
{
    auto &b = emu::board;
    b.midi_in[b.midi_in_write] = static_cast<uint8_t>(byte);
    b.midi_in_write = (b.midi_in_write + 1) % emu::Board::kMidiQueue;
}

// ---- board outputs
EXPORT int fw_get_pin(int pin) { return (pin >= 0 && pin < emu::kGpioCount) ? emu::board.level_out[pin] : 0; }
EXPORT int fw_get_pwm(int slice, int chan) { return emu::board.pwm_level[slice & 7][chan & 1]; }
EXPORT uint32_t fw_get_led(int index) { return emu::board.pixels[index % 3]; }
EXPORT int fw_get_codec_reg(int reg) { return reg >= 0 && reg < (int)emu::kCodecRegs ? emu::board.codec_regs[reg] : 0; }
EXPORT int fw_midi_out_pop(uint8_t *packet)
{
    auto &b = emu::board;
    if (b.midi_out_read == b.midi_out_write) return 0;
    std::memcpy(packet, b.midi_out[b.midi_out_read], 4);
    b.midi_out_read = (b.midi_out_read + 1) % emu::Board::kMidiQueue;
    return 1;
}
EXPORT uint8_t *fw_eeprom_ptr() { return emu::board.eeprom; }
EXPORT int fw_eeprom_size() { return static_cast<int>(emu::kEepromSize); }
EXPORT int fw_eeprom_take_dirty()
{
    const bool d = emu::board.eeprom_dirty;
    emu::board.eeprom_dirty = false;
    return d;
}

// ---- introspection of the firmware's own hardware layer
EXPORT int fw_layer() { return static_cast<int>(Kastle2::hw.GetLayer()); }
EXPORT int fw_pot_frozen(int pot) { return Kastle2::hw.IsPotFrozen(static_cast<Hardware::Pot>(pot)); }
EXPORT int fw_pot_raw(int pot) { return Kastle2::hw.GetRawPotValue(static_cast<Hardware::Pot>(pot)); }
EXPORT int fw_analog_value(int input) { return Kastle2::hw.GetAnalogValue(static_cast<Hardware::AnalogInput>(input)); }
EXPORT int fw_button_pressed(int button) { return Kastle2::hw.Pressed(static_cast<Hardware::Button>(button)); }
EXPORT int fw_version() { return static_cast<int>(Kastle2::hw.GetVersion()); }

// ---- lifecycle
EXPORT void fw_boot()
{
    if (g_booted) return;
    emu::board.level_in[Hardware::PIN_RX] = true; // Citadel is detected by RX being pulled high
    emu::board.level_in[Hardware::PIN_BUTTON_SHIFT] = true;
    emu::board.level_in[Hardware::PIN_BUTTON_MODE] = true;
    emu::board.level_in[Hardware::PIN_TRIG_IN] = true;
    emu::board.level_in[Hardware::PIN_RESET_IN] = true;
    emu::board.level_in[Hardware::PIN_SYNC_IN] = true;
    emu::board.level_in[Hardware::PIN_SYNC_IN_DETECT] = true;
    fw_app_boot();
    g_booted = true;
}

// The pieces of fw_run_block, also exported separately so the ARM cycle profiler can time them individually
EXPORT void fw_advance_block_time()
{
    g_us_accumulator += kBlockUs;
    const uint64_t whole = static_cast<uint64_t>(g_us_accumulator);
    g_us_accumulator -= static_cast<double>(whole);
    emu_advance_time_us(whole);
    emu::PumpAdc(520); // the real ADC finishes a full scan a few times per block
}

EXPORT void fw_ui_step(int iterations)
{
    for (int i = 0; i < iterations; i++)
    {
        Kastle2::ReadInputs();
        fw_app_ui();
    }
}

EXPORT void fw_audio_block()
{
    if (I2S::installed_callback)
    {
        I2S::installed_callback(g_in, g_out, kBlock);
    }
    else
    {
        std::memset(g_out, 0, sizeof(g_out));
    }
}

/// One audio interrupt (48 frames) plus the main-loop iterations that would run in that time.
EXPORT void fw_run_block(int ui_iterations)
{
    fw_advance_block_time();
    fw_ui_step(ui_iterations);
    fw_audio_block();
}
