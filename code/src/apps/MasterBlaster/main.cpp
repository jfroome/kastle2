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

#include "common/core/Kastle2.hpp"
#include "apps/MasterBlaster/AppMasterBlaster.hpp"

using namespace kastle2;

AppMasterBlaster app;

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
