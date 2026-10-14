// Host tests for the real MasterBlaster DSP (MasterBlasterDsp.cpp is compiled into this executable).

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <set>
#include <algorithm>
#include <vector>

#include "MasterBlasterDsp.hpp"

using namespace kastle2::masterblaster;

namespace
{
constexpr double kPi = 3.14159265358979323846;
constexpr double kSampleRate = 44000.0;

std::vector<int32_t> Sine(size_t frames, double freq, double amplitude, bool right_too = true)
{
    std::vector<int32_t> buffer(frames * 2);
    for (size_t i = 0; i < frames; i++)
    {
        const int32_t v = static_cast<int32_t>(amplitude * 32767.0 * std::sin(2.0 * kPi * freq * i / kSampleRate));
        buffer[2 * i] = v;
        buffer[2 * i + 1] = right_too ? v : 0;
    }
    return buffer;
}

// Runs the chain block by block (48 frames, like the firmware)
std::vector<int32_t> Run(Chain &chain, const std::vector<int32_t> &input)
{
    std::vector<int32_t> output(input.size());
    const size_t frames = input.size() / 2;
    for (size_t pos = 0; pos < frames; pos += 48)
    {
        const size_t n = (frames - pos < 48) ? frames - pos : 48;
        chain.Process(input.data() + 2 * pos, output.data() + 2 * pos, n);
    }
    return output;
}

// Everything off / neutral
Params Neutral()
{
    Params p;
    p.drive = 0;
    p.tone = 16384;
    p.comp = 0;
    p.vinyl = 0;
    p.wow = 0;
    p.lofi = 0;
    p.width = 16384;
    p.mix = kParamMax;
    p.output = 23170;
    p.bypass = false;
    return p;
}

int32_t Peak(const std::vector<int32_t> &buffer, size_t from)
{
    int32_t peak = 0;
    for (size_t i = from * 2; i < buffer.size(); i++)
    {
        peak = std::max(peak, std::abs(buffer[i]));
    }
    return peak;
}

#define CHECK(cond)                                                                \
    do                                                                             \
    {                                                                              \
        if (!(cond))                                                               \
        {                                                                          \
            std::fprintf(stderr, "FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);  \
            return 1;                                                              \
        }                                                                          \
    } while (0)

int TestBounds()
{
    // Fuzz parameter corners with a full-scale square-ish + sine signal
    std::vector<int32_t> input(2 * 8000);
    for (size_t i = 0; i < 8000; i++)
    {
        input[2 * i] = ((i / 40) % 2) ? 32767 : -32768;
        input[2 * i + 1] = static_cast<int32_t>(32767.0 * std::sin(i * 0.05));
    }
    uint32_t seed = 12345;
    for (int trial = 0; trial < 300; trial++)
    {
        Params p;
        int32_t *fields[] = {&p.drive, &p.tone,  &p.comp,   &p.comp_speed, &p.vinyl,
                             &p.wow,   &p.lofi,  &p.width,  &p.mix,        &p.output};
        for (int32_t *f : fields)
        {
            seed = seed * 1664525u + 1013904223u;
            const uint32_t pick = (seed >> 24) % 3;
            *f = pick == 0 ? 0 : (pick == 1 ? kParamMax : static_cast<int32_t>((seed >> 8) % 32768));
        }
        p.bypass = (trial % 7) == 0;
        Chain chain;
        chain.Init(p);
        const auto out = Run(chain, input);
        for (int32_t v : out)
        {
            CHECK(v >= -32768 && v <= 32767);
        }
    }
    return 0;
}

int TestSilence()
{
    Chain chain;
    chain.Init(Params());
    const auto out = Run(chain, std::vector<int32_t>(2 * 40000, 0));
    CHECK(Peak(out, 30000) <= 2); // the saturation bias is removed by the DC blocker

    // Vinyl adds hiss/crackle, but it must stay quiet
    Params p = Params();
    p.vinyl = kParamMax;
    chain.Init(p);
    const auto vinyl = Run(chain, std::vector<int32_t>(2 * 44000, 0));
    CHECK(Peak(vinyl, 0) > 0);
    CHECK(Peak(vinyl, 0) < 12000);
    return 0;
}

int TestTransparent()
{
    // All stages neutral: output is the input delayed by kLatencySamples
    Chain chain;
    chain.Init(Neutral());
    const auto input = Sine(30000, 1000.0, 0.5);
    const auto out = Run(chain, input);
    int32_t worst = 0;
    for (size_t i = 20000; i < 30000; i++)
    {
        worst = std::max(worst, std::abs(out[2 * i] - input[2 * (i - Chain::kLatencySamples)]));
    }
    CHECK(worst < 100); // ~0.5%, mostly the 3 Hz DC blocker phase lead
    return 0;
}

int TestMixDry()
{
    Params p = Params();
    p.mix = 0;
    p.drive = kParamMax;
    p.lofi = kParamMax;
    p.output = 23170;
    Chain chain;
    chain.Init(p);
    const auto input = Sine(6000, 700.0, 0.5);
    const auto out = Run(chain, input);
    int32_t worst = 0;
    for (size_t i = 3000; i < 6000; i++)
    {
        worst = std::max(worst, std::abs(out[2 * i] - input[2 * (i - Chain::kLatencySamples)]));
    }
    CHECK(worst < 60);
    return 0;
}

int TestDriveMonotonic()
{
    // More drive never makes the saturated stage (before makeup/limiter) lose level at low-mid settings
    int32_t previous = 0;
    for (int32_t drive = 0; drive <= 20000; drive += 2000)
    {
        Params p = Neutral();
        p.drive = drive;
        Chain chain;
        chain.Init(p);
        const auto out = Run(chain, Sine(8000, 220.0, 0.1));
        const int32_t peak = Peak(out, 2000);
        CHECK(peak + 50 >= previous);
        previous = peak;
    }
    CHECK(previous > 5000);

    // Hard drive generates harmonics: output of a sine is no longer a sine (flat-topped)
    Params p = Neutral();
    p.drive = kParamMax;
    Chain chain;
    chain.Init(p);
    const auto out = Run(chain, Sine(8000, 220.0, 0.9));
    int32_t flat = 0;
    const int32_t peak = Peak(out, 2000);
    for (size_t i = 2000; i < 8000; i++)
    {
        flat += std::abs(out[2 * i]) > peak * 9 / 10;
    }
    CHECK(flat > 1200); // a pure sine spends ~29% of its time above 90% of peak, a clipped one much more
    return 0;
}

int TestCompression()
{
    // Dynamic range between a loud and quiet tone shrinks as the compressor amount rises
    auto ratio_for = [](int32_t comp) {
        Params p = Neutral();
        p.comp = comp;
        p.comp_speed = kParamMax;
        Chain chain;
        chain.Init(p);
        const auto loud = Run(chain, Sine(20000, 300.0, 0.8));
        const double loud_peak = Peak(loud, 10000);
        chain.Init(p);
        const auto quiet = Run(chain, Sine(20000, 300.0, 0.05));
        const double quiet_peak = Peak(quiet, 10000);
        return loud_peak / quiet_peak;
    };
    const double off = ratio_for(0);
    const double mid = ratio_for(16000);
    const double hard = ratio_for(kParamMax);
    CHECK(off > 14.0 && off < 18.0);
    CHECK(mid < off * 0.8);
    CHECK(hard < mid);

    // Gain reduction meter reports the reduction, attack is faster than release
    Params p = Neutral();
    p.comp = kParamMax;
    Chain chain;
    chain.Init(p);
    Run(chain, Sine(8000, 300.0, 0.9));
    CHECK(chain.GetCompGain() < 28000);
    return 0;
}

int TestCompAttackRelease()
{
    // After a loud burst the gain recovers slowly with a slow setting and quickly with a fast one
    auto recovery = [](int32_t speed) {
        Params p = Neutral();
        p.comp = kParamMax;
        p.comp_speed = speed;
        Chain chain;
        chain.Init(p);
        Run(chain, Sine(8000, 300.0, 0.9));
        Run(chain, Sine(2200, 300.0, 0.01)); // 50 ms of quiet
        return chain.GetCompGain();
    };
    CHECK(recovery(kParamMax) > recovery(0));
    return 0;
}

int TestLofi()
{
    Params p = Neutral();
    p.lofi = kParamMax;
    Chain chain;
    chain.Init(p);
    const auto out = Run(chain, Sine(8000, 440.0, 0.5));
    // Bit depth reduced to 8 bits: low byte is always 0
    std::set<int32_t> levels;
    size_t distinct = 0;
    int32_t prev = 1 << 20;
    int32_t longest_run = 0, run = 0;
    for (size_t i = 3000; i < 8000; i++)
    {
        levels.insert(out[2 * i]);
        if (out[2 * i] != prev)
        {
            distinct++;
            run = 0;
        }
        else
        {
            longest_run = std::max(longest_run, ++run);
        }
        prev = out[2 * i];
    }
    CHECK(longest_run >= 5); // sample rate reduced (~1/8)
    CHECK(levels.size() <= 260); // 8 bit

    // Zero lofi is untouched
    p.lofi = 0;
    chain.Init(p);
    const auto clean = Run(chain, Sine(8000, 440.0, 0.5));
    std::set<int32_t> clean_levels;
    for (size_t i = 3000; i < 8000; i++)
    {
        clean_levels.insert(clean[2 * i]);
    }
    CHECK(clean_levels.size() > 1000);
    (void)distinct;
    return 0;
}

// Measures spread of zero-crossing periods of a sine (wow = pitch instability)
double CrossingSpread(const std::vector<int32_t> &buffer)
{
    std::vector<double> periods;
    double last = -1.0;
    for (size_t i = 2; i < buffer.size() / 2; i++)
    {
        if (buffer[2 * (i - 1)] < 0 && buffer[2 * i] >= 0)
        {
            const double t = i - static_cast<double>(buffer[2 * i]) / (buffer[2 * i] - buffer[2 * (i - 1)]);
            if (last >= 0)
            {
                periods.push_back(t - last);
            }
            last = t;
        }
    }
    double lo = 1e9, hi = -1e9;
    for (double p : periods)
    {
        lo = std::min(lo, p);
        hi = std::max(hi, p);
    }
    return periods.empty() ? 0.0 : hi - lo;
}

int TestWow()
{
    const auto input = Sine(88000, 880.0, 0.4);
    Params p = Neutral();
    Chain chain;
    chain.Init(p);
    const double steady = CrossingSpread(Run(chain, input));
    p.wow = kParamMax;
    chain.Init(p);
    const double wobbly = CrossingSpread(Run(chain, input));
    CHECK(steady < 0.2);
    CHECK(wobbly > steady + 0.3);
    CHECK(wobbly < 5.0); // musical, not seasick
    return 0;
}

int TestVinyl()
{
    // HF rolloff: a 10 kHz tone loses level with vinyl up
    Params p = Neutral();
    Chain chain;
    chain.Init(p);
    const int32_t open = Peak(Run(chain, Sine(8000, 10000.0, 0.4)), 4000);
    p.vinyl = kParamMax;
    chain.Init(p);
    const int32_t dull = Peak(Run(chain, Sine(8000, 10000.0, 0.4)), 4000);
    CHECK(dull < open * 3 / 4);
    return 0;
}

int TestWidth()
{
    // Mono signal is untouched by width, a one-sided signal collapses at width 0
    Params p = Neutral();
    p.width = 0;
    Chain chain;
    chain.Init(p);
    const auto mono = Run(chain, Sine(4000, 500.0, 0.3));
    for (size_t i = 2000; i < 4000; i++)
    {
        CHECK(std::abs(mono[2 * i] - mono[2 * i + 1]) <= 1);
    }
    chain.Init(p);
    const auto left_only = Run(chain, Sine(4000, 500.0, 0.3, false));
    for (size_t i = 2000; i < 4000; i++)
    {
        CHECK(std::abs(left_only[2 * i] - left_only[2 * i + 1]) <= 1);
    }

    // Wide: left-only gets a larger side component
    p.width = kParamMax;
    chain.Init(p);
    const auto wide = Run(chain, Sine(4000, 500.0, 0.3, false));
    CHECK(Peak(wide, 2000) > Peak(left_only, 2000));
    return 0;
}

int TestLimiter()
{
    Params p = Neutral();
    p.output = kParamMax;
    p.drive = kParamMax;
    Chain chain;
    chain.Init(p);
    const auto out = Run(chain, Sine(8000, 100.0, 1.0));
    CHECK(Peak(out, 100) <= Chain::kLimiterCeiling + 800);
    CHECK(chain.GetLimiterGain() < 32768);
    return 0;
}

int TestBypass()
{
    Params p = Params();
    p.drive = kParamMax;
    p.lofi = kParamMax;
    p.bypass = true;
    Chain chain;
    chain.Init(p);
    const auto input = Sine(12000, 500.0, 0.5);
    const auto out = Run(chain, input);
    // Faded fully to the delayed dry signal after ~2048 samples, no clicks while fading
    for (size_t i = 4000; i < 12000; i++)
    {
        CHECK(out[2 * i] == input[2 * (i - Chain::kLatencySamples)]);
    }
    CHECK(chain.GetBypassAmount() == 32768);

    // The crossfade never jumps more than the two paths do by themselves
    p.bypass = false;
    chain.Init(p);
    const auto processed = Run(chain, input);
    auto max_jump = [](const std::vector<int32_t> &b) {
        int32_t worst = 0;
        for (size_t i = 1; i < b.size() / 2; i++)
        {
            worst = std::max(worst, std::abs(b[2 * i] - b[2 * (i - 1)]));
        }
        return worst;
    };
    CHECK(max_jump(out) <= std::max(max_jump(processed), max_jump(input)) + 500);
    return 0;
}

int TestParamSweepNoClicks()
{
    // Sweeping a parameter block by block must not produce large sample jumps (zipper noise)
    Params p = Neutral();
    Chain chain;
    chain.Init(p);
    const auto input = Sine(48 * 400, 200.0, 0.3);
    std::vector<int32_t> out(input.size());
    for (size_t block = 0; block < 400; block++)
    {
        p.drive = static_cast<int32_t>(block * 80);
        p.output = 12000 + static_cast<int32_t>(block * 40);
        chain.SetParams(p);
        chain.Process(input.data() + block * 96, out.data() + block * 96, 48);
    }
    int32_t worst = 0;
    for (size_t i = 1; i < out.size() / 2; i++)
    {
        worst = std::max(worst, std::abs(out[2 * i] - out[2 * (i - 1)]));
    }
    CHECK(worst < 4000);
    return 0;
}

int TestMaps()
{
    CHECK(PotToParam(0, 4095) == 0);
    CHECK(PotToParam(4095, 4095) == kParamMax);
    CHECK(PotToParam(5000, 4095) == kParamMax);
    CHECK(PotToParam(-5, 4095) == 0);
    int32_t previous = -1;
    for (int32_t pot = 0; pot <= 4095; pot++)
    {
        const int32_t v = PotToParam(pot, 4095);
        CHECK(v >= previous);
        previous = v;
    }

    // Unpatched / 0 V CV leaves the knob alone at any position
    for (int32_t param = 0; param <= kParamMax; param += 1000)
    {
        CHECK(ApplyCv(param, 0, 4095) == param);
    }
    CHECK(ApplyCv(0, 4095, 4095) == kParamMax);
    CHECK(ApplyCv(10000, 2048, 4095) > 10000);
    CHECK(ApplyCv(10000, -4095, 4095) == 0);
    CHECK(ApplyCv(kParamMax, 4095, 4095) == kParamMax);
    return 0;
}

int TestBypassToggle()
{
    BypassToggle toggle;
    toggle.OnPress();
    CHECK(toggle.OnRelease());
    toggle.OnPress();
    toggle.OnKnobMoved();
    CHECK(!toggle.OnRelease());
    toggle.OnPress();
    CHECK(toggle.OnRelease());
    return 0;
}

struct TestCase
{
    const char *name;
    int (*fn)();
};

const TestCase kTests[] = {
    {"bounds", TestBounds},
    {"silence", TestSilence},
    {"transparent", TestTransparent},
    {"mix", TestMixDry},
    {"drive", TestDriveMonotonic},
    {"compression", TestCompression},
    {"comp_timing", TestCompAttackRelease},
    {"lofi", TestLofi},
    {"wow", TestWow},
    {"vinyl", TestVinyl},
    {"width", TestWidth},
    {"limiter", TestLimiter},
    {"bypass", TestBypass},
    {"sweep", TestParamSweepNoClicks},
    {"maps", TestMaps},
    {"bypass_toggle", TestBypassToggle},
};
} // namespace

int main(int argc, char **argv)
{
    int failures = 0;
    for (const TestCase &t : kTests)
    {
        if (argc > 1 && std::strcmp(argv[1], t.name) != 0)
        {
            continue;
        }
        const int rc = t.fn();
        std::printf("%-14s %s\n", t.name, rc == 0 ? "ok" : "FAILED");
        failures += rc != 0;
    }
    return failures == 0 ? 0 : 1;
}
