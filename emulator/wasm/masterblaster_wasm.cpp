// Freestanding WebAssembly wrapper around the real MasterBlaster firmware DSP.
// The emulator drives this exact code (no JS re-implementation).

#include "MasterBlasterDsp.hpp"

#include <cstddef>
#include <cstdint>

using namespace kastle2::masterblaster;

#define EXPORT extern "C" __attribute__((visibility("default")))

namespace
{
constexpr int kMaxFrames = 4096;

Chain g_chain;
int16_t g_in[2 * kMaxFrames];
int16_t g_out[2 * kMaxFrames];

Params MakeParams(int drive, int tone, int comp, int comp_speed, int vinyl, int wow, int lofi, int width, int mix,
                  int output, int bypass)
{
    Params p;
    p.drive = drive;
    p.tone = tone;
    p.comp = comp;
    p.comp_speed = comp_speed;
    p.vinyl = vinyl;
    p.wow = wow;
    p.lofi = lofi;
    p.width = width;
    p.mix = mix;
    p.output = output;
    p.bypass = bypass != 0;
    return p;
}
} // namespace

EXPORT int mb_max_frames()
{
    return kMaxFrames;
}

EXPORT int mb_latency_samples()
{
    return Chain::kLatencySamples;
}

EXPORT int16_t *mb_input_ptr()
{
    return g_in;
}

EXPORT int16_t *mb_output_ptr()
{
    return g_out;
}

EXPORT void mb_init()
{
    g_chain.Init();
}

EXPORT void mb_init_with(int drive, int tone, int comp, int comp_speed, int vinyl, int wow, int lofi, int width,
                         int mix, int output, int bypass)
{
    g_chain.Init(MakeParams(drive, tone, comp, comp_speed, vinyl, wow, lofi, width, mix, output, bypass));
}

EXPORT void mb_set_params(int drive, int tone, int comp, int comp_speed, int vinyl, int wow, int lofi, int width,
                          int mix, int output, int bypass)
{
    g_chain.SetParams(MakeParams(drive, tone, comp, comp_speed, vinyl, wow, lofi, width, mix, output, bypass));
}

// Processes `frames` interleaved stereo frames from the input buffer into the output buffer.
EXPORT void mb_process(int frames)
{
    if (frames < 0)
    {
        frames = 0;
    }
    if (frames > kMaxFrames)
    {
        frames = kMaxFrames;
    }
    g_chain.Process(g_in, g_out, static_cast<size_t>(frames));
}

EXPORT int mb_comp_gain()
{
    return g_chain.GetCompGain();
}

EXPORT int mb_limiter_gain()
{
    return g_chain.GetLimiterGain();
}

EXPORT int mb_bypass_amount()
{
    return g_chain.GetBypassAmount();
}

EXPORT int mb_pot_to_param(int pot_value, int pot_max)
{
    return PotToParam(pot_value, pot_max);
}

EXPORT int mb_apply_cv(int param, int cv_adc, int adc_5v)
{
    return ApplyCv(param, cv_adc, adc_5v);
}
