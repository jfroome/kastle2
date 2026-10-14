// Mirrors code/src/apps/ExampleSynth/main.cpp
#include "apps/ExampleSynth/AppExampleSynth.hpp"
#include "common/core/Kastle2.hpp"
#include "common/testmode/VersionChainGenerator.hpp"
#include "version_samples_app.hpp"

using namespace kastle2;

static AppExampleSynth app;

static void process_audio(q15_t *input, q15_t *output, size_t size) { app.AudioLoop(input, output, size); }

void fw_app_boot()
{
    Kastle2::Init(VersionChainGenerator::Generate(version::example_synthesizer, "draft"));
    Kastle2::RegisterApp(&app);
    app.Init();
    Kastle2::StartAudio(process_audio);
}
void fw_app_ui() { app.UiLoop(); }
const char *fw_app_name() { return "ExampleSynth"; }
