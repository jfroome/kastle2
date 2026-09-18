/*
MIT License

Copyright (c) 2026 Bastl Instruments

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

#include "AppMasterBlaster.hpp"
#include "common/core/Kastle2.hpp"
#include "common/utils.hpp"

using namespace kastle2;

namespace
{
static inline q15_t ClampQ15(int32_t value)
{
    if (value > 32767)
        return 32767;
    if (value < -32768)
        return -32768;
    return static_cast<q15_t>(value);
}

static inline q15_t SoftDrive(q15_t sample, int32_t drive)
{
    int32_t signed_sample = sample;
    int32_t gain = 32768 + drive;
    int32_t staged = (signed_sample * gain) >> 15;
    staged = staged > 32767 ? 32767 : staged;
    staged = staged < -32768 ? -32768 : staged;

    int32_t compressed = staged;
    if (compressed > 24576)
        compressed = 24576 + ((compressed - 24576) >> 1);
    else if (compressed < -24576)
        compressed = -24576 + ((compressed + 24576) >> 1);

    return ClampQ15(compressed);
}

static inline q15_t TapeWow(q15_t sample, int32_t wow, uint32_t counter)
{
    uint32_t wow_phase = (counter * 17u + 119u) & 4095u;
    int32_t wobble = static_cast<int32_t>(wow_phase);
    if (wobble > 2047)
    {
        wobble = 4095 - wobble;
    }
    wobble -= 1024;

    int32_t drift = (wobble * wow) >> 12;
    int32_t wowed = (sample * (32768 + drift)) >> 15;
    return ClampQ15(wowed);
}

static inline q15_t TapeHiss(q15_t sample, uint32_t counter, int32_t wow)
{
    (void)counter;
    (void)wow;
    return sample;
}

static inline q15_t BitCrush(q15_t sample, int32_t crush)
{
    int32_t depth = 16 - (crush >> 13);
    if (depth < 3)
        depth = 3;
    if (depth > 15)
        depth = 15;

    int32_t shift = 16 - depth;
    int32_t quantized = (sample >> shift) << shift;
    return ClampQ15(quantized);
}

static inline q15_t MixWithDry(q15_t dry, q15_t wet, int32_t mix)
{
    int32_t wet_gain = mix;
    int32_t dry_gain = 32768 - mix;
    int32_t result = ((dry * dry_gain) + (wet * wet_gain)) >> 15;
    return ClampQ15(result);
}

static inline q15_t MasterCompress(q15_t sample, int32_t amount)
{
    int32_t magnitude = std::abs(static_cast<int32_t>(sample));
    int32_t threshold = 22000;
    if (magnitude <= threshold)
    {
        return sample;
    }

    int32_t excess = magnitude - threshold;
    int32_t ratio = 5 + ((amount * 10) >> 15);
    int32_t reduced = threshold + (excess / ratio);
    int32_t gain = (reduced * 32768) / std::max<int32_t>(1, magnitude);
    int32_t compressed = (static_cast<int32_t>(sample) * gain) >> 15;
    return ClampQ15(compressed);
}
}

void AppMasterBlaster::Init()
{
    inited_ = false;
    mode_ = Mode::WARM;
    sample_counter_ = 0;

    Kastle2::base.SetFeatureEnabled(Base::Feature::AUDIO_CHAIN, false);

    inited_ = true;
}

void AppMasterBlaster::DeInit()
{
    inited_ = false;
}

FASTCODE void AppMasterBlaster::AudioLoop(q15_t *input, q15_t *output, size_t size)
{
    if (!inited_)
    {
        return;
    }

    for (size_t i = 0; i < size; i++)
    {
        q15_t left = input[2 * i];
        q15_t right = input[2 * i + 1];

        int32_t drive = drive_;
        int32_t warmth = warmth_;
        int32_t glue = glue_;
        int32_t wow = wow_;
        int32_t crush = crush_;
        int32_t mix = mix_;
        int32_t out_gain = output_;

        if (mode_ == Mode::MASTER)
        {
            drive = drive + 6000;
            warmth = warmth + 5000;
            glue = glue + 4500;
            crush = crush + 4000;
            mix = mix + 3500;
            out_gain = out_gain + 2500;
        }
        else if (mode_ == Mode::CRUSH)
        {
            drive = drive + 9000;
            warmth = warmth + 3500;
            glue = glue + 6500;
            wow = wow + 5000;
            crush = crush + 10000;
            mix = mix + 6500;
            out_gain = out_gain + 3000;
        }
        else if (mode_ == Mode::BYPASS)
        {
            output[2 * i] = left;
            output[2 * i + 1] = right;
            sample_counter_++;
            continue;
        }

        q15_t wet_left = SoftDrive(left, drive);
        q15_t wet_right = SoftDrive(right, drive);

        int32_t low_warmth = (wet_left + wet_right) >> 1;
        int32_t bass_bias = (low_warmth * warmth) >> 15;
        q15_t warmth_left = ClampQ15(wet_left + bass_bias + ((wet_left * warmth) >> 17));
        q15_t warmth_right = ClampQ15(wet_right + bass_bias + ((wet_right * warmth) >> 17));

        q15_t glue_left = ClampQ15(warmth_left + ((warmth_left * glue) >> 15));
        q15_t glue_right = ClampQ15(warmth_right + ((warmth_right * glue) >> 15));

        q15_t wow_left = TapeWow(glue_left, wow, sample_counter_);
        q15_t wow_right = TapeWow(glue_right, wow, sample_counter_ + 131u);

        q15_t sample_left = BitCrush(wow_left, crush);
        q15_t sample_right = BitCrush(wow_right, crush);

        q15_t mixed_left = MixWithDry(left, sample_left, mix);
        q15_t mixed_right = MixWithDry(right, sample_right, mix);

        q15_t final_left = ClampQ15((mixed_left * out_gain) >> 15);
        q15_t final_right = ClampQ15((mixed_right * out_gain) >> 15);

        int32_t stereo_width = stereo_width_;
        int32_t master_comp = master_comp_;

        q15_t width_left = ClampQ15(final_left + ((final_left - final_right) * stereo_width >> 15));
        q15_t width_right = ClampQ15(final_right - ((final_left - final_right) * stereo_width >> 15));

        q15_t comp_left = MasterCompress(width_left, master_comp);
        q15_t comp_right = MasterCompress(width_right, master_comp);

        output[2 * i] = comp_left;
        output[2 * i + 1] = comp_right;

        sample_counter_++;
    }
}

void AppMasterBlaster::UiLoop()
{
    int32_t pot_drive = 0;
    int32_t pot_warmth = 0;
    int32_t pot_glue = 0;
    int32_t pot_wow = 0;
    int32_t pot_crush = 0;
    int32_t pot_mix = 0;
    int32_t pot_output = 0;
    int32_t pot_stereo = 0;
    int32_t pot_comp = 0;

    Kastle2::hw.ReadPot(&pot_drive, Hardware::Pot::POT_1, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_warmth, Hardware::Pot::POT_2, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_glue, Hardware::Pot::POT_3, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_wow, Hardware::Pot::POT_4, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_crush, Hardware::Pot::POT_5, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_mix, Hardware::Pot::POT_6, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_output, Hardware::Pot::POT_7, Hardware::Layer::NORMAL);
    Kastle2::hw.ReadPot(&pot_stereo, Hardware::Pot::POT_1, Hardware::Layer::SHIFT);
    Kastle2::hw.ReadPot(&pot_comp, Hardware::Pot::POT_2, Hardware::Layer::SHIFT);

    drive_ = map(pot_drive, 0, POT_MAX, 1000, 32000, MapClamp::TRUE);
    warmth_ = map(pot_warmth, 0, POT_MAX, 700, 22000, MapClamp::TRUE);
    glue_ = map(pot_glue, 0, POT_MAX, 1000, 22000, MapClamp::TRUE);
    wow_ = map(pot_wow, 0, POT_MAX, 0, 18000, MapClamp::TRUE);
    crush_ = map(pot_crush, 0, POT_MAX, 1500, 28000, MapClamp::TRUE);
    mix_ = map(pot_mix, 0, POT_MAX, 12000, 31000, MapClamp::TRUE);
    output_ = map(pot_output, 0, POT_MAX, 9000, 32767, MapClamp::TRUE);

    if (Kastle2::hw.GetLayer() == Hardware::Layer::SHIFT)
    {
        stereo_width_ = map(pot_stereo, 0, POT_MAX, 0, 12000, MapClamp::TRUE);
        master_comp_ = map(pot_comp, 0, POT_MAX, 5000, 22000, MapClamp::TRUE);
    }
    else
    {
        stereo_width_ = constrain(stereo_width_, 0, 12000);
        master_comp_ = constrain(master_comp_, 5000, 22000);
    }

    int32_t cv_drive = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_1);
    int32_t cv_glue = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_2);
    int32_t cv_crush = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_3);

    drive_ += map(cv_drive, 0, ADC_5V, -6000, 9000, MapClamp::TRUE);
    glue_ += map(cv_glue, 0, ADC_5V, -4000, 7000, MapClamp::TRUE);
    crush_ += map(cv_crush, 0, ADC_5V, -5000, 9000, MapClamp::TRUE);

    drive_ = constrain(drive_, 0, 32767);
    warmth_ = constrain(warmth_, 0, 32767);
    glue_ = constrain(glue_, 0, 32767);
    wow_ = constrain(wow_, 0, 32767);
    crush_ = constrain(crush_, 0, 32767);
    mix_ = constrain(mix_, 0, 32767);
    output_ = constrain(output_, 0, 32767);

    switch (mode_)
    {
    case Mode::WARM:
        Kastle2::hw.SetLed(Hardware::Led::LED_1, 255, 160, 80);
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 120, 80, 30);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, 0, 0, 0);
        break;

    case Mode::MASTER:
        Kastle2::hw.SetLed(Hardware::Led::LED_1, 100, 180, 255);
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 80, 120, 220);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, 90, 140, 255);
        break;

    case Mode::CRUSH:
        Kastle2::hw.SetLed(Hardware::Led::LED_1, 255, 70, 120);
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 220, 50, 90);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, 180, 30, 70);
        break;

    case Mode::BYPASS:
        Kastle2::hw.SetLed(Hardware::Led::LED_1, 160, 160, 160);
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 100, 100, 100);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, 70, 70, 70);
        break;

    default:
        break;
    }

    if (Kastle2::hw.JustReleased(Hardware::Button::MODE))
    {
        mode_ = static_cast<Mode>((static_cast<int>(mode_) + 1) % static_cast<int>(Mode::COUNT));
    }

    if (mode_ == Mode::BYPASS)
    {
        Kastle2::hw.SetLed(Hardware::Led::LED_1, 80, 80, 80);
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 80, 80, 80);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, 80, 80, 80);
    }
}
