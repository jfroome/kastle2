// Implementation of the pico-sdk shims declared in hal/hardware/*.h and hal/pico/*.h
#include <cstring>

#include "hal_state.hpp"

#include "hardware/adc.h"
#include "hardware/clocks.h"
#include "hardware/gpio.h"
#include "hardware/i2c.h"
#include "hardware/irq.h"
#include "hardware/pio.h"
#include "hardware/pwm.h"
#include "hardware/timer.h"
#include "hardware/uart.h"
#include "pico/multicore.h"
#include "pico/time.h"
#include "tusb.h"

extern "C" uint64_t emu_time_us = 0;
adc_hw_t emu_adc_hw = {};
timer_hw_t emu_timer_hw = {};
i2c_inst_t emu_i2c0_inst = {0};
uart_inst_t emu_uart0_inst = {0};

namespace emu
{
Board board;

struct Fifo
{
    uint32_t data[256];
    size_t read = 0, write = 0;
};
static Fifo to_core1, from_core1;
static bool in_core1 = false;
struct Core1Yield
{
};
static bool fifo_empty(const Fifo &f) { return f.read == f.write; }
static void fifo_push(Fifo &f, uint32_t v)
{
    f.data[f.write] = v;
    f.write = (f.write + 1) % 256;
}
static uint32_t fifo_pop(Fifo &f)
{
    const uint32_t v = f.data[f.read];
    f.read = (f.read + 1) % 256;
    return v;
}
} // namespace emu

// Markers the ARM cycle profiler (cpu/profile.py) hooks to attribute cycles to the second core
extern "C" __attribute__((noinline)) void emu_core1_begin(void) { __asm__ volatile(""); }
extern "C" __attribute__((noinline)) void emu_core1_end(void) { __asm__ volatile(""); }

namespace emu
{
static void RunCore1()
{
    if (!board.core1_entry || in_core1) return;
    in_core1 = true;
    emu_core1_begin();
    try
    {
        board.core1_entry();
    }
    catch (const Core1Yield &)
    {
    }
    emu_core1_end();
    in_core1 = false;
}
static irq_handler_t adc_handler = nullptr;
static bool adc_irq_enabled = false;

void PumpAdc(int n)
{
    for (int i = 0; i < n; i++)
    {
        if (!(emu_adc_hw.cs & ADC_CS_START_ONCE_BITS) || !adc_handler || !adc_irq_enabled)
        {
            return;
        }
        emu_adc_hw.cs &= ~ADC_CS_START_ONCE_BITS;
        // GPIO 13/14/15 = MUX C/B/A
        const uint32_t mux = (board.level_out[15] ? 1u : 0u) | (board.level_out[14] ? 2u : 0u) | (board.level_out[13] ? 4u : 0u);
        // Only ADC0/ADC1 sit behind the multiplexer; the pitch inputs (ADC2/ADC3) are wired straight through
        const uint32_t hw = board.adc_selected & 3;
        board.adc_fifo = board.adc_raw[hw][hw < 2 ? (mux & 7) : 0];
        adc_handler();
    }
}

// ---- I2C devices: NAU88C22 codec (0x1A) and AT24C02 EEPROM (0x50)
namespace
{
constexpr uint8_t kCodecAddr = 0x1A;
constexpr uint8_t kEepromAddr = 0x50;
uint8_t pending_codec_reg = 0;
uint8_t eeprom_pointer = 0;
} // namespace
} // namespace emu

extern "C"
{
    void emu_advance_time_us(uint64_t us)
    {
        emu_time_us += us;
    }

    void emu_tight_loop(void)
    {
        // Busy-wait loops on core 0 give the emulated second core a chance to run
        (void)multicore_fifo_rvalid();
    }

    void sleep_us(uint64_t us)
    {
        emu_time_us += us;
        emu::PumpAdc(static_cast<int>(us / 2));
    }

    void sleep_ms(uint32_t ms)
    {
        sleep_us(static_cast<uint64_t>(ms) * 1000u);
    }

    // GPIO
    void gpio_init(uint pin)
    {
        if (pin < emu::kGpioCount) emu::board.is_output[pin] = false;
    }
    void gpio_deinit(uint) {}
    void gpio_set_dir(uint pin, bool out)
    {
        if (pin < emu::kGpioCount) emu::board.is_output[pin] = out;
    }
    void gpio_put(uint pin, bool value)
    {
        if (pin < emu::kGpioCount) emu::board.level_out[pin] = value;
    }
    bool gpio_get(uint pin)
    {
        if (pin >= emu::kGpioCount) return false;
        return emu::board.is_output[pin] ? emu::board.level_out[pin] : emu::board.level_in[pin];
    }
    void gpio_set_pulls(uint, bool, bool) {}
    void gpio_set_function(uint, enum gpio_function) {}
    void gpio_set_drive_strength(uint, enum gpio_drive_strength) {}

    // Clocks
    bool set_sys_clock_khz(uint32_t, bool) { return true; }
    bool set_sys_clock_hz(uint32_t, bool) { return true; }
    uint32_t clock_get_hz(int) { return 176000000u; }

    // IRQ / ADC
    void irq_set_exclusive_handler(uint num, irq_handler_t handler)
    {
        if (num == ADC_IRQ_FIFO) emu::adc_handler = handler;
    }
    void irq_set_enabled(uint, bool) {}
    void adc_init(void) {}
    void adc_gpio_init(uint) {}
    void adc_select_input(uint input) { emu::board.adc_selected = input; }
    void adc_fifo_setup(bool, bool, uint16_t, bool, bool) {}
    uint16_t adc_fifo_get(void) { return emu::board.adc_fifo; }
    void adc_irq_set_enabled(bool enabled) { emu::adc_irq_enabled = enabled; }

    // PWM
    void pwm_set_clkdiv(uint, float) {}
    void pwm_set_wrap(uint, uint16_t) {}
    void pwm_set_chan_level(uint slice, uint chan, uint16_t level)
    {
        if (slice < 8 && chan < 2) emu::board.pwm_level[slice][chan] = level;
    }
    void pwm_set_enabled(uint, bool) {}
    uint pwm_gpio_to_slice_num(uint gpio) { return (gpio >> 1) & 7u; }
    uint pwm_gpio_to_channel(uint gpio) { return gpio & 1u; }

    // I2C
    uint i2c_init(i2c_inst_t *, uint baud) { return baud; }

    int i2c_write_blocking_until(i2c_inst_t *, uint8_t addr, const uint8_t *src, size_t len, bool, absolute_time_t)
    {
        using namespace emu;
        if (addr == kCodecAddr)
        {
            if (len >= 1) pending_codec_reg = src[0] >> 1;
            if (len >= 2 && pending_codec_reg < kCodecRegs)
            {
                const uint16_t value = static_cast<uint16_t>(((src[0] & 1u) << 8) | src[1]);
                board.codec_regs[pending_codec_reg] = value;
                if (pending_codec_reg == 0x00) // reset: datasheet power-on values
                {
                    std::memset(board.codec_regs, 0, sizeof(board.codec_regs));
                    board.codec_regs[0x0B] = board.codec_regs[0x0C] = 0xFF; // DAC digital volume 0 dB
                    board.codec_regs[0x0F] = board.codec_regs[0x10] = 0xFF; // ADC digital volume 0 dB
                    board.codec_regs[0x2D] = board.codec_regs[0x2E] = 0x10; // input PGA 0 dB
                    board.codec_regs[0x34] = board.codec_regs[0x35] = 0x39; // headphone volume 0 dB
                    board.codec_regs[0x36] = board.codec_regs[0x37] = 0x39; // speaker volume 0 dB
                }
            }
            return static_cast<int>(len);
        }
        if (addr == kEepromAddr)
        {
            if (len >= 1)
            {
                eeprom_pointer = src[0];
                for (size_t i = 1; i < len; i++)
                {
                    board.eeprom[eeprom_pointer++ % kEepromSize] = src[i];
                    board.eeprom_dirty = true;
                }
            }
            return static_cast<int>(len);
        }
        return -1;
    }

    int i2c_read_blocking_until(i2c_inst_t *, uint8_t addr, uint8_t *dst, size_t len, bool, absolute_time_t)
    {
        using namespace emu;
        if (addr == kCodecAddr)
        {
            uint16_t value = pending_codec_reg < kCodecRegs ? board.codec_regs[pending_codec_reg] : 0;
            if (pending_codec_reg == 0x3F) value = 0x01A; // device ID
            if (len >= 1) dst[0] = static_cast<uint8_t>(value >> 8);
            if (len >= 2) dst[1] = static_cast<uint8_t>(value & 0xFF);
            return static_cast<int>(len);
        }
        if (addr == kEepromAddr)
        {
            for (size_t i = 0; i < len; i++) dst[i] = board.eeprom[eeprom_pointer++ % kEepromSize];
            return static_cast<int>(len);
        }
        return -1;
    }

    // UART MIDI input
    uint uart_init(uart_inst_t *, uint baud) { return baud; }
    void uart_set_fifo_enabled(uart_inst_t *, bool) {}
    bool uart_is_readable(uart_inst_t *) { return emu::board.midi_in_read != emu::board.midi_in_write; }
    uint8_t uart_getc(uart_inst_t *)
    {
        auto &b = emu::board;
        const uint8_t v = b.midi_in[b.midi_in_read];
        b.midi_in_read = (b.midi_in_read + 1) % emu::Board::kMidiQueue;
        return v;
    }

    // Second core: emulated cooperatively. The worker functions are polling loops whose only state lives in the app
    // object, so "running core 1" means calling the entry point until it polls an empty FIFO, which unwinds it.
    void multicore_reset_core1(void) {}
    void multicore_launch_core1(void (*entry)(void)) { emu::board.core1_entry = entry; }
    bool multicore_fifo_wready(void) { return true; }
    bool multicore_fifo_rvalid(void)
    {
        if (emu::in_core1)
        {
            if (emu::fifo_empty(emu::to_core1)) throw emu::Core1Yield{};
            return true;
        }
        if (emu::fifo_empty(emu::from_core1)) emu::RunCore1();
        return !emu::fifo_empty(emu::from_core1);
    }
    void multicore_fifo_push_blocking(uint32_t data)
    {
        emu::fifo_push(emu::in_core1 ? emu::from_core1 : emu::to_core1, data);
    }
    uint32_t multicore_fifo_pop_blocking(void)
    {
        if (emu::in_core1)
        {
            if (emu::fifo_empty(emu::to_core1)) throw emu::Core1Yield{};
            return emu::fifo_pop(emu::to_core1);
        }
        if (emu::fifo_empty(emu::from_core1)) emu::RunCore1();
        return emu::fifo_empty(emu::from_core1) ? 0 : emu::fifo_pop(emu::from_core1);
    }

    // TinyUSB: no USB host in the emulator (USB MIDI out is captured, USB serial is dropped)
    bool tusb_init(void) { return true; }
    bool tud_init(uint8_t) { return true; }
    void tud_task(void) {}
    bool tud_cdc_connected(void) { return false; }
    uint32_t tud_cdc_available(void) { return 0; }
    int32_t tud_cdc_read_char(void) { return -1; }
    uint32_t tud_cdc_write_available(void) { return 64; }
    uint32_t tud_cdc_write(const void *, uint32_t size) { return size; }
    uint32_t tud_cdc_write_flush(void) { return 0; }
    bool tud_cdc_n_read_flush(uint8_t) { return true; }
    bool tud_midi_available(void) { return false; }
    bool tud_midi_packet_read(uint8_t[4]) { return false; }
    bool tud_midi_packet_write(uint8_t const packet[4])
    {
        auto &b = emu::board;
        std::memcpy(b.midi_out[b.midi_out_write], packet, 4);
        b.midi_out_write = (b.midi_out_write + 1) % emu::Board::kMidiQueue;
        return true;
    }
}

extern "C" void pio_sm_put_blocking(PIO, uint, uint32_t data)
{
    // Data order set by WS2812::Init(GREEN, RED, BLUE): G<<24 | R<<16 | B<<8
    static size_t index = 0;
    const uint32_t g = (data >> 24) & 0xFF;
    const uint32_t r = (data >> 16) & 0xFF;
    const uint32_t b = (data >> 8) & 0xFF;
    emu::board.pixels[index] = (r << 16) | (g << 8) | b;
    index = (index + 1) % 3;
}
