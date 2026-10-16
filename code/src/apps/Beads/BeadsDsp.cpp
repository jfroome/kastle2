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

#include "BeadsDsp.hpp"

namespace kastle2::beads
{

namespace
{
constexpr int32_t kQ15One = 32768;

constexpr int16_t kTanh[129] = {
    -32745, -32742, -32739, -32735, -32731, -32726, -32720, -32714, -32707, -32699, -32690, -32680,
    -32669, -32656, -32641, -32624, -32605, -32583, -32559, -32531, -32500, -32465, -32425, -32380,
    -32328, -32270, -32205, -32131, -32047, -31952, -31845, -31725, -31588, -31435, -31261, -31066,
    -30846, -30599, -30321, -30009, -29659, -29267, -28829, -28340, -27796, -27190, -26518, -25775,
    -24955, -24053, -23065, -21986, -20812, -19541, -18173, -16706, -15142, -13486, -11742, -9919,
    -8025, -6073, -4075, -2045, 0, 2045, 4075, 6073, 8025, 9919, 11742, 13486,
    15142, 16706, 18173, 19541, 20812, 21986, 23065, 24053, 24955, 25775, 26518, 27190,
    27796, 28340, 28829, 29267, 29659, 30009, 30321, 30599, 30846, 31066, 31261, 31435,
    31588, 31725, 31845, 31952, 32047, 32131, 32205, 32270, 32328, 32380, 32425, 32465,
    32500, 32531, 32559, 32583, 32605, 32624, 32641, 32656, 32669, 32680, 32690, 32699,
    32707, 32714, 32720, 32726, 32731, 32735, 32739, 32742, 32745,
};

constexpr uint16_t kExpDist[64] = {
    36183, 31733, 28208, 25346, 22977, 20982, 19279, 17808, 16525, 15396, 14394, 13499,
    12694, 11967, 11306, 10703, 10151, 9642, 9173, 8738, 8334, 7957, 7606, 7276,
    6967, 6676, 6401, 6142, 5896, 5663, 5442, 5231, 5030, 4839, 4655, 4480,
    4311, 4150, 3994, 3844, 3699, 3559, 3424, 3293, 3166, 3042, 2921, 2804,
    2689, 2576, 2465, 2356, 2248, 2141, 2035, 1928, 1821, 1712, 1600, 1484,
    1360, 1223, 1061, 826,
};

constexpr uint16_t kInvSqrt[32] = {
    32767, 23170, 18918, 16384, 14654, 13377, 12385, 11585, 10922, 10362, 9880, 9459,
    9088, 8757, 8460, 8192, 7947, 7723, 7517, 7327, 7150, 6986, 6832, 6689,
    6553, 6426, 6306, 6192, 6085, 5982, 5885, 5792,
};

// ---- lazily built tables (integer arithmetic only)
uint32_t g_exp2[257];      // 2^(i/256), Q16
int16_t g_mu_decode[256];  // mu-law -> linear
uint8_t g_exp_lut[256];    // floor(log2(i)) for the mu-law encoder
bool g_tables_ready = false;

void BuildTables()
{
    if (g_tables_ready)
    {
        return;
    }
    // 2^(1/256) in Q30; the running product is kept in Q32 so rounding errors stay below 1 LSB of the Q16 result.
    const uint64_t step = 1076653033ull;
    uint64_t v = 1ull << 32;
    for (int i = 0; i <= 256; i++)
    {
        g_exp2[i] = static_cast<uint32_t>((v + (1u << 15)) >> 16);
        v = (v * step) >> 30;
    }
    for (int u = 0; u < 256; u++)
    {
        const int inv = ~u & 0xFF;
        int t = ((inv & 0x0F) << 3) + 0x84;
        t <<= (inv & 0x70) >> 4;
        g_mu_decode[u] = static_cast<int16_t>((inv & 0x80) ? (0x84 - t) : (t - 0x84));
    }
    g_exp_lut[0] = 0;
    for (int i = 1; i < 256; i++)
    {
        int e = 0;
        while ((2 << e) <= i)
        {
            e++;
        }
        g_exp_lut[i] = static_cast<uint8_t>(e);
    }
    g_tables_ready = true;
}

/// (a * b) >> 15 without 32-bit overflow
inline int32_t Mul15(int32_t a, int32_t b)
{
    return static_cast<int32_t>((static_cast<int64_t>(a) * b) >> 15);
}

inline int32_t Abs(int32_t x)
{
    return x < 0 ? -x : x;
}

inline int32_t Min(int32_t a, int32_t b)
{
    return a < b ? a : b;
}

inline int32_t Max(int32_t a, int32_t b)
{
    return a > b ? a : b;
}

inline int32_t Sat16(int32_t x)
{
    return x > 32767 ? 32767 : (x < -32768 ? -32768 : x);
}

/// 2^(x / 65536) in Q16. Valid for x in about [-30, 14] * 65536.
inline uint32_t Exp2(int32_t x)
{
    const int32_t whole = x >> 16;
    const uint32_t frac = static_cast<uint32_t>(x) & 0xFFFF;
    const uint32_t i = frac >> 8;
    const uint32_t f = frac & 0xFF;
    const uint32_t v = g_exp2[i] + (((g_exp2[i + 1] - g_exp2[i]) * f) >> 8);
    if (whole >= 0)
    {
        return whole > 14 ? v << 14 : v << whole;
    }
    return -whole > 30 ? 0 : v >> -whole;
}

/// t * t * (3 - 2t), Q15
inline int32_t SmoothStep(int32_t t)
{
    t = Clamp(t, 0, kQ15One);
    const int32_t t2 = (t * t) >> 15;
    return (t2 * (3 * kQ15One - 2 * t)) >> 15;
}

inline int32_t SoftClip(int32_t x)
{
    // tanh table spans +-4.0 in steps of 1/16
    const int32_t pos = (x >> 11) + 64;
    if (pos <= 0)
    {
        return kTanh[0];
    }
    if (pos >= 128)
    {
        return kTanh[128];
    }
    const int32_t frac = x & 2047;
    return kTanh[pos] + (((kTanh[pos + 1] - kTanh[pos]) * frac) >> 11);
}

uint8_t LinToMu(int32_t pcm)
{
    // Classic G.711 mu-law: bias, 3-bit exponent from a lookup, 4-bit mantissa
    const int32_t sign = (pcm >> 8) & 0x80;
    if (sign)
    {
        pcm = -pcm;
    }
    if (pcm > 32635)
    {
        pcm = 32635;
    }
    pcm += 0x84;
    const int32_t exponent = g_exp_lut[(pcm >> 7) & 0xFF];
    const int32_t mantissa = (pcm >> (exponent + 3)) & 0x0F;
    return static_cast<uint8_t>(~(sign | (exponent << 4) | mantissa));
}

inline int32_t MuToLin(uint8_t u)
{
    return g_mu_decode[u];
}

// pot -> parameter laws of the original (CvReader::PotChannel)
int32_t AttenuverterLaw(int32_t pot)
{
    const int32_t x = Clamp(pot, 0, kParamMax) - kParamCentre;
    const int32_t m = Max(Abs(x) - 983, 0);
    const int32_t v = (((x * m) >> 15) * 4357) >> 10;
    return Clamp(v, -kQ15One, kQ15One - 1);
}

/// Semitones * 256 for the pitch pot: detents at 0, 1, 3, 4, 7, 12, 24 with smooth transitions in between
int32_t PitchLaw(int32_t pot)
{
    static const int32_t intervals[8] = {0, 1, 3, 4, 7, 12, 24, 24};
    const int32_t d = Clamp(pot, 0, kParamMax) - kParamCentre; // +-16384
    const int32_t sign = d < 0 ? -1 : 1;
    const int32_t detune = Abs(d) * 6;                          // 0..6 in Q14
    const int32_t index = Min(detune >> 14, 6);
    const int32_t frac = (detune & 16383) << 1;                 // Q15
    int32_t f = ((frac - 10923) * 3) >> 1;
    f = Max(f, 0);
    const int32_t s = SmoothStep(f);
    const int32_t a = intervals[index] * 256;
    const int32_t b = intervals[index + 1] * 256;
    return sign * (a + (((b - a) * s) >> 15));
}

constexpr int32_t kMinTapDelay = 68;
constexpr int32_t kLimiterThreshold = 29491; // 0.9
constexpr int kEnvAttack = 0, kEnvSustain = 1, kEnvRelease = 2, kEnvDone = 3;

constexpr int kDel1Len = 2061;
constexpr int kDel2Len = 2891;
constexpr int kReverbOffsets[10] = {0,
                                    69,
                                    69 + 98,
                                    69 + 98 + 146,
                                    69 + 98 + 146 + 241,
                                    69 + 98 + 146 + 241 + 999,
                                    69 + 98 + 146 + 241 + 999 + 1232,
                                    69 + 98 + 146 + 241 + 999 + 1232 + 2061,
                                    69 + 98 + 146 + 241 + 999 + 1232 + 2061 + 1157,
                                    69 + 98 + 146 + 241 + 999 + 1232 + 2061 + 1157 + 1006};
constexpr int kReverbLen[10] = {69, 98, 146, 241, 999, 1232, 2061, 1157, 1006, 2891};
static_assert(kReverbOffsets[9] + kReverbLen[9] <= Engine::kReverbWords, "reverb memory");

/// Parabolic sine from a 32-bit phase, -32768..32767
inline int32_t Parabolic(uint32_t phase)
{
    const int32_t u = static_cast<int32_t>(phase >> 16);
    const int32_t tri = (u < 32768 ? u : 65535 - u) * 2 - 32768;
    return (tri * (65536 - Abs(tri))) >> 15;
}
} // namespace

int32_t Clamp(int32_t value, int32_t low, int32_t high)
{
    return value < low ? low : (value > high ? high : value);
}

int32_t CvToQ15(int32_t adc, int32_t adc_5v)
{
    if (adc_5v <= 0)
    {
        return 0;
    }
    return Clamp(static_cast<int32_t>((static_cast<int64_t>(adc) * kParamMax) / adc_5v), -kParamMax, kParamMax);
}

int32_t CvToSemitonesQ8(int32_t adc, int32_t adc_1v)
{
    if (adc_1v <= 0)
    {
        return 0;
    }
    return Clamp(static_cast<int32_t>((static_cast<int64_t>(adc) * 12 * 256) / adc_1v), -96 * 256, 96 * 256);
}

Media MediaFromKnob(int32_t knob)
{
    const int32_t zone = Clamp(knob, 0, kParamMax) * 4 / (kParamMax + 1);
    return static_cast<Media>(zone);
}

int AssignDestinationFromKnob(int32_t knob)
{
    return Clamp(knob, 0, kParamMax) * 3 / (kParamMax + 1);
}

void ApplyAssignCv(Params &p, int destination, int32_t cv_q15)
{
    int32_t *target = destination == 0 ? &p.feedback : (destination == 1 ? &p.dry_wet : &p.reverb);
    *target = Clamp(*target + cv_q15, 0, kParamMax);
}

uint32_t Engine::Rand()
{
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return rng_;
}

int32_t Engine::RandQ15()
{
    return static_cast<int32_t>(Rand() >> 17);
}

void Engine::Init()
{
    Init(Params());
}

void Engine::Init(const Params &params)
{
    BuildTables();
    params_ = target_ = params;
    media_ = Media::COUNT; // force a reset in ConfigureMedia
    ConfigureMedia(params.media);
    rng_ = 0x2545F491u;
    rv_pos_[0] = 0;
    for (int i = 0; i < 10; i++)
    {
        rv_pos_[i] = 0;
    }
    for (auto &x : reverb_mem_)
    {
        x = 0;
    }
    rv_lp1_ = rv_lp2_ = 0;
    rv_lfo1_ = rv_lfo2_ = 0;
    rv_prev_[0] = rv_prev_[1] = 0;
    rv_idle_ = 0;
    rv_active_ = true;
    input_limiter_ = pre_reverb_limiter_ = output_limiter_ = Limiter();
    feedback_ = params.feedback;
    dry_gain_ = wet_gain_ = 0;
    mode_fade_ = kQ15One;
    delay_mode_ = want_delay_mode_ = false;
    UpdateBlock();
    feedback_ = feedback_target_;
    dry_gain_ = dry_target_;
    wet_gain_ = wet_target_;
}

void Engine::SetParams(const Params &params)
{
    target_ = params;
}

void Engine::ConfigureMedia(Media media)
{
    if (media == media_)
    {
        return;
    }
    media_ = media;
    switch (media)
    {
    case Media::DIRTY_TAPE:
        ratio_ = 2;
        bits8_ = true;
        lp_coef_ = 24576;      // 0.75
        softlimit_gain_ = 7168; // 1.75
        caveman_ = true;
        break;
    case Media::CLEAN_TAPE:
        ratio_ = 2;
        bits8_ = false;
        lp_coef_ = 29491;      // 0.9
        softlimit_gain_ = 5325; // 1.3
        caveman_ = true;
        break;
    case Media::VINTAGE_DIGITAL:
        ratio_ = 1;
        bits8_ = true;
        lp_coef_ = 29491;
        softlimit_gain_ = 5325;
        caveman_ = true;
        break;
    case Media::DIGITAL:
    default:
        ratio_ = 1;
        bits8_ = false;
        lp_coef_ = 32735; // 0.999
        softlimit_gain_ = 0;
        caveman_ = false;
        break;
    }
    fb_scale_q8_ = softlimit_gain_ ? ((delay_mode_ ? 384 : 768) << 12) / softlimit_gain_ : 0;
    capacity_ = bits8_ ? 65536 : 32768;
    mask_ = capacity_ - 1;
    const int32_t fs = kSampleRate / ratio_;
    max_inc_ = static_cast<uint32_t>((static_cast<uint64_t>(13081278ull) << 32) / (100000ull * fs));
    safety_frames_ = 256 / ratio_;
    max_grain_frames_ = 4 * fs;
    ResetBuffers();
}

void Engine::ResetBuffers()
{
    for (uint32_t i = 0; i < kDelayBytes; i++)
    {
        memory_[i] = 0;
    }
    // mu-law zero
    if (bits8_)
    {
        const uint8_t zero = LinToMu(0);
        for (uint32_t i = 0; i < kDelayBytes; i++)
        {
            memory_[i] = zero;
        }
    }
    write_pos_ = 0;
    written_ = 0;
    for (auto &g : grains_)
    {
        g = Grain();
    }
    grain_interval_ = 1 << 20;
    prev_l_ = prev_r_ = 0;
    dc_x_[0] = dc_x_[1] = dc_y_[0] = dc_y_[1] = 0;
    trig_phase_ = 0;
    prev_gate_ = false;
    random_ratio_q12_ = 4096;
    tap_delay_q10_[0] = tap_delay_q10_[1] = 0;
    bw_state_[0] = bw_state_[1] = 0;
    was_frozen_ = false;
    wet_prev_[0] = wet_prev_[1] = 0;
    src_hist_[0] = src_hist_[1] = 0;
}

int Engine::ActiveGrains() const
{
    int n = 0;
    for (const auto &g : grains_)
    {
        n += g.active() ? 1 : 0;
    }
    return n;
}

void Engine::UpdateBlock()
{
    params_ = target_;
    ConfigureMedia(params_.media);
    frozen_ = params_.freeze;

    // Delay mode (size fully clockwise) with hysteresis
    const int32_t threshold = delay_mode_ ? 32112 : 32440; // 0.98 / 0.99
    want_delay_mode_ = params_.size > threshold;

    // Density -> trigger rate. The CV splits into a linear part (moves the knob) and an exponential part (FM)
    const int32_t d = Clamp(params_.density, 0, kParamMax);
    const int32_t expo = Clamp(20 * (Abs(d - kParamCentre) - 7373), 0, kQ15One - 1);
    const int32_t cv = Clamp(params_.density_cv, -kQ15One, kQ15One - 1);
    const int32_t linear_cv = ((kQ15One - expo) * cv) >> 15;
    const int32_t expo_cv = (expo * cv) >> 15;
    const int32_t dens = Clamp(d + linear_cv, 0, kParamMax);
    const uint32_t fm = Exp2(expo_cv * 10); // +-5 octaves at full CV
    trigger_enabled_ = dens < 15729 || dens > 17039;
    randomize_ = dens > 17039;
    int32_t exponent;
    if (!randomize_)
    {
        exponent = -dens * 32;
    }
    else
    {
        exponent = -((kParamMax - dens) * 32) - 65536; // times 0.5
    }
    uint64_t inc = (static_cast<uint64_t>(max_inc_) * Exp2(exponent)) >> 16;
    inc = (inc * fm) >> 16;
    if (inc < 1)
    {
        inc = 1;
    }
    if (inc > 0x40000000u)
    {
        inc = 0x40000000u;
    }
    trig_inc_ = static_cast<uint32_t>(inc);

    // Delay mode taps: interval from density (exponential away from the centre)
    {
        const int32_t distance = Abs(dens - kParamCentre); // 0..16384
        const uint32_t ratio = Exp2(-distance * 36);       // 2^(-18 * |d - 0.5|)
        int64_t interval = (static_cast<int64_t>(capacity_ - 2 * safety_frames_) * ratio) >> 16;
        interval = (interval * fm) >> 16;
        if (interval < kMinTapDelay)
        {
            interval = kMinTapDelay;
        }
        if (interval > static_cast<int64_t>(capacity_ - 2 * safety_frames_))
        {
            interval = capacity_ - 2 * safety_frames_;
        }
        tap_target_[0] = static_cast<int32_t>(interval);
        tap_target_[1] = static_cast<int32_t>((interval * 25231) >> 15); // 0.77
        tap_lp_coef_ = Clamp(static_cast<int32_t>((10 << 15) / interval), 164, 22937);
        const int32_t odd = Clamp((dens - kParamCentre) * 25, 0, kQ15One);
        tap_lfo_ = 0x4000 + (Parabolic(tap_lfo_phase_) >> 2) + 0x2000; // slow 0.25..1
        const int32_t odd_mod = (odd * Clamp(tap_lfo_, 0, 32767)) >> 15;
        tap_gain_[0] = kQ15One - ((odd_mod * 6554) >> 15);
        tap_gain_[1] = (odd_mod * 26214) >> 15;
        const int32_t bandwidth =
            Clamp((((Clamp(params_.size_amt, 0, kParamMax) - kParamCentre) * 2 + kQ15One) >> 1) + params_.size_cv, 0,
                  kQ15One);
        bandwidth_coef_ = 1500 + (((bandwidth * bandwidth) >> 15) * 31267 >> 15);
    }

    // Feedback / mix
    fb_scale_q8_ = softlimit_gain_ ? (((delay_mode_ ? 384 : 768) << 12) / softlimit_gain_) : 0;
    feedback_target_ = Clamp(params_.feedback, 0, kParamMax);
    const int32_t dw = Clamp(params_.dry_wet, 0, kParamMax);
    dry_target_ = ((((kQ15One - dw) * (kQ15One + dw)) >> 15) * 3) >> 2;
    wet_target_ = (((dw * (2 * kQ15One - dw)) >> 15) * 3) >> 1;

    // Reverb
    const int32_t r = Clamp(params_.reverb, 0, kParamMax);
    reverb_amount_ = r;
    const int32_t r2 = (r * r) >> 15;
    const int32_t r3 = (r2 * r) >> 15;
    const int32_t mix = (r2 * 29491) >> 15; // * 0.9
    rv_time_ = caveman_ ? 14746 + ((r3 * 16384) >> 15) : 9830 + ((r3 * 19661) >> 15);
    rv_lp_ = caveman_ ? 13107 : (media_ == Media::VINTAGE_DIGITAL ? 24576 : 19661);
    const int32_t input_gain = (6554 * (kQ15One - ((10912 * rv_time_) >> 15))) >> 15; // 0.2 * (1 - 0.333 t)
    const int32_t send_sqrt = (mix * (2 * kQ15One - mix)) >> 15;
    const int32_t send = (send_sqrt * (2 * kQ15One - send_sqrt)) >> 15;
    rv_send_ = (send * input_gain) >> 15;
    rv_wet_ = static_cast<int32_t>((13107ll * kQ15One) / Max(input_gain, 1)); // 0.4 / input_gain, Q15
    rv_wet_ = Min(rv_wet_, 4 * kQ15One);
    reverb_dry_ = ((kQ15One - mix) * (kQ15One + mix)) >> 15;

    tap_lfo_phase_ += 796520; // 0.17 Hz per 48-frame block
    meter_limiter_gain_ = block_limiter_min_;
    block_limiter_min_ = kQ15One;
}

// -------------------------------------------------------------------------------------------------
// Delay line

void Engine::WriteFrame(int32_t l, int32_t r)
{
    if (bits8_)
    {
        memory_[write_pos_ * 2] = LinToMu(l);
        memory_[write_pos_ * 2 + 1] = LinToMu(r);
    }
    else
    {
        int16_t *m = reinterpret_cast<int16_t *>(memory_);
        m[write_pos_ * 2] = static_cast<int16_t>(Sat16(l));
        m[write_pos_ * 2 + 1] = static_cast<int16_t>(Sat16(r));
    }
    write_pos_ = (write_pos_ + 1) & mask_;
    if (written_ < static_cast<int32_t>(capacity_))
    {
        written_++;
    }
}

void Engine::ReadFrame(int32_t delay_frames, int32_t &l, int32_t &r) const
{
    const uint32_t idx = (write_pos_ - 1 - static_cast<uint32_t>(delay_frames)) & mask_;
    if (bits8_)
    {
        l = MuToLin(memory_[idx * 2]);
        r = MuToLin(memory_[idx * 2 + 1]);
    }
    else
    {
        const int16_t *m = reinterpret_cast<const int16_t *>(memory_);
        l = m[idx * 2];
        r = m[idx * 2 + 1];
    }
}

void Engine::ReadFrameInterpolated(int32_t delay_q10, int32_t &l, int32_t &r) const
{
    const int32_t d = delay_q10 >> 10;
    const int32_t f = delay_q10 & 1023;
    const uint32_t i0 = (write_pos_ - 1 - static_cast<uint32_t>(d)) & mask_;
    const uint32_t i1 = (i0 - 1) & mask_;
    int32_t al, ar, bl, br;
    if (bits8_)
    {
        al = MuToLin(memory_[i0 * 2]);
        ar = MuToLin(memory_[i0 * 2 + 1]);
        bl = MuToLin(memory_[i1 * 2]);
        br = MuToLin(memory_[i1 * 2 + 1]);
    }
    else
    {
        const int16_t *m = reinterpret_cast<const int16_t *>(memory_);
        al = m[i0 * 2];
        ar = m[i0 * 2 + 1];
        bl = m[i1 * 2];
        br = m[i1 * 2 + 1];
    }
    l = al + (((bl - al) * f) >> 10);
    r = ar + (((br - ar) * f) >> 10);
}

// -------------------------------------------------------------------------------------------------
// Randomised parameters (RandomizedParameter in the original)

namespace
{
inline int32_t Attenuverter(int32_t amount)
{
    const int32_t a = AttenuverterLaw(amount);
    return a;
}

inline int32_t RandomnessAmount(int32_t a, bool has_cv)
{
    return has_cv ? Max(-a, 0) : Abs(a);
}
} // namespace

int32_t Engine::EvaluateParam(int32_t base, int32_t amount, int32_t cv, bool has_cv, bool clamp, int32_t range_q15,
                              bool, int)
{
    // `base` and the result are Q15 for 0..1 parameters, or semitones * 256 when !clamp (range_q15 = 24 * 256 * 2^7)
    const int32_t a = Attenuverter(amount);
    int32_t result = base;
    if (!has_cv)
    {
        const int32_t u = RandQ15();
        const int32_t blend = a > 0 ? a : Min(kQ15One, (a * u >> 15) * -3);
        int32_t random_value;
        if (!clamp)
        {
            random_value = static_cast<int32_t>((static_cast<int64_t>(2 * RandQ15() - kQ15One) * range_q15) >> 15);
        }
        else
        {
            random_value = static_cast<int32_t>((static_cast<int64_t>(RandQ15()) * range_q15 >> 15) - result);
        }
        result += static_cast<int32_t>((static_cast<int64_t>(random_value) * blend) >> 15);
    }
    else
    {
        if (a < 0)
        {
            const int32_t u = RandQ15();
            // u * (u * (4u - 6) + 4) - 1, evaluated in 64 bits
            const int64_t inner = ((static_cast<int64_t>(u) * (4 * u - 6 * kQ15One)) >> 15) + 4 * kQ15One;
            const int32_t pseudo_gaussian = static_cast<int32_t>((u * inner) >> 15) - kQ15One;
            result += static_cast<int32_t>(
                (static_cast<int64_t>((Max(cv, 0) * -a) >> 15) * pseudo_gaussian) >> 15);
        }
        else
        {
            result += static_cast<int32_t>((static_cast<int64_t>(a) * cv) >> 15);
        }
    }
    if (clamp)
    {
        result = Clamp(result, 0, kQ15One - 1);
    }
    return result;
}

// -------------------------------------------------------------------------------------------------
// Triggers

bool Engine::NextTrigger()
{
    const bool gate = params_.seed_locked || params_.seed_gate;
    const bool rising = params_.seed_gate && !prev_gate_;
    prev_gate_ = params_.seed_gate;

    if (!trigger_enabled_)
    {
        // Centre of the density knob: grains only on seed taps
        trig_gate_ = gate;
        regularity_ = kQ15One;
        return rising && !params_.seed_locked;
    }

    uint32_t f = trig_inc_;
    if (randomize_)
    {
        f = static_cast<uint32_t>((static_cast<uint64_t>(f) * static_cast<uint32_t>(random_ratio_q12_)) >> 12);
        if (f < 1)
        {
            f = 1;
        }
        if (f > 0x40000000u)
        {
            f = 0x40000000u;
        }
    }
    bool reset = false;
    const uint32_t previous = trig_phase_;
    if (gate)
    {
        trig_phase_ += f;
    }
    if (rising && !params_.seed_locked)
    {
        trig_phase_ = 0;
        reset = true;
    }
    else if (trig_phase_ < previous)
    {
        reset = true;
    }
    if (reset && randomize_)
    {
        random_ratio_q12_ = kExpDist[Rand() & 63];
    }
    trig_gate_ = trig_phase_ < 0x80000000u && gate;
    regularity_ = randomize_ ? 0 : kQ15One;
    return reset && gate;
}

// -------------------------------------------------------------------------------------------------
// Grains

void Engine::StartGrain()
{
    const Params &p = params_;
    trigger_count_++;

    // Parameters for this grain, with their per-grain randomness
    const int32_t size_v = EvaluateParam(p.size, p.size_amt, p.size_cv, p.size_has_cv, true, kQ15One, false, 0);
    const int32_t time_v = EvaluateParam(p.time, p.time_amt, p.time_cv, p.time_has_cv, true, kQ15One, false, 1);
    const int32_t shape_v = EvaluateParam(p.shape, p.shape_amt, p.shape_cv, p.shape_has_cv, true, kQ15One, false, 2);
    const int32_t pitch_base = PitchLaw(p.pitch);
    // The range of the random pitch is 24 semitones: 24 * 256 in the semitone Q8 domain, expressed as a Q15 multiplier
    const int32_t pitch_st_q8 =
        EvaluateParam(pitch_base, p.pitch_amt, p.pitch_cv_semitones_q8, p.pitch_has_cv, false, 24 * 256, false, 3);

    // Duration (reverse when the size knob is in the first third)
    const bool reverse = size_v < 10923;
    int32_t shortness;
    if (reverse)
    {
        const int32_t s3 = size_v * 3;
        shortness = (s3 * (2 * kQ15One - s3)) >> 15;
    }
    else
    {
        shortness = kQ15One - (((size_v - 10923) * 3) >> 1);
    }
    shortness = Min(kQ15One, (shortness * 33587) >> 15); // * 1.025
    shortness = Max(shortness, 0);
    uint64_t duration = (static_cast<uint64_t>(max_grain_frames_) * Exp2(-shortness * 18)) >> 16; // 2^(-9 * shortness)
    int32_t duration_frames = static_cast<int32_t>(duration < 8 ? 8 : duration);

    // Speed
    const int32_t speed_abs = static_cast<int32_t>(
        Exp2(static_cast<int32_t>((static_cast<int64_t>(Clamp(pitch_st_q8, -96 * 256, 96 * 256)) * 5461) >> 8)) >> 6); // Q10
    int32_t speed = reverse ? -speed_abs : speed_abs;
    if (speed == 0)
    {
        speed = reverse ? -1 : 1;
    }

    // Position, keeping the grain away from the write head
    const int32_t safety = safety_frames_ + 1;
    const int32_t max_delay = static_cast<int32_t>(capacity_) - 2 * safety;
    int32_t delay = static_cast<int32_t>((static_cast<int64_t>(time_v) * max_delay) >> 15) + safety;
    const int32_t consumption = speed - (frozen_ ? 0 : 1024);
    if (consumption != 0)
    {
        const int32_t limit = static_cast<int32_t>((static_cast<int64_t>(capacity_) << 10) / Abs(consumption));
        duration_frames = Min(duration_frames, limit);
        if (consumption > 0)
        {
            delay = Max(delay, static_cast<int32_t>((static_cast<int64_t>(duration_frames) * consumption) >> 10));
        }
        else
        {
            delay = Min(delay, static_cast<int32_t>(capacity_) +
                                   static_cast<int32_t>((static_cast<int64_t>(duration_frames) * consumption) >> 10));
        }
    }
    delay = Clamp(delay, 0, static_cast<int32_t>(capacity_) - 1);

    // Pick a slot: a free one, or steal the grain closest to its end and let it fade out as a ghost
    const int limit = ratio_ == 1 ? 10 : kMaxGrains; // what the RP2040 can afford at 44 kHz
    Grain *slot = nullptr;
    int active = 0;
    for (int i = 0; i < limit; i++)
    {
        if (grains_[i].active())
        {
            active++;
        }
        else if (!slot)
        {
            slot = &grains_[i];
        }
    }
    for (int i = limit; i < kMaxGrains + kGhosts; i++)
    {
        active += grains_[i].active() ? 1 : 0;
    }
    if (!slot)
    {
        Grain *victim = &grains_[0];
        int32_t most_progress = -1;
        for (int i = 0; i < limit; i++)
        {
            const int32_t progress = grains_[i].stage * 65536 + static_cast<int32_t>(grains_[i].phase & 0xFFFF);
            if (progress > most_progress)
            {
                most_progress = progress;
                victim = &grains_[i];
            }
        }
        Grain *ghost = nullptr;
        for (int i = kMaxGrains; i < kMaxGrains + kGhosts; i++)
        {
            if (!grains_[i].active())
            {
                ghost = &grains_[i];
                break;
            }
        }
        if (ghost)
        {
            *ghost = *victim;
            const int32_t fade_frames = Max(kSampleRate / ratio_ / 200, 8); // 5 ms
            ghost->fade = kQ15One;
            ghost->fade_step = Max(kQ15One / fade_frames, 1);
        }
        slot = victim;
    }

    // Amplitude and pan
    const int32_t amplitude = kInvSqrt[Min(active + 1, 32) - 1];
    int32_t spread = RandomnessAmount(Attenuverter(p.time_amt), p.time_has_cv) +
                     RandomnessAmount(Attenuverter(p.size_amt), p.size_has_cv) +
                     RandomnessAmount(Attenuverter(p.shape_amt), p.shape_has_cv) +
                     RandomnessAmount(Attenuverter(p.pitch_amt), p.pitch_has_cv) + (kQ15One - regularity_);
    spread = Min(spread, kQ15One);
    const int32_t pan_spread = Min(((active + 1) * spread) >> 1, 1 << 20);
    const int32_t u = RandQ15();
    const int32_t v = RandQ15();
    const int32_t width = Min((static_cast<int64_t>(pan_spread) * v) >> 15, kQ15One);
    int32_t pan = 16384 + (((u - 16384) * width) >> 15);
    pan = Clamp(pan, 0, kQ15One);
    int32_t g00, g01, g10, g11;
    if (pan < 16384)
    {
        const int32_t q = pan * 2;
        g00 = amplitude;
        g10 = 0;
        g11 = (((q * (2 * kQ15One - q)) >> 15) * amplitude) >> 15;
        g01 = ((((kQ15One - q) * (kQ15One + q)) >> 15) * amplitude) >> 15;
    }
    else
    {
        const int32_t q = (kQ15One - pan) * 2;
        g11 = amplitude;
        g01 = 0;
        g00 = (((q * (2 * kQ15One - q)) >> 15) * amplitude) >> 15;
        g10 = ((((kQ15One - q) * (kQ15One + q)) >> 15) * amplitude) >> 15;
    }

    // Envelope
    const int32_t fs = kSampleRate / ratio_;
    const int32_t sustain = Max(kQ15One - 3 * shape_v, 0);
    int32_t sh = ((shape_v - 10923) * 3) >> 1;
    if (sh < 0)
    {
        sh = 0;
    }
    else if (sh < 16384)
    {
        const int32_t s2 = (sh * sh) >> 15;
        sh = Min(((s2 * sh) >> 15) * 4, kQ15One - 1);
    }
    const int32_t attack = Min(sh, kQ15One);
    const int32_t release = ((kQ15One - attack) * (kQ15One - sustain)) >> 15;
    const int32_t min_attack = Max(fs / 2000, 2);
    const int32_t min_release = Max(fs / 100, 4);
    const int32_t attack_d = Max(static_cast<int32_t>((static_cast<int64_t>(duration_frames) * attack) >> 15),
                                 (min_attack * (kQ15One + 3 * sustain)) >> 15);
    const int32_t sustain_d = Max(static_cast<int32_t>((static_cast<int64_t>(duration_frames) * sustain) >> 15), 2);
    const int32_t release_d = Max(static_cast<int32_t>((static_cast<int64_t>(duration_frames) * release) >> 15), min_release);

    Grain &g = *slot;
    g = Grain();
    g.delay = delay << 10;
    g.speed = speed;
    g.gain[0][0] = g00 >> 1;
    g.gain[0][1] = g01 >> 1;
    g.gain[1][0] = g10 >> 1;
    g.gain[1][1] = g11 >> 1;
    g.stage = kEnvAttack;
    g.phase = 0;
    g.inc[0] = static_cast<uint32_t>(65536 / Max(attack_d, 1));
    g.inc[1] = static_cast<uint32_t>(65536 / Max(sustain_d, 1));
    g.inc[2] = static_cast<uint32_t>(65536 / Max(release_d, 1));
    g.smooth = attack < 16384 ? 2 * attack : 2 * kQ15One - 2 * attack;
    g.remaining = duration_frames;
    grain_interval_ = 0;
}

namespace
{
/// Envelope value (Q15) of a grain stage at a phase (Q16)
inline int32_t EnvelopeAt(int stage, uint32_t phase, int32_t smooth)
{
    if (stage == kEnvSustain)
    {
        return kQ15One;
    }
    const int32_t t = stage == kEnvAttack ? static_cast<int32_t>(phase >> 1) : kQ15One - static_cast<int32_t>(phase >> 1);
    int32_t base = t;
    if (stage == kEnvRelease)
    {
        const int32_t t2 = (t * t) >> 15;
        base = (t2 * t2) >> 15;
    }
    return base + (((SmoothStep(t) - base) * smooth) >> 15);
}
} // namespace

// Grains are rendered 8 frames at a time: the delay trajectory, envelope and edge fades are evaluated once per chunk
// and interpolated linearly inside it. They read what was written before the chunk, which only matters inside the
// 256-frame safety zone next to the write head, where they are faded out anyway.
template <bool kBits8>
void Engine::RenderGrainChunk(int32_t *out_l, int32_t *out_r, int n, int shift)
{
    const int32_t tail_q10 = static_cast<int32_t>(capacity_) << 10;
    const int32_t advance = frozen_ ? 0 : 1024;
    const int safety_shift = ratio_ == 1 ? 8 : 7;
    for (int j = 0; j < n; j++)
    {
        out_l[j] = 0;
        out_r[j] = 0;
    }
    for (auto &g : grains_)
    {
        if (!g.active())
        {
            continue;
        }
        // Trajectory: delay_j = delay + (j + 1) * step
        const int32_t step = advance - g.speed;
        int frames = n;
        if (step < 0)
        {
            if (g.delay + step * n < 0)
            {
                frames = g.delay / -step;
            }
        }
        else if (step > 0)
        {
            if (g.delay + step * n >= tail_q10)
            {
                frames = (tail_q10 - 1 - g.delay) / step;
            }
        }
        if (frames <= 0)
        {
            g.stage = kEnvDone;
            continue;
        }

        // Envelope at both ends of the chunk. A stage change inside the chunk takes the exact (slower) route.
        const uint32_t phase_end = g.phase + g.inc[g.stage] * static_cast<uint32_t>(frames);
        int32_t env0 = EnvelopeAt(g.stage, g.phase, g.smooth);
        int32_t env1;
        int next_stage = g.stage;
        uint32_t next_phase = phase_end;
        if (g.stage != kEnvSustain && phase_end >= 65536)
        {
            // End of the stage inside this chunk: finish it on its last value and move on
            next_stage = g.stage + 1;
            next_phase = 0;
            env1 = next_stage == kEnvDone ? 0 : EnvelopeAt(next_stage, 0, g.smooth);
            if (g.stage == kEnvRelease)
            {
                env1 = 0;
            }
        }
        else if (g.stage == kEnvSustain && phase_end >= 65536)
        {
            next_stage = kEnvRelease;
            next_phase = 0;
            env1 = EnvelopeAt(kEnvRelease, 0, g.smooth);
        }
        else
        {
            env1 = EnvelopeAt(g.stage, phase_end, g.smooth);
        }

        // Fade near the ends of the buffer
        const int32_t d_start = g.delay >> 10;
        const int32_t d_end = (g.delay + step * frames) >> 10;
        auto ramp_of = [&](int32_t d) {
            const int32_t dist = Min(d, static_cast<int32_t>(capacity_) - d);
            return dist < safety_frames_ ? (dist << (15 - safety_shift)) : kQ15One;
        };
        int32_t v0 = (env0 * ramp_of(d_start)) >> 15;
        int32_t v1 = (env1 * ramp_of(d_end)) >> 15;
        if (g.fade_step)
        {
            const int32_t f0 = g.fade;
            const int32_t f1 = Max(g.fade - g.fade_step * frames, 0);
            v0 = (v0 * f0) >> 15;
            v1 = (v1 * f1) >> 15;
            g.fade = f1;
            if (f1 <= 0)
            {
                next_stage = kEnvDone;
            }
        }
        // Q8 fractional ramp of the combined amplitude
        int32_t v = v0 << 8;
        const int32_t dv = frames == n ? ((v1 - v0) << (8 - shift)) : ((v1 - v0) << 8) / frames;

        const int32_t g00 = g.gain[0][0], g01 = g.gain[0][1], g10 = g.gain[1][0], g11 = g.gain[1][1];
        int32_t pos = g.delay;
        uint32_t head = write_pos_ - 1u;
        const uint32_t head_step = frozen_ ? 0u : 1u;
        const uint32_t *mem32 = reinterpret_cast<const uint32_t *>(memory_);
        const uint16_t *mem16w = reinterpret_cast<const uint16_t *>(memory_);
        if (((pos | step) & 1023) == 0)
        {
            // Unity-speed grains (the common case) sit on whole frames: no interpolation needed
            const int32_t whole_step = step >> 10;
            int32_t d = pos >> 10;
            for (int j = 0; j < frames; j++)
            {
                d += whole_step;
                v += dv;
                const uint32_t i0 = (head - static_cast<uint32_t>(d)) & mask_;
                head += head_step;
                int32_t sl, sr;
                if (kBits8)
                {
                    const uint32_t wa = mem16w[i0];
                    sl = g_mu_decode[wa & 0xFF];
                    sr = g_mu_decode[wa >> 8];
                }
                else
                {
                    const uint32_t wa = mem32[i0];
                    sl = static_cast<int16_t>(wa);
                    sr = static_cast<int32_t>(wa) >> 16;
                }
                const int32_t va = v >> 8;
                const int32_t l = (sl * g00 + sr * g01) >> 14;
                const int32_t r = (sl * g10 + sr * g11) >> 14;
                out_l[j] += (l * va) >> 15;
                out_r[j] += (r * va) >> 15;
            }
            pos = d << 10;
        }
        else
        {
            for (int j = 0; j < frames; j++)
            {
                pos += step;
                v += dv;
                const int32_t d = pos >> 10;
                const int32_t f = pos & 1023;
                const uint32_t i0 = (head - static_cast<uint32_t>(d)) & mask_;
                const uint32_t i1 = (i0 - 1u) & mask_;
                head += head_step;
                int32_t al, ar, bl, br;
                if (kBits8)
                {
                    const uint32_t wa = mem16w[i0];
                    const uint32_t wb = mem16w[i1];
                    al = g_mu_decode[wa & 0xFF];
                    ar = g_mu_decode[wa >> 8];
                    bl = g_mu_decode[wb & 0xFF];
                    br = g_mu_decode[wb >> 8];
                }
                else
                {
                    const uint32_t wa = mem32[i0];
                    const uint32_t wb = mem32[i1];
                    al = static_cast<int16_t>(wa);
                    ar = static_cast<int32_t>(wa) >> 16;
                    bl = static_cast<int16_t>(wb);
                    br = static_cast<int32_t>(wb) >> 16;
                }
                const int32_t sl = al + (((bl - al) * f) >> 10);
                const int32_t sr = ar + (((br - ar) * f) >> 10);
                const int32_t va = v >> 8;
                const int32_t l = (sl * g00 + sr * g01) >> 14;
                const int32_t r = (sl * g10 + sr * g11) >> 14;
                out_l[j] += (l * va) >> 15;
                out_r[j] += (r * va) >> 15;
            }
        }
        g.delay = pos;
        if (frames < n)
        {
            g.stage = kEnvDone; // left the buffer
        }
        else
        {
            g.stage = static_cast<uint8_t>(next_stage);
            g.phase = next_phase;
        }
    }
}

void Engine::RenderTaps(int32_t &out_l, int32_t &out_r)
{
    const int32_t safety = safety_frames_;
    if (frozen_)
    {
        if (!was_frozen_)
        {
            loop_len_ = tap_target_[0];
            const int32_t span = static_cast<int32_t>(capacity_) - 2 * safety - loop_len_;
            loop_start_ = kMinTapDelay + static_cast<int32_t>((static_cast<int64_t>(Clamp(params_.time, 0, kParamMax)) *
                                                                Max(span - kMinTapDelay, 0)) >> 15);
            tap_delay_q10_[0] = (loop_start_ + loop_len_) << 10;
            tap_delay_q10_[1] = (loop_start_ + ((loop_len_ * 25231) >> 15)) << 10;
        }
        for (int i = 0; i < 2; i++)
        {
            tap_delay_q10_[i] -= 1024;
            if (tap_delay_q10_[i] < (loop_start_ << 10))
            {
                tap_delay_q10_[i] += loop_len_ << 10;
            }
        }
    }
    else
    {
        for (int i = 0; i < 2; i++)
        {
            const int32_t target = tap_target_[i] << 10;
            tap_delay_q10_[i] += static_cast<int32_t>((static_cast<int64_t>(target - tap_delay_q10_[i]) * tap_lp_coef_) >> 15);
        }
    }
    int32_t sum_l = 0, sum_r = 0;
    for (int i = 0; i < 2; i++)
    {
        int32_t l, r;
        ReadFrameInterpolated(Clamp(tap_delay_q10_[i], 0, (static_cast<int32_t>(capacity_) - 4) << 10), l, r);
        sum_l += (l * tap_gain_[i]) >> 15;
        sum_r += (r * tap_gain_[i]) >> 15;
    }
    // Bandwidth
    bw_state_[0] += Mul15(sum_l - bw_state_[0], bandwidth_coef_);
    bw_state_[1] += Mul15(sum_r - bw_state_[1], bandwidth_coef_);
    out_l += bw_state_[0];
    out_r += bw_state_[1];
}

// -------------------------------------------------------------------------------------------------

int32_t Engine::LimitSample(Limiter &lim, int32_t &l, int32_t &r, int32_t threshold, int release_shift)
{
    // Keep |x| * gain below 2^31 even when a dense grain cloud sums to several times full scale
    l = Clamp(l, -65535, 65535);
    r = Clamp(r, -65535, 65535);
    const int32_t peak = Max(Abs(l), Abs(r));
    if (peak > lim.peak)
    {
        lim.peak = peak;
    }
    else
    {
        lim.peak -= (lim.peak - peak) >> release_shift;
    }
    int32_t target = kQ15One;
    if (lim.peak > threshold)
    {
        target = static_cast<int32_t>((static_cast<int64_t>(threshold) << 15) / lim.peak);
    }
    if (target < lim.gain)
    {
        lim.gain = target;
    }
    else
    {
        lim.gain += (target - lim.gain) >> 8;
    }
    l = (l * lim.gain) >> 15;
    r = (r * lim.gain) >> 15;
    return lim.gain;
}

int32_t Engine::Dry(int32_t sample) const
{
    if (bits8_)
    {
        return MuToLin(LinToMu(sample));
    }
    return sample;
}

void Engine::RecordStep(int32_t in_l, int32_t in_r)
{
    // Record the input mixed with the (limited, soft-clipped) feedback of what came out of the grains
    const int32_t max_fb_q8 = delay_mode_ ? 384 : 768; // 1.5 or 3.0
    int32_t g; // Q12, up to 3.0
    if (softlimit_gain_ == 0)
    {
        g = (((feedback_ * feedback_) >> 15) * max_fb_q8) >> 11;
    }
    else
    {
        g = (feedback_ * fb_scale_q8_) >> 11;
    }
    int32_t sl = in_l + ((prev_l_ * g) >> 12);
    int32_t sr = in_r + ((prev_r_ * g) >> 12);
    LimitSample(input_limiter_, sl, sr, 31130, 10);
    if (softlimit_gain_)
    {
        const int32_t cl = SoftClip((sl * softlimit_gain_) >> 12);
        const int32_t cr = SoftClip((sr * softlimit_gain_) >> 12);
        sl = in_l + (((cl - in_l) * feedback_) >> 15);
        sr = in_r + (((cr - in_r) * feedback_) >> 15);
    }
    if (!frozen_)
    {
        WriteFrame(sl, sr);
    }
}

void Engine::TrackOutput(int32_t wet_l, int32_t wet_r)
{
    // DC blocker (40 Hz) then one-pole smoothing into the feedback path. All values are kept within +-65535 so
    // that products with Q15 coefficients fit in 32 bits.
    const int32_t dc_coef = ratio_ == 1 ? 32580 : 32394;
    const int32_t l = Clamp(wet_l, -65535, 65535);
    const int32_t r = Clamp(wet_r, -65535, 65535);
    const int32_t hp_l = Clamp(l - dc_x_[0] + ((dc_y_[0] * dc_coef) >> 15), -65535, 65535);
    const int32_t hp_r = Clamp(r - dc_x_[1] + ((dc_y_[1] * dc_coef) >> 15), -65535, 65535);
    dc_x_[0] = l;
    dc_x_[1] = r;
    dc_y_[0] = hp_l;
    dc_y_[1] = hp_r;
    prev_l_ += (((hp_l - prev_l_) >> 1) * lp_coef_) >> 14;
    prev_r_ += (((hp_r - prev_r_) >> 1) * lp_coef_) >> 14;
}

void Engine::RunEngine(int frames)
{
    const int chunk = ratio_ == 1 ? 16 : 8;
    const int chunk_shift = ratio_ == 1 ? 4 : 3;
    for (int base = 0; base < frames; base += chunk)
    {
        int32_t wl[kMaxChunk], wr[kMaxChunk];
        if (!delay_mode_)
        {
            bool fire = false;
            for (int j = 0; j < chunk; j++)
            {
                fire |= NextTrigger();
            }
            if (fire)
            {
                StartGrain();
            }
            grain_interval_ += chunk;
            if (bits8_)
            {
                RenderGrainChunk<true>(wl, wr, chunk, chunk_shift);
            }
            else
            {
                RenderGrainChunk<false>(wl, wr, chunk, chunk_shift);
            }
        }
        // Smooth the feedback amount once per chunk
        {
            const int32_t delta = feedback_target_ - feedback_;
            int32_t s = delta >> 3;
            if (s == 0 && delta != 0)
            {
                s = delta > 0 ? 1 : -1;
            }
            feedback_ += s;
        }
        for (int j = 0; j < chunk; j++)
        {
            RecordStep(eng_in_[0][base + j], eng_in_[1][base + j]);
            int32_t l, r;
            if (delay_mode_)
            {
                // Taps read the delay line right after it was written, as in the original
                l = 0;
                r = 0;
                RenderTaps(l, r);
                prev_gate_ = params_.seed_gate;
            }
            else
            {
                l = wl[j];
                r = wr[j];
            }
            TrackOutput(l, r);
            eng_out_[0][base + j] = l;
            eng_out_[1][base + j] = r;
        }
    }
    was_frozen_ = frozen_;
}

// -------------------------------------------------------------------------------------------------
// Reverb (Griesinger topology at 22 kHz, after the original's)

void Engine::ReverbStep(int32_t in_mono, int32_t &out_l, int32_t &out_r)
{
    int16_t *mem = reverb_mem_;
    const int32_t kap = 20480; // 0.625

    auto read_tail = [&](int line) -> int32_t { return mem[kReverbOffsets[line] + rv_pos_[line]]; };
    auto write = [&](int line, int32_t v) {
        mem[kReverbOffsets[line] + rv_pos_[line]] = static_cast<int16_t>(Sat16(v));
    };
    auto advance = [&](int line) {
        if (++rv_pos_[line] >= kReverbLen[line])
        {
            rv_pos_[line] = 0;
        }
    };
    // Reads `delay` samples behind the write point of a line (linear interpolation, Q8 delay)
    auto read_at = [&](int line, int32_t delay_q8) -> int32_t {
        const int len = kReverbLen[line];
        const int32_t d = delay_q8 >> 8;
        const int32_t f = delay_q8 & 255;
        int i0 = rv_pos_[line] - 1 - d;
        int i1 = i0 - 1;
        while (i0 < 0) i0 += len;
        while (i1 < 0) i1 += len;
        const int32_t a = mem[kReverbOffsets[line] + i0];
        const int32_t b = mem[kReverbOffsets[line] + i1];
        return a + (((b - a) * f) >> 8);
    };
    auto allpass = [&](int line, int32_t x, int32_t k_in, int32_t k_out) -> int32_t {
        const int32_t t = read_tail(line);
        const int32_t acc = Clamp(x + ((t * k_in) >> 15), -65535, 65535);
        write(line, acc);
        advance(line);
        return ((acc * k_out) >> 15) + t;
    };

    rv_lfo1_ += 97613u; // 0.5 Hz at 22 kHz, Q32 phase
    rv_lfo2_ += 58568u; // 0.3 Hz
    const int32_t lfo1 = Parabolic(rv_lfo1_);
    const int32_t lfo2 = Parabolic(rv_lfo2_);

    int32_t acc = Clamp(Mul15(in_mono, rv_send_), -65535, 65535);
    for (int i = 0; i < 4; i++)
    {
        acc = allpass(i, acc, kap, -kap);
    }
    const int32_t apout = acc;

    // Loop 1 (left): del2 -> lp -> dap1a, dap1b -> del1
    int32_t x = apout + ((read_at(9, (kDel2Len - 23) * 256 + ((lfo2 * 23 * 256) >> 15)) * rv_time_) >> 15);
    rv_lp1_ += Mul15(Clamp(x, -65535, 65535) - rv_lp1_, rv_lp_);
    x = rv_lp1_;
    x = allpass(4, x, -kap, kap);
    x = allpass(5, x, kap, -kap);
    write(6, x);
    advance(6);
    const int32_t wet_l = x;

    // Loop 2 (right): del1 -> lp -> dap2a, dap2b -> del2
    int32_t y = apout + ((read_at(6, (kDel1Len - 18) * 256 + ((lfo1 * 18 * 256) >> 15)) * rv_time_) >> 15);
    rv_lp2_ += Mul15(Clamp(y, -65535, 65535) - rv_lp2_, rv_lp_);
    y = rv_lp2_;
    y = allpass(7, y, kap, -kap);
    y = allpass(8, y, -kap, kap);
    write(9, y);
    advance(9);
    const int32_t wet_r = y;

    out_l = Mul15(wet_l, rv_wet_);
    out_r = Mul15(wet_r, rv_wet_);
}

// -------------------------------------------------------------------------------------------------

void Engine::Process(const int32_t *input, int32_t *output, size_t frames)
{
    // Work in blocks of up to 48 frames (the firmware's block size); `frames` must be a multiple of 16
    for (size_t offset = 0; offset < frames; offset += kBlockFrames)
    {
        const size_t n = frames - offset < static_cast<size_t>(kBlockFrames) ? frames - offset : kBlockFrames;
        ProcessBlock(input + 2 * offset, output + 2 * offset, n);
    }
}

void Engine::ProcessBlock(const int32_t *input, int32_t *output, size_t n)
{
    UpdateBlock();
    const int32_t mode_step = Max(kQ15One / (kSampleRate / 20), 1); // ~50 ms fade when switching modes

    // Mode switch (granular <-> delay) fades the wet signal through silence
    for (size_t i = 0; i < n; i += 2)
    {
        if (want_delay_mode_ != delay_mode_)
        {
            mode_fade_ -= mode_step * 2;
            if (mode_fade_ <= 0)
            {
                mode_fade_ = 0;
                delay_mode_ = want_delay_mode_;
                for (auto &g : grains_)
                {
                    g.stage = kEnvDone;
                }
                was_frozen_ = false;
            }
        }
        else if (mode_fade_ < kQ15One)
        {
            mode_fade_ = Min(mode_fade_ + mode_step * 2, kQ15One);
        }
    }

    // Input at the engine rate
    int frames_e;
    if (ratio_ == 1)
    {
        frames_e = static_cast<int>(n);
        for (int i = 0; i < frames_e; i++)
        {
            eng_in_[0][i] = input[2 * i];
            eng_in_[1][i] = input[2 * i + 1];
        }
    }
    else
    {
        // 44 -> 22 kHz: [1 2 1] / 4 around the first frame of each pair
        frames_e = static_cast<int>(n / 2);
        for (int i = 0; i < frames_e; i++)
        {
            const int32_t a0l = input[4 * i], a0r = input[4 * i + 1];
            const int32_t a1l = input[4 * i + 2], a1r = input[4 * i + 3];
            eng_in_[0][i] = (src_hist_[0] + 2 * a0l + a1l) >> 2;
            eng_in_[1][i] = (src_hist_[1] + 2 * a0r + a1r) >> 2;
            src_hist_[0] = a1l;
            src_hist_[1] = a1r;
        }
    }
    // Pad to whole chunks (the engine frame count is always 48 or 24, both multiples of 8)
    RunEngine(frames_e);

    // Mix, limit, reverb (22 kHz) and output, per pair of 44 kHz frames
    for (size_t i = 0; i < n; i += 2)
    {
        int32_t w[2][2];
        if (ratio_ == 1)
        {
            w[0][0] = eng_out_[0][i];
            w[0][1] = eng_out_[1][i];
            w[1][0] = eng_out_[0][i + 1];
            w[1][1] = eng_out_[1][i + 1];
        }
        else
        {
            const int32_t wl = eng_out_[0][i / 2], wr = eng_out_[1][i / 2];
            w[0][0] = (wet_prev_[0] + wl) >> 1;
            w[0][1] = (wet_prev_[1] + wr) >> 1;
            w[1][0] = wl;
            w[1][1] = wr;
            wet_prev_[0] = wl;
            wet_prev_[1] = wr;
        }

        int32_t mix[2][2];
        for (int k = 0; k < 2; k++)
        {
            auto approach = [](int32_t &x, int32_t target) {
                const int32_t delta = target - x;
                int32_t step = delta >> 5;
                if (step == 0 && delta != 0)
                {
                    step = delta > 0 ? 1 : -1;
                }
                x += step;
            };
            approach(dry_gain_, dry_target_);
            approach(wet_gain_, wet_target_);

            const int32_t wet_scale = (wet_gain_ * mode_fade_) >> 15; // up to 1.5 in Q15
            // |w| <= 65535 and wet_scale <= 49152: halve before multiplying to stay within 32 bits
            const int32_t wl = (Clamp(w[k][0], -65535, 65535) >> 1) * wet_scale >> 14;
            const int32_t wr = (Clamp(w[k][1], -65535, 65535) >> 1) * wet_scale >> 14;
            int32_t l = ((Dry(input[2 * (i + k)]) * dry_gain_) >> 15) + wl;
            int32_t r = ((Dry(input[2 * (i + k) + 1]) * dry_gain_) >> 15) + wr;
            LimitSample(pre_reverb_limiter_, l, r, kLimiterThreshold, 12);
            mix[k][0] = l;
            mix[k][1] = r;
        }

        int32_t rl = 0, rr = 0;
        if (reverb_amount_ > 40)
        {
            rv_idle_ = 0;
            rv_active_ = true;
        }
        else if (rv_idle_ < 66000)
        {
            rv_idle_++;
        }
        else
        {
            rv_active_ = false;
        }
        if (rv_active_)
        {
            ReverbStep((mix[0][0] + mix[0][1] + mix[1][0] + mix[1][1]) >> 2, rl, rr);
        }
        const int32_t r44[2][2] = {{(rv_prev_[0] + rl) >> 1, (rv_prev_[1] + rr) >> 1}, {rl, rr}};
        rv_prev_[0] = rl;
        rv_prev_[1] = rr;

        for (int k = 0; k < 2; k++)
        {
            int32_t l = ((mix[k][0] * reverb_dry_) >> 15) + r44[k][0];
            int32_t r = ((mix[k][1] * reverb_dry_) >> 15) + r44[k][1];
            const int32_t gain = LimitSample(output_limiter_, l, r, kLimiterThreshold, 13);
            if (gain < block_limiter_min_)
            {
                block_limiter_min_ = gain;
            }
            output[2 * (i + k)] = Sat16(l);
            output[2 * (i + k) + 1] = Sat16(r);
        }
    }
}

} // namespace kastle2::beads
