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

#include "common/core/Kastle2.hpp"
#include "apps/Beads/AppBeads.hpp"

using namespace kastle2;

AppBeads app;

static void process_audio(q15_t *input, q15_t *output, size_t size)
{
    app.AudioLoop(input, output, size);
}

static void midi_callback(midi::Message *msg)
{
    app.MidiCallback(msg);
}

int main()
{
    Kastle2::Init();
    Kastle2::RegisterApp(&app);
    app.Init();
    Kastle2::StartAudio(process_audio);
    Kastle2::SetAppMidiCallback(midi_callback);

    while (true)
    {
        Kastle2::ReadInputs();
        app.UiLoop();
    }

    return 0;
}
