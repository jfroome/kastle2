// Mirrors code/src/apps/Template/main.cpp
#include "apps/Template/AppTemplate.hpp"
#include "common/core/Kastle2.hpp"

using namespace kastle2;

static AppTemplate app;

static void process_audio(q15_t *input, q15_t *output, size_t size) { app.AudioLoop(input, output, size); }
static void midi_callback(midi::Message *msg) { app.MidiCallback(msg); }

void fw_app_boot()
{
    Kastle2::Init();
    Kastle2::RegisterApp(&app);
    app.Init();
    Kastle2::StartAudio(process_audio);
    Kastle2::SetAppMidiCallback(midi_callback);
}
void fw_app_ui() { app.UiLoop(); }
const char *fw_app_name() { return "Template"; }
