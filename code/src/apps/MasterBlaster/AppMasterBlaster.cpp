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
constexpr uint32_t kBootSnapMs = 600; // Pots settle during start-up, no need to fade that
}

void AppMasterBlaster::Init()
{
    inited_ = false;
    knobs_ = masterblaster::Params();
    chain_.Init();

    Kastle2::base.SetFeatureEnabled(Base::Feature::AUDIO_CHAIN, false);
    // Base would otherwise let the LFO modulate input/output gain
    Kastle2::base.SetFeatureEnabled(Base::Feature::LFO_MOD_MAPPING, false);

    first_ui_ms_ = 0;
    for (auto &glide : glides_)
    {
        glide = masterblaster::KnobGlide();
    }

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
        for (size_t i = 0; i < 2 * size; i++)
        {
            output[i] = 0;
        }
        return;
    }
    chain_.Process(input, output, size);
}

bool AppMasterBlaster::ReadParam(int32_t &param, Hardware::Pot pot, Hardware::Layer layer)
{
    int32_t value = 0;
    if (!Kastle2::hw.ReadPot(&value, pot, layer))
    {
        return false;
    }
    param = masterblaster::PotToParam(value, POT_MAX);
    return true;
}

masterblaster::SwitchPosition AppMasterBlaster::ReadSwitch(Hardware::AnalogInput feed,
                                                           masterblaster::SwitchDebouncer &debouncer)
{
    using Position = masterblaster::SwitchPosition;
    Position reading = Position::MIDDLE;
    switch (Kastle2::hw.GetFeedValue(feed))
    {
    case Hardware::FeedValue::HIGH:
        reading = Position::UP;
        break;
    case Hardware::FeedValue::LOW:
        reading = Position::DOWN;
        break;
    default:
        break;
    }
    return debouncer.Update(reading, to_ms_since_boot(get_absolute_time()));
}

void AppMasterBlaster::UiLoop()
{
    using Layer = Hardware::Layer;
    using Pot = Hardware::Pot;

    // Pots keep their last value when their layer isn't active (ReadPot returns false)
    ReadParam(knobs_.drive, Pot::POT_1, Layer::NORMAL);
    ReadParam(knobs_.tone, Pot::POT_2, Layer::NORMAL);
    ReadParam(knobs_.comp, Pot::POT_3, Layer::NORMAL);
    ReadParam(knobs_.vinyl, Pot::POT_4, Layer::NORMAL);
    ReadParam(knobs_.lofi, Pot::POT_5, Layer::NORMAL);
    ReadParam(knobs_.mix, Pot::POT_6, Layer::NORMAL);
    ReadParam(knobs_.output, Pot::POT_7, Layer::NORMAL);

    // SHIFT: K1, K3, K5, K7 belong to Base (input gain, rhythm, output gain, tempo)
    ReadParam(knobs_.comp_speed, Pot::POT_2, Layer::SHIFT);
    ReadParam(knobs_.wow, Pot::POT_4, Layer::SHIFT);
    ReadParam(knobs_.width, Pot::POT_6, Layer::SHIFT);

    // The two 3-pole switches (silkscreened INV CV / INV GATE) choose the vinyl noise and the wow speed
    knobs_.noise_type = masterblaster::NoiseTypeFromSwitch(ReadSwitch(Hardware::AnalogInput::FEED_3, noise_switch_));
    knobs_.wow_speed = masterblaster::WowSpeedFromSwitch(ReadSwitch(Hardware::AnalogInput::FEED_1, wow_switch_));

    // MODE button toggles bypass unless it was used to reach a MODE layer knob
    if (Kastle2::hw.JustPressed(Hardware::Button::MODE))
    {
        bypass_toggle_.OnPress();
    }
    int32_t unused = 0;
    for (Pot pot : EnumRange<Pot>())
    {
        if (Kastle2::hw.ReadPot(&unused, pot, Layer::MODE))
        {
            bypass_toggle_.OnKnobMoved();
        }
    }
    if (Kastle2::hw.JustReleased(Hardware::Button::MODE) && bypass_toggle_.OnRelease())
    {
        knobs_.bypass = !knobs_.bypass;
    }

    // Knob jumps glide instead of snapping. This is done on the knob values only, before CV is added, so CV
    // modulation is not slowed down. The first moments after boot snap to the pot positions.
    const uint32_t now = to_ms_since_boot(get_absolute_time());
    if (first_ui_ms_ == 0)
    {
        first_ui_ms_ = now == 0 ? 1 : now;
    }
    const bool glide = now - first_ui_ms_ > kBootSnapMs;
    masterblaster::Params smoothed = knobs_;
    int32_t *const parameters[] = {&smoothed.drive, &smoothed.tone,  &smoothed.comp, &smoothed.comp_speed,
                                   &smoothed.vinyl, &smoothed.wow,   &smoothed.lofi, &smoothed.width,
                                   &smoothed.mix,   &smoothed.output};
    for (size_t i = 0; i < 10; i++)
    {
        *parameters[i] = glides_[i].Update(*parameters[i], now, glide);
    }

    // CV: 0 V (or unpatched) leaves the knob untouched
    const int32_t adc_5v = ADC_5V;
    masterblaster::Params effective = smoothed;
    effective.drive = masterblaster::ApplyCv(
        smoothed.drive, Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_1), adc_5v);
    effective.comp = masterblaster::ApplyCv(
        smoothed.comp, Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_2), adc_5v);
    effective.lofi = masterblaster::ApplyCv(
        smoothed.lofi, Kastle2::hw.GetAnalogValue(Hardware::AnalogInput::PARAM_3), adc_5v);
    chain_.SetParams(effective);

    // LED 1 is the input level meter from Base. LED 2: compressor gain reduction. LED 3: limiter / bypass.
    if (knobs_.bypass)
    {
        Kastle2::hw.SetLed(Hardware::Led::LED_2, 40, 40, 40);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, 40, 40, 40);
    }
    else
    {
        const int32_t reduction = 32768 - chain_.GetCompGain();
        const int32_t limiting = 32768 - chain_.GetLimiterGain();
        Kastle2::hw.SetLed(Hardware::Led::LED_2, static_cast<uint8_t>(constrain(20 + (reduction >> 7), 0, 255)),
                           static_cast<uint8_t>(constrain(10 + (reduction >> 9), 0, 255)), 0);
        Kastle2::hw.SetLed(Hardware::Led::LED_3, static_cast<uint8_t>(constrain(limiting >> 5, 0, 255)), 0,
                           static_cast<uint8_t>(effective.mix >> 9));
    }
}
