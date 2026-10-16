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

#pragma once

#include <cstddef>
#include <cstdint>
#include "common/core/App.hpp"
#include "common/core/Hardware.hpp"
#include "common/core/Kastle2.hpp"
#include "common/dsp/math/qmath.hpp"
#include "BeadsDsp.hpp"

namespace kastle2
{

/**
 * @brief Texture synthesizer after Mutable Instruments' Beads: a granular delay with feedback, reverb and four
 *        recording qualities. See Beads.md for the control map.
 */
class AppBeads : public virtual App
{
public:
    void Init();
    void DeInit();
    FASTCODE void AudioLoop(q15_t *input, q15_t *output, size_t size);
    void UiLoop();
    void MemoryInitialization() {}
    void MidiCallback(midi::Message *msg) override {}

    uint8_t GetId()
    {
        return 0x32;
    }

private:
    bool ReadKnob(int32_t &value, Hardware::Pot pot, Hardware::Layer layer);
    uint32_t NowMs() const;

    bool inited_ = false;
    beads::Engine engine_;
    beads::Params knobs_;

    // Hidden-layer knobs that aren't plain parameters
    int32_t quality_knob_ = 3 * 8192 + 4096;
    int32_t seed_knob_ = 0;
    int32_t assign_knob_ = 0;

    beads::CvPresence presence_[5];
    beads::TapDetector freeze_tap_;
    beads::TapDetector seed_tap_;
    bool freeze_toggle_ = false;
    uint32_t seed_pulse_until_ms_ = 0;
    uint32_t flash_until_ms_ = 0;
};

}
