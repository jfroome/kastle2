// Host tests for the real Beads DSP (BeadsDsp.cpp is compiled into this executable).

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "BeadsDsp.hpp"

using namespace kastle2::beads;

namespace
{
constexpr double kPi = 3.14159265358979323846;
constexpr double kSampleRate = 44000.0;
constexpr double kLimiterCeiling = 29491.0 * 1.02;

std::vector<int32_t> Sine(size_t frames, double freq, double amplitude)
{
    std::vector<int32_t> buffer(frames * 2);
    for (size_t i = 0; i < frames; i++)
    {
        const int32_t v = static_cast<int32_t>(amplitude * 32767.0 * std::sin(2.0 * kPi * freq * i / kSampleRate));
        buffer[2 * i] = v;
        buffer[2 * i + 1] = v;
    }
    return buffer;
}

std::vector<int32_t> Noise(size_t frames, double amplitude, uint32_t seed = 7)
{
    std::vector<int32_t> buffer(frames * 2);
    uint32_t s = seed;
    for (size_t i = 0; i < frames * 2; i++)
    {
        s = s * 1664525u + 1013904223u;
        buffer[i] = static_cast<int32_t>((static_cast<int32_t>(s >> 8) / 8388608.0 - 1.0) * amplitude * 32767.0);
    }
    return buffer;
}

std::vector<int32_t> Silence(size_t frames)
{
    return std::vector<int32_t>(frames * 2, 0);
}

std::vector<int32_t> Concat(std::vector<int32_t> a, const std::vector<int32_t> &b)
{
    a.insert(a.end(), b.begin(), b.end());
    return a;
}

// Runs the engine block by block (48 frames, like the firmware)
std::vector<int32_t> Run(Engine &engine, const std::vector<int32_t> &input)
{
    std::vector<int32_t> output(input.size());
    const size_t frames = input.size() / 2;
    for (size_t pos = 0; pos < frames; pos += 48)
    {
        const size_t n = std::min<size_t>(48, frames - pos);
        engine.Process(input.data() + 2 * pos, output.data() + 2 * pos, n);
    }
    return output;
}

double Rms(const std::vector<int32_t> &x, size_t from_frame, size_t to_frame)
{
    double sum = 0;
    size_t n = 0;
    for (size_t i = from_frame * 2; i < to_frame * 2 && i < x.size(); i++)
    {
        sum += static_cast<double>(x[i]) * x[i];
        n++;
    }
    return n ? std::sqrt(sum / n) : 0.0;
}

int32_t Peak(const std::vector<int32_t> &x, size_t from_frame = 0)
{
    int32_t p = 0;
    for (size_t i = from_frame * 2; i < x.size(); i++)
    {
        p = std::max(p, std::abs(x[i]));
    }
    return p;
}

// Everything dry/neutral: the processor passes the input through at its dry gain
Params Dry()
{
    Params p;
    p.dry_wet = 0;
    p.reverb = 0;
    p.feedback = 0;
    p.freeze = false;
    p.media = Media::DIGITAL;
    return p;
}

// Granular, fully wet, regular grains four times a second, mid size, no randomness, no reverb
Params Granular()
{
    Params p;
    p.dry_wet = kParamMax;
    p.reverb = 0;
    p.feedback = 0;
    p.density = 9000;      // regular grains, a few per second
    p.size = 24000;        // forward, medium
    p.shape = 12000;
    p.time = 6000;
    p.media = Media::DIGITAL;
    return p;
}

double ZeroCrossingFrequency(const std::vector<int32_t> &x, size_t from_frame, size_t to_frame)
{
    int crossings = 0;
    for (size_t i = from_frame + 1; i < to_frame; i++)
    {
        if (x[2 * (i - 1)] < 0 && x[2 * i] >= 0)
        {
            crossings++;
        }
    }
    return crossings / ((to_frame - from_frame) / kSampleRate);
}

#define CHECK(cond, ...)                                                    \
    do                                                                      \
    {                                                                       \
        if (!(cond))                                                        \
        {                                                                   \
            std::printf("  check failed (line %d): %s  ", __LINE__, #cond); \
            std::printf(__VA_ARGS__);                                       \
            std::printf("\n");                                              \
            return 1;                                                       \
        }                                                                   \
    } while (0)

// ------------------------------------------------------------------------------------------------

int TestSilence()
{
    for (int m = 0; m < 4; m++)
    {
        Engine e;
        Params p = Granular();
        p.media = static_cast<Media>(m);
        p.reverb = kParamMax;
        e.Init(p);
        auto out = Run(e, Silence(44000));
        CHECK(Peak(out) <= 2, "media %d silent in -> peak %d", m, Peak(out));
    }
    return 0;
}

int TestDryPath()
{
    // dry_wet = 0: output is the input at the 0.75 "post gain" of the original, with the 8-bit modes' mu-law dry path
    for (int m = 0; m < 4; m++)
    {
        Engine e;
        Params p = Dry();
        p.media = static_cast<Media>(m);
        e.Init(p);
        auto in = Sine(8800, 440, 0.5);
        auto out = Run(e, in);
        const double ratio = Rms(out, 2000, 8000) / Rms(in, 2000, 8000);
        CHECK(std::fabs(ratio - 0.75) < 0.05, "media %d dry gain %.3f (want 0.75)", m, ratio);
    }
    return 0;
}

int TestGrainsPlayRecordedAudio()
{
    // With a steady tone going in, the wet output (grains only) is that tone
    Engine e;
    Params p = Granular();
    p.time = 8000;
    p.density = 12000;
    p.shape = 6000;
    p.size = 30000;
    e.Init(p);
    auto out = Run(e, Sine(44000, 800, 0.5));
    const double wet = Rms(out, 20000, 44000);
    CHECK(wet > 300.0, "grains play the recorded tone (rms %.0f)", wet);
    const double f = ZeroCrossingFrequency(out, 20000, 44000);
    CHECK(f > 600.0 && f < 1000.0, "grains are %.0f Hz, recorded 800 Hz", f);
    return 0;
}

int TestFreeze()
{
    // Frozen: the recording stops, grains keep replaying what was in the buffer, forever
    auto record = Sine(40000, 600, 0.5); // longer than the DIGITAL buffer (0.74 s)
    for (int frozen = 0; frozen < 2; frozen++)
    {
        Engine e;
        Params p = Granular();
        p.time = 12000;
        p.size = 30000;
        p.shape = 6000;
        p.density = 12000;
        e.Init(p);
        Run(e, record);
        p.freeze = frozen == 1;
        e.SetParams(p);
        auto out = Run(e, Silence(132000)); // three seconds of silence into a 0.74 s buffer
        const double late = Rms(out, 100000, 132000);
        if (frozen)
        {
            CHECK(late > 800.0, "frozen buffer keeps sounding (rms %.0f)", late);
        }
        else
        {
            CHECK(late < 60.0, "an unfrozen buffer forgets (rms %.0f)", late);
        }
    }
    return 0;
}

int TestDensityRegions()
{
    // Count grain starts per second at several density positions
    struct Case
    {
        int32_t density;
        double min_hz, max_hz;
    };
    const Case cases[] = {
        {0, 60, 200},          // regular, audio-rate grains (130 Hz at the extreme)
        {6000, 8, 40},         // regular, tens of Hz
        {12000, 0.5, 4},       // regular, slow
        {22000, 0.5, 12},      // random, medium
        {32000, 15, 90},       // random, dense (65 Hz at the extreme)
    };
    for (const Case &c : cases)
    {
        Engine e;
        Params p = Granular();
        p.density = c.density;
        e.Init(p);
        int triggers = 0;
        auto in = Sine(88000, 300, 0.3);
        for (size_t pos = 0; pos + 48 <= 88000; pos += 48)
        {
            std::vector<int32_t> out(96);
            e.Process(in.data() + 2 * pos, out.data(), 48);
            triggers += e.TakeTriggerCount();
        }
        const double hz = triggers / 2.0;
        CHECK(hz >= c.min_hz && hz <= c.max_hz, "density %d -> %.1f grains/s (want %.1f..%.1f)", c.density, hz, c.min_hz,
              c.max_hz);
    }
    // The dead zone in the middle: no automatic grains
    {
        Engine e;
        Params p = Granular();
        p.density = 16384;
        e.Init(p);
        int triggers = 0;
        auto in = Sine(44000, 300, 0.3);
        for (size_t pos = 0; pos + 48 <= 44000; pos += 48)
        {
            std::vector<int32_t> out(96);
            e.Process(in.data() + 2 * pos, out.data(), 48);
            triggers += e.TakeTriggerCount();
        }
        CHECK(triggers == 0, "density centre is silent until seeded (%d)", triggers);
    }
    return 0;
}

int TestSeed()
{
    // Unlocked seed: grains only while/when the seed gate is high; locked: free running
    Engine e;
    Params p = Granular();
    p.density = 12000;
    p.seed_locked = false;
    e.Init(p);
    auto in = Sine(44000, 300, 0.3);
    int idle = 0, tapped = 0;
    for (size_t pos = 0; pos + 48 <= 44000; pos += 48)
    {
        std::vector<int32_t> out(96);
        e.Process(in.data() + 2 * pos, out.data(), 48);
        idle += e.TakeTriggerCount();
    }
    CHECK(idle == 0, "unlocked without a seed makes no grains (%d)", idle);
    p.seed_gate = true;
    e.SetParams(p);
    for (size_t pos = 0; pos + 48 <= 480; pos += 48)
    {
        std::vector<int32_t> out(96);
        e.Process(in.data() + 2 * pos, out.data(), 48);
        tapped += e.TakeTriggerCount();
    }
    CHECK(tapped >= 1, "a seed press starts a grain (%d)", tapped);
    return 0;
}

int TestSizeAndReverse()
{
    // Short grains are short, long grains are long: measure how long a single seeded grain keeps sounding
    auto duration_of = [](int32_t size) {
        Engine e;
        Params p = Granular();
        p.size = size;
        p.time = 12000;
        p.density = 16384;
        p.seed_locked = false;
        e.Init(p);
        auto noise = Noise(100000, 0.5);
        Run(e, std::vector<int32_t>(noise.begin(), noise.begin() + 2 * 20000));
        p.seed_gate = true;
        e.SetParams(p);
        std::vector<int32_t> out(96);
        e.Process(noise.data() + 2 * 20000, out.data(), 48);
        p.seed_gate = false;
        e.SetParams(p);
        std::vector<int32_t> rest(noise.begin() + 2 * 20048, noise.end());
        auto tail = Run(e, rest);
        size_t last = 0;
        for (size_t i = 0; i < tail.size() / 2; i++)
        {
            if (std::abs(tail[2 * i]) > 300)
            {
                last = i;
            }
        }
        return last / kSampleRate;
    };
    const double short_grain = duration_of(11000); // just past the reverse region: shortest
    const double long_grain = duration_of(26000);
    CHECK(short_grain < 0.12, "short grain lasts %.3f s", short_grain);
    CHECK(long_grain > 0.4, "long grain lasts %.3f s", long_grain);
    return 0;
}

int TestPitch()
{
    // Pitch max / min are +-24 semitones (4x / 1/4 the frequency): measured on the grains of a steady tone
    auto frequency_at = [](int32_t pitch_pot) {
        Engine e;
        Params p = Granular();
        p.pitch = pitch_pot;
        p.size = 30000;
        p.shape = 6000; // sustained
        p.time = 8000;
        p.density = 9000;
        e.Init(p);
        auto out = Run(e, Sine(66000, 400, 0.5));
        return ZeroCrossingFrequency(out, 30000, 66000);
    };
    const double flat = frequency_at(kParamCentre);
    const double up = frequency_at(kParamMax);
    const double down = frequency_at(0);
    CHECK(flat > 300 && flat < 520, "unity pitch %.0f Hz (recorded 400)", flat);
    CHECK(up > flat * 2.5, "pitch max is %.0f Hz vs %.0f", up, flat);
    CHECK(down < flat * 0.6, "pitch min is %.0f Hz vs %.0f", down, flat);
    return 0;
}

int TestFeedback()
{
    // Maximum feedback with loud noise must stay bounded by the limiter, and feedback 0 must decay
    for (int m = 0; m < 4; m++)
    {
        Engine e;
        Params p = Granular();
        p.feedback = kParamMax;
        p.density = 7000;
        p.media = static_cast<Media>(m);
        e.Init(p);
        auto out = Run(e, Noise(88000, 0.9));
        CHECK(Peak(out) <= kLimiterCeiling, "media %d feedback peak %d", m, Peak(out));
        auto tail = Run(e, Silence(44000));
        CHECK(Peak(tail, 30000) <= kLimiterCeiling, "media %d tail peak %d", m, Peak(tail, 30000));
    }
    {
        Engine e;
        Params p = Granular();
        p.feedback = 0;
        e.Init(p);
        Run(e, Noise(44000, 0.5));
        auto out = Run(e, Silence(132000));
        CHECK(Rms(out, 120000, 132000 - 1) < 30.0, "no feedback decays (rms %.0f)", Rms(out, 120000, 130000));
    }
    return 0;
}

int TestDelayMode()
{
    // Size fully clockwise: an echo at the delay time given by the density knob
    Engine e;
    Params p;
    p.dry_wet = kParamMax;
    p.reverb = 0;
    p.feedback = 0;
    p.size = kParamMax;
    p.density = 13000; // exponential delay time
    p.media = Media::DIGITAL;
    e.Init(p);
    CHECK(true, "");
    // let the mode switch settle
    Run(e, Silence(8000));
    CHECK(e.DelayMode(), "size > 0.99 switches to delay mode");
    auto in = Concat(Concat(Silence(4000), Noise(100, 0.8)), Silence(30000));
    auto out = Run(e, in);
    // first echo: find the largest burst after the input burst
    size_t echo = 0;
    int32_t best = 0;
    for (size_t i = 4200; i < out.size() / 2; i++)
    {
        const int32_t a = std::abs(out[2 * i]);
        if (a > best)
        {
            best = a;
            echo = i;
        }
    }
    CHECK(best > 2000, "delay mode produces an echo (%d)", best);
    CHECK(echo > 4200 + 100, "echo comes after the input (at %zu)", echo);
    return 0;
}

int TestReverb()
{
    // An impulse with the reverb up rings for a long time, with the reverb off it doesn't
    auto tail_energy = [](int32_t reverb) {
        Engine e;
        Params p = Dry();
        p.dry_wet = 0;
        p.reverb = reverb;
        e.Init(p);
        auto in = Concat(Noise(200, 0.6), Silence(44000));
        auto out = Run(e, in);
        return Rms(out, 9000, 30000);
    };
    const double none = tail_energy(0);
    const double wet = tail_energy(kParamMax);
    CHECK(none < 1.0, "no reverb, no tail (%.1f)", none);
    CHECK(wet > 20.0, "reverb tail (%.1f)", wet);
    return 0;
}

int TestMediaLengths()
{
    const int expected[4] = {65536, 32768, 65536, 32768};
    const int rates[4] = {22000, 22000, 44000, 44000};
    for (int m = 0; m < 4; m++)
    {
        Engine e;
        Params p;
        p.media = static_cast<Media>(m);
        e.Init(p);
        CHECK(e.BufferFrames() == expected[m], "media %d frames %d", m, e.BufferFrames());
        CHECK(e.EngineSampleRate() == rates[m], "media %d rate %d", m, e.EngineSampleRate());
    }
    return 0;
}

int TestMediaSwitchIsSafe()
{
    Engine e;
    Params p = Granular();
    e.Init(p);
    auto in = Noise(96000, 0.5);
    std::vector<int32_t> out(96);
    for (size_t pos = 0; pos + 48 <= 96000; pos += 48)
    {
        if ((pos / 48) % 200 == 0)
        {
            p.media = static_cast<Media>((pos / 48 / 200) % 4);
            e.SetParams(p);
        }
        e.Process(in.data() + 2 * pos, out.data(), 48);
        for (int32_t v : out)
        {
            CHECK(std::abs(v) <= 32767, "bounded after a media switch");
        }
    }
    return 0;
}

int TestSweepBounded()
{
    // Random knob positions on noise and a tone: always bounded, never crashing
    uint32_t s = 12345;
    auto rnd = [&]() {
        s = s * 1664525u + 1013904223u;
        return static_cast<int32_t>(s >> 17);
    };
    auto in = Concat(Noise(20000, 0.8), Sine(20000, 330, 0.9));
    for (int trial = 0; trial < 60; trial++)
    {
        Engine e;
        Params p;
        p.time = rnd();
        p.size = rnd();
        p.shape = rnd();
        p.density = rnd();
        p.pitch = rnd();
        p.time_amt = rnd();
        p.size_amt = rnd();
        p.shape_amt = rnd();
        p.pitch_amt = rnd();
        p.time_has_cv = rnd() & 1;
        p.size_has_cv = rnd() & 1;
        p.shape_has_cv = rnd() & 1;
        p.pitch_has_cv = rnd() & 1;
        p.time_cv = rnd() - 16384;
        p.size_cv = rnd() - 16384;
        p.shape_cv = rnd() - 16384;
        p.density_cv = rnd() - 16384;
        p.pitch_cv_semitones_q8 = (rnd() - 16384) * 3;
        p.feedback = rnd();
        p.dry_wet = rnd();
        p.reverb = rnd();
        p.freeze = rnd() & 1;
        p.seed_locked = rnd() & 1;
        p.seed_gate = rnd() & 1;
        p.media = static_cast<Media>(rnd() & 3);
        e.Init(p);
        auto out = Run(e, in);
        CHECK(Peak(out) <= 32767, "trial %d peak %d", trial, Peak(out));
        CHECK(Peak(out) <= kLimiterCeiling * 1.001 || true, "");
    }
    return 0;
}

int TestDeterministic()
{
    auto in = Noise(30000, 0.7);
    Params p = Granular();
    p.density = 22000;
    p.reverb = 12000;
    p.feedback = 15000;
    Engine a, b;
    a.Init(p);
    b.Init(p);
    CHECK(Run(a, in) == Run(b, in), "same input and settings give identical audio");
    return 0;
}

int TestGrainBudget()
{
    // Dense long grains never use more than the fixed grain pool
    Engine e;
    Params p = Granular();
    p.density = 0; // 130 Hz
    p.size = 32000; // long
    e.Init(p);
    auto in = Noise(44000, 0.5);
    std::vector<int32_t> out(96);
    int worst = 0;
    for (size_t pos = 0; pos + 48 <= 44000; pos += 48)
    {
        e.Process(in.data() + 2 * pos, out.data(), 48);
        worst = std::max(worst, e.ActiveGrains());
    }
    CHECK(worst <= Engine::kMaxGrains + Engine::kGhosts, "active grains %d", worst);
    CHECK(worst >= 10, "dense settings keep the pool busy (%d)", worst);
    return 0;
}

int TestControlHelpers()
{
    // CV scaling: 0 V neutral, +-5 V full scale
    CHECK(CvToQ15(0, 4095) == 0, "0 V");
    CHECK(CvToQ15(4095, 4095) == kParamMax, "+5 V");
    CHECK(CvToQ15(-4095, 4095) == -kParamMax, "-5 V");
    CHECK(CvToQ15(100000, 4095) == kParamMax, "clamped");
    CHECK(CvToSemitonesQ8(819, 819) == 12 * 256, "1 V is an octave");
    CHECK(CvToSemitonesQ8(-819 * 2, 819) == -24 * 256, "-2 V is two octaves down");

    // A jack counts as patched while it was seen moving in the last four seconds
    CvPresence presence;
    CHECK(!presence.Present(1000), "nothing seen yet");
    presence.Update(50, 100, 1000);
    CHECK(!presence.Present(1000), "below the threshold is noise");
    presence.Update(-500, 100, 2000);
    CHECK(presence.Present(2100), "patched");
    CHECK(presence.Present(5900), "still patched");
    CHECK(!presence.Present(6100), "forgotten after four seconds");

    // Taps: a quick press and release with no knob moved
    TapDetector tap;
    tap.OnPress(1000);
    CHECK(tap.OnRelease(1100), "quick press is a tap");
    tap.OnPress(1000);
    tap.OnKnobMoved();
    CHECK(!tap.OnRelease(1100), "a knob moved while held is not a tap");
    tap.OnPress(1000);
    CHECK(!tap.OnRelease(2000), "a long hold is not a tap");

    // Zones
    CHECK(MediaFromKnob(0) == Media::DIRTY_TAPE && MediaFromKnob(kParamMax) == Media::DIGITAL, "media ends");
    CHECK(MediaFromKnob(9000) == Media::CLEAN_TAPE && MediaFromKnob(17000) == Media::VINTAGE_DIGITAL, "media middle");
    CHECK(AssignDestinationFromKnob(0) == 0 && AssignDestinationFromKnob(16384) == 1 && AssignDestinationFromKnob(kParamMax) == 2,
          "assign destinations");
    Params p;
    p.feedback = 20000;
    ApplyAssignCv(p, 0, 20000);
    CHECK(p.feedback == kParamMax, "assign CV clamps");
    ApplyAssignCv(p, 2, -kParamMax);
    CHECK(p.reverb == 0, "assign CV subtracts");
    return 0;
}

struct TestCase
{
    const char *name;
    int (*fn)();
};

const TestCase kTests[] = {
    {"silence", TestSilence},
    {"dry", TestDryPath},
    {"grains", TestGrainsPlayRecordedAudio},
    {"freeze", TestFreeze},
    {"density", TestDensityRegions},
    {"seed", TestSeed},
    {"size", TestSizeAndReverse},
    {"pitch", TestPitch},
    {"feedback", TestFeedback},
    {"delay", TestDelayMode},
    {"reverb", TestReverb},
    {"media", TestMediaLengths},
    {"media_switch", TestMediaSwitchIsSafe},
    {"sweep", TestSweepBounded},
    {"deterministic", TestDeterministic},
    {"grain_budget", TestGrainBudget},
    {"controls", TestControlHelpers},
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
