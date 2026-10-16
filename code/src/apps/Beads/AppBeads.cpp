/*
MIT License

Copyright (c) 2026 Bastl Instruments (Kastle 2 integration)

Portions are a fixed-point re-implementation of the signal flow and parameter laws of "Beads" by
Emilie Gillet / Mutable Instruments, Copyright 2017-2021 Emilie Gillet, MIT licensed
(https://github.com/pichenettes/eurorack/tree/master/beads). No code was copied from it: the original uses
single-precision floats, a 768 KB delay and 32 grains, which the RP2040 (no FPU, 240 KB RAM) can't run.

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

#include "AppBeads.hpp"
#include "common/core/Kastle2.hpp"
#include "common/utils.hpp"

using namespace kastle2;

void AppBeads::Init()
{
    inited_ = false;
    knobs_ = beads::Params();
    engine_.Init(knobs_);

    // We do the dry/wet ourselves, and Base would otherwise let the LFO modulate gains
    Kastle2::base.SetFeatureEnabled(Base::Feature::AUDIO_CHAIN, false);
    Kastle2::base.SetFeatureEnabled(Base::Feature::LFO_MOD_MAPPING, false);

    inited_ = true;
}

void AppBeads::DeInit()
{
    inited_ = false;
}

FASTCODE void AppBeads::AudioLoop(q15_t *input, q15_t *output, size_t size)
{
    if (!inited_)
    {
        for (size_t i = 0; i < 2 * size; i++)
        {
            output[i] = 0;
        }
        return;
    }
    engine_.Process(input, output, size);
}

uint32_t AppBeads::NowMs() const
{
    return to_ms_since_boot(get_absolute_time());
}

bool AppBeads::ReadKnob(int32_t &value, Hardware::Pot pot, Hardware::Layer layer)
{
    int32_t raw = 0;
    if (!Kastle2::hw.ReadPot(&raw, pot, layer))
    {
        return false;
    }
    value = beads::Clamp(static_cast<int32_t>((static_cast<int64_t>(raw) * beads::kParamMax) / POT_MAX), 0,
                         beads::kParamMax);
    return true;
}

void AppBeads::UiLoop()
{
    using Layer = Hardware::Layer;
    using Pot = Hardware::Pot;
    const uint32_t now = NowMs();

    // Pots keep their last value when their layer isn't active (ReadPot returns false)
    // NORMAL: the five main parameters and two of the three mix controls
    ReadKnob(knobs_.time, Pot::POT_1, Layer::NORMAL);
    ReadKnob(knobs_.size, Pot::POT_2, Layer::NORMAL);
    ReadKnob(knobs_.shape, Pot::POT_3, Layer::NORMAL);
    ReadKnob(knobs_.density, Pot::POT_4, Layer::NORMAL);
    ReadKnob(knobs_.pitch, Pot::POT_5, Layer::NORMAL);
    ReadKnob(knobs_.dry_wet, Pot::POT_6, Layer::NORMAL);
    ReadKnob(knobs_.reverb, Pot::POT_7, Layer::NORMAL);

    // SHIFT: K1, K3, K5, K7 belong to Base (input gain, rhythm, output gain, tempo)
    if (ReadKnob(quality_knob_, Pot::POT_2, Layer::SHIFT))
    {
        knobs_.media = beads::MediaFromKnob(quality_knob_);
    }
    ReadKnob(knobs_.feedback, Pot::POT_6, Layer::SHIFT);

    // MODE: attenuverters, seed mode and the assignable CV destination (K7 belongs to Base)
    ReadKnob(knobs_.time_amt, Pot::POT_1, Layer::MODE);
    ReadKnob(knobs_.size_amt, Pot::POT_2, Layer::MODE);
    ReadKnob(knobs_.shape_amt, Pot::POT_3, Layer::MODE);
    if (ReadKnob(seed_knob_, Pot::POT_4, Layer::MODE))
    {
        knobs_.seed_locked = seed_knob_ < 16384;
    }
    ReadKnob(knobs_.pitch_amt, Pot::POT_5, Layer::MODE);
    ReadKnob(assign_knob_, Pot::POT_6, Layer::MODE);

    // Buttons. MODE tap = freeze, SHIFT tap = seed, unless the button was used to reach a knob
    int32_t unused = 0;
    for (Pot pot : EnumRange<Pot>())
    {
        if (Kastle2::hw.ReadPot(&unused, pot, Layer::MODE))
        {
            freeze_tap_.OnKnobMoved();
        }
        if (Kastle2::hw.ReadPot(&unused, pot, Layer::SHIFT))
        {
            seed_tap_.OnKnobMoved();
        }
    }
    if (Kastle2::hw.JustPressed(Hardware::Button::MODE))
    {
        freeze_tap_.OnPress(now);
    }
    if (Kastle2::hw.JustReleased(Hardware::Button::MODE) && freeze_tap_.OnRelease(now))
    {
        freeze_toggle_ = !freeze_toggle_;
    }
    if (Kastle2::hw.JustPressed(Hardware::Button::SHIFT))
    {
        seed_tap_.OnPress(now);
    }
    if (Kastle2::hw.JustReleased(Hardware::Button::SHIFT) && seed_tap_.OnRelease(now))
    {
        seed_pulse_until_ms_ = now + 60;
    }

    // CV. 0 V (or nothing patched) leaves the knobs alone
    const int32_t adc_5v = ADC_5V;
    const int32_t threshold = ADC_1V / 8;
    const int32_t adc_time = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_1);
    const int32_t adc_size = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_2);
    const int32_t adc_shape = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_3);
    const int32_t adc_density = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::MODE);
    const int32_t adc_pitch = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PITCH_1);
    const int32_t adc_assign = Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PITCH_2);
    presence_[0].Update(adc_time, threshold, now);
    presence_[1].Update(adc_size, threshold, now);
    presence_[2].Update(adc_shape, threshold, now);
    presence_[3].Update(adc_pitch, threshold, now);

    beads::Params effective = knobs_;
    effective.time_cv = beads::CvToQ15(adc_time, adc_5v);
    effective.size_cv = beads::CvToQ15(adc_size, adc_5v);
    effective.shape_cv = beads::CvToQ15(adc_shape, adc_5v);
    effective.density_cv = beads::CvToQ15(adc_density, adc_5v);
    effective.pitch_cv_semitones_q8 = beads::CvToSemitonesQ8(adc_pitch, ADC_1V);
    effective.time_has_cv = presence_[0].Present(now);
    effective.size_has_cv = presence_[1].Present(now);
    effective.shape_has_cv = presence_[2].Present(now);
    effective.pitch_has_cv = presence_[3].Present(now);
    beads::ApplyAssignCv(effective, beads::AssignDestinationFromKnob(assign_knob_), beads::CvToQ15(adc_assign, adc_5v));

    effective.freeze = freeze_toggle_ || Kastle2::hw.GetResetIn();
    effective.seed_gate = Kastle2::hw.GetTriggerIn() || now < seed_pulse_until_ms_;
    engine_.SetParams(effective);

    // LED 1 is the input level meter from Base. LED 2: freeze. LED 3: grains/taps, coloured by the recording quality
    if (effective.freeze)
    {
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 40, 120, 255);
    }
    else
    {
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 0, 0, 0);
    }
    if (engine_.TakeTriggerCount() > 0)
    {
        flash_until_ms_ = now + 50;
    }
    static constexpr uint8_t kMediaColors[4][3] = {{255, 90, 0}, {255, 200, 40}, {0, 200, 200}, {120, 120, 255}};
    const auto &c = kMediaColors[static_cast<int>(knobs_.media)];
    if (now < flash_until_ms_)
    {
        Kastle2::hw.SetLed(Hardware::Led::LED_3, c[0], c[1], c[2]);
    }
    else
    {
        Kastle2::hw.SetLed(Hardware::Led::LED_3, c[0] >> 4, c[1] >> 4, c[2] >> 4);
    }
}
