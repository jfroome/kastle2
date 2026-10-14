// Mirrors code/src/apps/WaveBard/main.cpp
#include "AppWaveBard.hpp"
#include "common/core/Kastle2.hpp"
#include "common/testmode/VersionChainGenerator.hpp"
#include "version_samples_app.hpp"

using namespace kastle2;

static AppWaveBard app;

static void process_audio(q15_t *input, q15_t *output, size_t size) { app.AudioLoop(input, output, size); }
static void second_core() { app.SecondCoreWorker(); }
static void midi_callback(midi::Message *msg) { app.MidiCallback(msg); }

void fw_app_boot()
{
    Kastle2::Init(VersionChainGenerator::Generate(version::wave_bard, "draft"));
    Kastle2::RegisterApp(&app);
    app.Init();
    Kastle2::StartSecondCore(second_core);
    Kastle2::StartAudio(process_audio);
    Kastle2::SetAppMidiCallback(midi_callback);
}
void fw_app_ui() { app.UiLoop(); }
const char *fw_app_name() { return "WaveBard"; }
