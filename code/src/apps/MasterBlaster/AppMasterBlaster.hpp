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

#pragma once

#include <cstddef>
#include <cstdint>
#include "common/core/App.hpp"
#include "common/core/Hardware.hpp"
#include "common/core/Kastle2.hpp"
#include "common/dsp/math/qmath.hpp"
#include "MasterBlasterDsp.hpp"

namespace kastle2
{

/**
 * @brief Mastering chain: saturation -> tone -> bus compressor -> vinyl -> lo-fi -> width -> mix -> limiter.
 * See MasterBlaster.md for the control map.
 */
class AppMasterBlaster : public virtual App
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
        return 0x31;
    }

private:
    bool ReadParam(int32_t &param, Hardware::Pot pot, Hardware::Layer layer);

    bool inited_ = false;
    masterblaster::Chain chain_;
    masterblaster::Params knobs_; // Knob positions, CV is added on top
    masterblaster::BypassToggle bypass_toggle_;
};

}
