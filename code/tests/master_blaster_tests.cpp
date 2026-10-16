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


// ---- front-panel switches

int TestSwitchMapping()
{
    CHECK(NoiseTypeFromSwitch(SwitchPosition::UP) == NoiseType::LOW_PITCH);
    CHECK(NoiseTypeFromSwitch(SwitchPosition::MIDDLE) == NoiseType::HIGH_PITCH);
    CHECK(NoiseTypeFromSwitch(SwitchPosition::DOWN) == NoiseType::OFF);
    CHECK(WowSpeedFromSwitch(SwitchPosition::UP) == WowSpeed::SLOW);
    CHECK(WowSpeedFromSwitch(SwitchPosition::MIDDLE) == WowSpeed::MEDIUM);
    CHECK(WowSpeedFromSwitch(SwitchPosition::DOWN) == WowSpeed::FAST);
    // A default Params matches the middle switch positions, so an unpatched module sounds like before
    Params p;
    CHECK(p.noise_type == NoiseTypeFromSwitch(SwitchPosition::MIDDLE));
    CHECK(p.wow_speed == WowSpeedFromSwitch(SwitchPosition::MIDDLE));
    return 0;
}

int TestSwitchDebounce()
{
    SwitchDebouncer d;
    // The first reading is taken at once
    CHECK(d.Update(SwitchPosition::UP, 1000) == SwitchPosition::UP);
    // A change must hold for kStableMs
    CHECK(d.Update(SwitchPosition::DOWN, 1010) == SwitchPosition::UP);
    CHECK(d.Update(SwitchPosition::DOWN, 1040) == SwitchPosition::UP);
    CHECK(d.Update(SwitchPosition::DOWN, 1010 + SwitchDebouncer::kStableMs) == SwitchPosition::DOWN);
    // A patched signal that keeps flipping never changes the result
    for (uint32_t t = 2000; t < 4000; t += 10)
    {
        const SwitchPosition reading = (t / 10) % 2 ? SwitchPosition::UP : SwitchPosition::MIDDLE;
        CHECK(d.Update(reading, t) == SwitchPosition::DOWN);
    }
    // A glitch that goes back is ignored
    CHECK(d.Update(SwitchPosition::MIDDLE, 5000) == SwitchPosition::DOWN);
    CHECK(d.Update(SwitchPosition::DOWN, 5020) == SwitchPosition::DOWN);
    CHECK(d.Update(SwitchPosition::DOWN, 5100) == SwitchPosition::DOWN);
    return 0;
}

struct NoiseStats
{
    double rms;
    double brightness; ///< rms of the first difference over rms: grows with high frequencies
    int32_t peak;
};

NoiseStats MeasureNoise(NoiseType type, int32_t vinyl)
{
    Params p = Neutral();
    p.vinyl = vinyl;
    p.noise_type = type;
    Chain chain;
    chain.Init(p);
    const auto out = Run(chain, std::vector<int32_t>(2 * 88000, 0));
    double sum = 0, diff = 0;
    int32_t peak = 0;
    size_t count = 0;
    for (size_t i = 44000; i < 88000; i++)
    {
        const double x = out[2 * i];
        const double dx = x - out[2 * (i - 1)];
        sum += x * x;
        diff += dx * dx;
        peak = std::max(peak, std::abs(out[2 * i]));
        count++;
    }
    const double rms = std::sqrt(sum / count);
    return {rms, rms > 0 ? std::sqrt(diff / count) / rms : 0.0, peak};
}

int TestNoiseTypes()
{
    // Hiss only (no crackle: a mid-low vinyl amount keeps pops rare enough to ignore in the brightness figure)
    const NoiseStats high = MeasureNoise(NoiseType::HIGH_PITCH, 20000);
    const NoiseStats low = MeasureNoise(NoiseType::LOW_PITCH, 20000);
    const NoiseStats off = MeasureNoise(NoiseType::OFF, kParamMax);
    std::printf("noise: high rms %.1f bright %.2f | low rms %.1f bright %.2f | off peak %d\n", high.rms, high.brightness,
                low.rms, low.brightness, off.peak);
    CHECK(off.peak == 0);
    CHECK(high.rms > 5.0);
    CHECK(low.rms > 5.0);
    CHECK(high.brightness > 1.0);
    CHECK(low.brightness < 0.5);
    CHECK(high.brightness > low.brightness * 3.0);
    // Comparable loudness (within about 6 dB) so the switch changes the colour, not the level
    CHECK(low.rms < high.rms * 2.0 && low.rms > high.rms * 0.5);
    // Stays bounded at the maximum vinyl amount
    CHECK(MeasureNoise(NoiseType::LOW_PITCH, kParamMax).peak < 12000);
    CHECK(MeasureNoise(NoiseType::HIGH_PITCH, kParamMax).peak < 12000);
    return 0;
}

int TestNoiseSwitchLive()
{
    // Flipping the switch during playback fades the noise out, and back in, without leaving junk behind
    Params p = Neutral();
    p.vinyl = kParamMax;
    Chain chain;
    chain.Init(p);
    Run(chain, std::vector<int32_t>(2 * 22000, 0));
    p.noise_type = NoiseType::OFF;
    chain.SetParams(p);
    const auto faded = Run(chain, std::vector<int32_t>(2 * 22000, 0));
    CHECK(Peak(faded, 20000) == 0);
    p.noise_type = NoiseType::LOW_PITCH;
    chain.SetParams(p);
    const auto back = Run(chain, std::vector<int32_t>(2 * 22000, 0));
    CHECK(Peak(back, 10000) > 20);
    CHECK(Peak(back, 0) < 12000);
    return 0;
}

// Magnitude of the pitch deviation (zero-crossing period of a sine) at one modulation frequency
double DeviationAt(const std::vector<double> &times, const std::vector<double> &periods, double freq_hz)
{
    double c = 0, s = 0, mean = 0;
    for (double p : periods)
    {
        mean += p;
    }
    mean /= periods.size();
    for (size_t i = 0; i < periods.size(); i++)
    {
        const double phase = 2.0 * kPi * freq_hz * times[i] / kSampleRate;
        c += (periods[i] - mean) * std::cos(phase);
        s += (periods[i] - mean) * std::sin(phase);
    }
    return std::sqrt(c * c + s * s) / periods.size();
}

double WowSpeedDominantHz(WowSpeed speed, double *spread_out = nullptr)
{
    Params p = Neutral();
    p.wow = kParamMax;
    p.wow_speed = speed;
    Chain chain;
    chain.Init(p);
    const auto out = Run(chain, Sine(44000 * 24, 880.0, 0.4));
    std::vector<double> times, periods;
    double last = -1.0;
    for (size_t i = 44000 * 2; i < out.size() / 2; i++)
    {
        if (out[2 * (i - 1)] < 0 && out[2 * i] >= 0)
        {
            const double t = i - static_cast<double>(out[2 * i]) / (out[2 * i] - out[2 * (i - 1)]);
            if (last >= 0)
            {
                times.push_back(t);
                periods.push_back(t - last);
            }
            last = t;
        }
    }
    if (spread_out)
    {
        double lo = 1e9, hi = -1e9;
        for (double v : periods)
        {
            lo = std::min(lo, v);
            hi = std::max(hi, v);
        }
        *spread_out = hi - lo;
    }
    double best = 0, best_hz = 0;
    for (double hz = 0.1; hz < 2.0; hz += 0.02) // the wow band, flutter is faster
    {
        const double m = DeviationAt(times, periods, hz);
        if (m > best)
        {
            best = m;
            best_hz = hz;
        }
    }
    return best_hz;
}

int TestWowSpeeds()
{
    double slow_spread = 0, medium_spread = 0, fast_spread = 0;
    const double slow = WowSpeedDominantHz(WowSpeed::SLOW, &slow_spread);
    const double medium = WowSpeedDominantHz(WowSpeed::MEDIUM, &medium_spread);
    const double fast = WowSpeedDominantHz(WowSpeed::FAST, &fast_spread);
    std::printf("wow speeds: slow %.2f Hz (spread %.2f), medium %.2f Hz (%.2f), fast %.2f Hz (%.2f)\n", slow, slow_spread,
                medium, medium_spread, fast, fast_spread);
    CHECK(slow > 0.15 && slow < 0.35);
    CHECK(medium > 0.5 && medium < 0.7);
    CHECK(fast > 1.1 && fast < 1.5);
    // The depth is backed off for the fast setting, so no speed is wildly more detuned than another
    CHECK(slow_spread < 5.0 && medium_spread < 5.0 && fast_spread < 5.0);
    CHECK(fast_spread < medium_spread * 2.0 && slow_spread > 0.1);
    return 0;
}

int TestWowSpeedOffStaysSteady()
{
    // With the wow knob at zero none of the speeds adds any wobble
    for (WowSpeed speed : {WowSpeed::SLOW, WowSpeed::MEDIUM, WowSpeed::FAST})
    {
        Params p = Neutral();
        p.wow_speed = speed;
        Chain chain;
        chain.Init(p);
        CHECK(CrossingSpread(Run(chain, Sine(88000, 880.0, 0.4))) < 0.2);
    }
    return 0;
}

// ---- knob glide

int TestKnobGlide()
{
    // First value and allow_glide=false snap
    KnobGlide g;
    CHECK(g.Update(5000, 100) == 5000);
    CHECK(g.Update(30000, 110, false) == 30000);
    CHECK(!g.IsGliding());

    // Turning a knob normally tracks it exactly, with no lag
    int32_t v = 30000;
    uint32_t t = 200;
    for (int i = 0; i < 100; i++)
    {
        v -= 100;
        t += 2;
        CHECK(g.Update(v, t) == v);
    }
    CHECK(!g.IsGliding());

    // A jump (pick-up in another layer) glides over kGlideMs: monotonic, eased, ends exactly on the target
    const int32_t from = v;
    const int32_t to = 2000;
    int32_t previous = g.Update(to, t + 2);
    CHECK(g.IsGliding());
    CHECK(previous > to && previous <= from);
    CHECK(from - previous < (from - to) / 50); // starts slowly
    int32_t halfway = 0;
    for (uint32_t dt = 4; dt < KnobGlide::kGlideMs; dt += 2)
    {
        const int32_t now_value = g.Update(to, t + dt);
        CHECK(now_value <= previous);
        CHECK(now_value >= to);
        previous = now_value;
        if (dt == 126) // dt counts from the first update, which is 2 ms after t
        {
            halfway = now_value;
        }
    }
    CHECK(std::abs(halfway - (from + to) / 2) < (from - to) / 20);
    CHECK(g.Update(to, t + 2 + KnobGlide::kGlideMs) == to);
    CHECK(!g.IsGliding());

    // A knob moved a little while gliding drags the end point along
    KnobGlide h;
    h.Update(0, 0);
    h.Update(20000, 10);
    h.Update(20500, 100);
    CHECK(h.Update(21000, 260) == 21000);

    // A second jump during a glide restarts from the current value (no snap)
    KnobGlide k;
    k.Update(0, 0);
    k.Update(30000, 10);
    const int32_t mid = k.Update(30000, 100);
    const int32_t restarted = k.Update(0, 102);
    CHECK(std::abs(restarted - mid) < 800);
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
    {"switch_map", TestSwitchMapping},
    {"switch_debounce", TestSwitchDebounce},
    {"noise_types", TestNoiseTypes},
    {"noise_live", TestNoiseSwitchLive},
    {"wow_speeds", TestWowSpeeds},
    {"wow_steady", TestWowSpeedOffStaysSteady},
    {"knob_glide", TestKnobGlide},
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
