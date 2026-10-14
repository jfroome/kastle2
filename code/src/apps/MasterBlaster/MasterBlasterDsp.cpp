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

#include "MasterBlasterDsp.hpp"

namespace kastle2::masterblaster
{

namespace
{
constexpr int32_t kQ15One = 32768;
constexpr int32_t kMinThreshold = 2600;
constexpr int32_t kToneLowpassCoef = 3100; // ~700 Hz at 44 kHz
constexpr uint32_t kWowInc = 58500u;       // ~0.6 Hz
constexpr uint32_t kDriftInc = 14000u;     // ~0.15 Hz
constexpr uint32_t kFlutterInc = 712000u;  // ~7.3 Hz
constexpr int32_t kWowMaxSamples = 40;
constexpr int32_t kBypassStep = 16;

inline int32_t Clamp(int32_t value, int32_t low, int32_t high)
{
    return value < low ? low : (value > high ? high : value);
}

inline int32_t Abs(int32_t value)
{
    return value < 0 ? -value : value;
}

inline int32_t ClampQ15(int32_t value)
{
    return Clamp(value, -32768, 32767);
}

inline void Slew(int32_t &current, int32_t target)
{
    const int32_t diff = target - current;
    current += diff >> 3;
    if (diff != 0 && (diff >> 3) == 0)
    {
        current += diff > 0 ? 1 : -1;
    }
}

// Smooth sine-like wave from a 32-bit phase, -32768..32767
inline int32_t Parabolic(uint32_t phase)
{
    const int32_t u = static_cast<int32_t>(phase >> 16);
    const int32_t tri = (u < 32768 ? u : 65535 - u) * 2 - 32768;
    return (tri * (65536 - Abs(tri))) >> 15;
}
} // namespace

int32_t PotToParam(int32_t pot_value, int32_t pot_max)
{
    if (pot_max <= 0)
    {
        return 0;
    }
    return Clamp(static_cast<int32_t>((static_cast<int64_t>(pot_value) * kParamMax) / pot_max), 0, kParamMax);
}

int32_t ApplyCv(int32_t param, int32_t cv_adc, int32_t adc_5v)
{
    if (adc_5v <= 0)
    {
        return Clamp(param, 0, kParamMax);
    }
    const int32_t delta = static_cast<int32_t>((static_cast<int64_t>(cv_adc) * kParamMax) / adc_5v);
    return Clamp(param + delta, 0, kParamMax);
}

void Chain::Init()
{
    *this = Chain();
    SetParams(Params());
    current_ = target_;
    lofi_shift_ = 0;
}

void Chain::Init(const Params &params)
{
    Init();
    SetParams(params);
    current_ = target_;
    lofi_shift_ = (Clamp(params.lofi, 0, kParamMax) * 8 + 16383) >> 15;
}

void Chain::SetParams(const Params &params)
{
    params_ = params;
    Params p = params;
    p.drive = Clamp(p.drive, 0, kParamMax);
    p.tone = Clamp(p.tone, 0, kParamMax);
    p.comp = Clamp(p.comp, 0, kParamMax);
    p.comp_speed = Clamp(p.comp_speed, 0, kParamMax);
    p.vinyl = Clamp(p.vinyl, 0, kParamMax);
    p.wow = Clamp(p.wow, 0, kParamMax);
    p.lofi = Clamp(p.lofi, 0, kParamMax);
    p.width = Clamp(p.width, 0, kParamMax);
    p.mix = Clamp(p.mix, 0, kParamMax);
    p.output = Clamp(p.output, 0, kParamMax);

    Derived &t = target_;

    // Saturation: gain 1x..8x, shaper fully engaged by mid knob, level compensation
    t.drive_gain = 4096 + ((p.drive * 28672) >> 15);
    t.sat_amount = Clamp(p.drive * 2, 0, kParamMax);
    t.sat_bias = p.drive >> 7;
    t.sat_makeup = kParamMax - ((p.drive * 13000) >> 15);

    // Tone: tilt up to +-0.6
    t.tone_tilt = (((p.tone - 16384) * 2) * 19661) >> 15;

    // Bus compressor, fixed 4:1
    t.comp_threshold = kParamMax - ((p.comp * (kParamMax - kMinThreshold)) >> 15);
    const int32_t reference = t.comp_threshold + ((kParamMax - t.comp_threshold) >> 2);
    const int32_t full_makeup = static_cast<int32_t>((static_cast<int64_t>(kParamMax) * 4096) / reference);
    t.comp_makeup = 4096 + (((full_makeup - 4096) * 28672) >> 15);
    const int32_t slow = kParamMax - p.comp_speed;
    const int32_t attack_samples = 44 + ((slow * 1200) >> 15);
    const int32_t release_samples = 1760 + ((slow * 33440) >> 15);
    t.attack_coef = kQ15One / attack_samples;
    t.release_coef = (1 << 20) / release_samples;

    // Vinyl
    t.lowpass_coef = kParamMax - ((p.vinyl * 20767) >> 15);
    t.noise_amp = (p.vinyl * 120) >> 15;
    t.crackle_thresh = (p.vinyl * 45) >> 15;
    t.crackle_amp = (p.vinyl * 5000) >> 15;
    t.wow_depth = (p.wow * (kWowMaxSamples * 256)) >> 15;

    // Lo-fi
    t.lofi_step = 256 - ((p.lofi * 224) >> 15);

    t.width_gain = (p.width * 8192) >> 15;
    t.mix = p.mix;
    const int32_t squared = (p.output * p.output) >> 15;
    t.out_gain = (squared * 8192) >> 15;
}

void Chain::UpdateBlock()
{
    Slew(current_.drive_gain, target_.drive_gain);
    Slew(current_.sat_amount, target_.sat_amount);
    Slew(current_.sat_bias, target_.sat_bias);
    Slew(current_.sat_makeup, target_.sat_makeup);
    Slew(current_.tone_tilt, target_.tone_tilt);
    Slew(current_.comp_threshold, target_.comp_threshold);
    Slew(current_.comp_makeup, target_.comp_makeup);
    Slew(current_.attack_coef, target_.attack_coef);
    Slew(current_.release_coef, target_.release_coef);
    Slew(current_.wow_depth, target_.wow_depth);
    Slew(current_.lowpass_coef, target_.lowpass_coef);
    Slew(current_.noise_amp, target_.noise_amp);
    Slew(current_.crackle_thresh, target_.crackle_thresh);
    Slew(current_.crackle_amp, target_.crackle_amp);
    Slew(current_.lofi_step, target_.lofi_step);
    Slew(current_.width_gain, target_.width_gain);
    Slew(current_.mix, target_.mix);
    Slew(current_.out_gain, target_.out_gain);

    lofi_shift_ = (Clamp(params_.lofi, 0, kParamMax) * 8 + 16383) >> 15;

    meter_comp_gain_ = block_comp_min_;
    meter_limiter_gain_ = block_limiter_min_;
    block_comp_min_ = kQ15One;
    block_limiter_min_ = kQ15One;
}

uint32_t Chain::NextRandom()
{
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return rng_;
}

int32_t Chain::Saturate(int32_t sample, int32_t &dc_in, int32_t &dc_out) const
{
    const Derived &d = current_;
    int32_t v = ((sample * d.drive_gain) >> 12) + d.sat_bias;
    v = Clamp(v, -32767, 32767);

    // y = 1.5v - 0.5v^3 reaches +-1 with zero slope
    const int32_t v2 = (v * v) >> 15;
    const int32_t v3 = (v2 * v) >> 15;
    const int32_t shaped = v + (v >> 1) - (v3 >> 1);
    int32_t y = v + (((Clamp(shaped, -32767, 32767) - v) * d.sat_amount) >> 15);
    y = (y * d.sat_makeup) >> 15;

    // Bias creates DC, remove it (~3 Hz)
    // The filter state keeps 12 fractional bits so the leak has no dead zone
    const int32_t acc = ((y - dc_in) << 12) + dc_out - (dc_out >> 11);
    dc_in = y;
    dc_out = acc;
    return Clamp(acc >> 12, -32767, 32767);
}

void Chain::ProcessSample(int32_t &left, int32_t &right)
{
    const Derived &d = current_;
    const size_t write_index = write_pos_ & kRingMask;

    // Dry path, delayed to match the wow stage
    const int32_t in_left = ClampQ15(left);
    const int32_t in_right = ClampQ15(right);
    dry_left_[write_index] = static_cast<int16_t>(in_left);
    dry_right_[write_index] = static_cast<int16_t>(in_right);
    const size_t dry_index = (write_pos_ - kLatencySamples) & kRingMask;
    const int32_t dry_left = dry_left_[dry_index];
    const int32_t dry_right = dry_right_[dry_index];

    // 1. Saturation
    int32_t l = Saturate(in_left, dc_in_left_, dc_out_left_);
    int32_t r = Saturate(in_right, dc_in_right_, dc_out_right_);

    // 2. Tone (tilt around ~700 Hz, flat at centre)
    tone_lp_left_ += ((l - tone_lp_left_) * kToneLowpassCoef) >> 15;
    tone_lp_right_ += ((r - tone_lp_right_) * kToneLowpassCoef) >> 15;
    l = ((tone_lp_left_ * (kQ15One - d.tone_tilt)) + ((l - tone_lp_left_) * (kQ15One + d.tone_tilt))) >> 15;
    r = ((tone_lp_right_ * (kQ15One - d.tone_tilt)) + ((r - tone_lp_right_) * (kQ15One + d.tone_tilt))) >> 15;
    l = Clamp(l, -32767, 32767);
    r = Clamp(r, -32767, 32767);

    // 3. Bus compressor (stereo linked peak detector)
    const int32_t level = (Abs(l) > Abs(r) ? Abs(l) : Abs(r)) << 6;
    const int32_t diff = level - comp_env_;
    if (diff > 0)
    {
        const int32_t step = (diff * d.attack_coef) >> 15;
        comp_env_ += step > 0 ? step : 1;
    }
    else
    {
        comp_env_ += (diff * d.release_coef) >> 20;
    }
    const int32_t env = comp_env_ >> 6;
    int32_t gain = kQ15One;
    if (env > d.comp_threshold)
    {
        const int32_t reduced = d.comp_threshold + ((env - d.comp_threshold) >> 2);
        gain = (reduced << 15) / env;
    }
    comp_gain_ = gain;
    if (gain < block_comp_min_)
    {
        block_comp_min_ = gain;
    }
    l = (((l * gain) >> 15) * d.comp_makeup) >> 12;
    r = (((r * gain) >> 15) * d.comp_makeup) >> 12;
    l = ClampQ15(l);
    r = ClampQ15(r);

    // 4. Vinyl: wow/flutter through a short modulated delay
    ring_left_[write_index] = static_cast<int16_t>(l);
    ring_right_[write_index] = static_cast<int16_t>(r);
    wow_phase_ += kWowInc;
    drift_phase_ += kDriftInc;
    flutter_phase_ += kFlutterInc;
    const int32_t depth = d.wow_depth;
    const int32_t modulation = ((Parabolic(wow_phase_) * depth) >> 15) + ((Parabolic(drift_phase_) * depth) >> 16) +
                               ((Parabolic(flutter_phase_) * (depth / 10)) >> 15);
    const uint32_t position = (write_pos_ << 8) - static_cast<uint32_t>((kLatencySamples << 8) + modulation);
    const size_t index0 = (position >> 8) & kRingMask;
    const size_t index1 = (index0 + 1) & kRingMask;
    const int32_t frac = static_cast<int32_t>(position & 255u);
    l = ring_left_[index0] + (((ring_left_[index1] - ring_left_[index0]) * frac) >> 8);
    r = ring_right_[index0] + (((ring_right_[index1] - ring_right_[index0]) * frac) >> 8);

    // Vinyl: high-frequency rolloff
    if (d.lowpass_coef >= kParamMax)
    {
        vinyl_lp_left_ = l;
        vinyl_lp_right_ = r;
    }
    else
    {
        vinyl_lp_left_ += ((l - vinyl_lp_left_) * d.lowpass_coef) >> 15;
        vinyl_lp_right_ += ((r - vinyl_lp_right_) * d.lowpass_coef) >> 15;
        l = vinyl_lp_left_;
        r = vinyl_lp_right_;
    }

    // Vinyl: hiss and crackle
    if (d.noise_amp > 0 || d.crackle_thresh > 0)
    {
        const uint32_t random = NextRandom();
        l += (((static_cast<int32_t>(random >> 16)) - 32768) * d.noise_amp) >> 15;
        r += (((static_cast<int32_t>(random & 0xFFFFu)) - 32768) * d.noise_amp) >> 15;
        if (static_cast<int32_t>(NextRandom() & 0xFFFFu) < d.crackle_thresh)
        {
            pop_ = (((static_cast<int32_t>(NextRandom() >> 16)) - 32768) * d.crackle_amp) >> 15;
        }
        l += pop_;
        r += (pop_ * 3) >> 2;
        pop_ = (pop_ * 26000) >> 15;
    }

    // 5. Lo-fi: sample rate then bit depth reduction
    lofi_phase_ += d.lofi_step;
    if (lofi_phase_ >= 256)
    {
        lofi_phase_ -= 256;
        hold_left_ = l;
        hold_right_ = r;
    }
    l = hold_left_;
    r = hold_right_;
    if (lofi_shift_ > 0)
    {
        const int32_t half = 1 << (lofi_shift_ - 1);
        l = ((ClampQ15(l) + half) >> lofi_shift_) << lofi_shift_;
        r = ((ClampQ15(r) + half) >> lofi_shift_) << lofi_shift_;
    }

    // 6. Stereo width (mid/side)
    const int32_t mid = (l + r) >> 1;
    const int32_t side = (((l - r) >> 1) * d.width_gain) >> 12;
    l = Clamp(mid + side, -32767, 32767);
    r = Clamp(mid - side, -32767, 32767);

    // 7. Dry/wet
    l = ((dry_left * (kQ15One - d.mix)) + (l * d.mix)) >> 15;
    r = ((dry_right * (kQ15One - d.mix)) + (r * d.mix)) >> 15;

    // 8. Output trim and limiter
    l = (l * d.out_gain) >> 12;
    r = (r * d.out_gain) >> 12;
    const int32_t peak = Abs(l) > Abs(r) ? Abs(l) : Abs(r);
    int32_t limit_target = kQ15One;
    if (peak > kLimiterCeiling)
    {
        limit_target = (kLimiterCeiling << 15) / peak;
    }
    if (limit_target < limiter_gain_)
    {
        limiter_gain_ = limit_target;
    }
    else
    {
        const int32_t recover = kQ15One - limiter_gain_;
        limiter_gain_ += (recover >> 10) + (recover > 0 ? 1 : 0);
        if (limiter_gain_ > limit_target)
        {
            limiter_gain_ = limit_target;
        }
    }
    if (limiter_gain_ < block_limiter_min_)
    {
        block_limiter_min_ = limiter_gain_;
    }
    l = ClampQ15((l * limiter_gain_) >> 15);
    r = ClampQ15((r * limiter_gain_) >> 15);

    // 9. Click-free bypass
    const int32_t bypass_target = params_.bypass ? kQ15One : 0;
    if (bypass_amount_ < bypass_target)
    {
        bypass_amount_ = Clamp(bypass_amount_ + kBypassStep, 0, bypass_target);
    }
    else if (bypass_amount_ > bypass_target)
    {
        bypass_amount_ = Clamp(bypass_amount_ - kBypassStep, bypass_target, kQ15One);
    }
    left = ((l * (kQ15One - bypass_amount_)) + (dry_left * bypass_amount_)) >> 15;
    right = ((r * (kQ15One - bypass_amount_)) + (dry_right * bypass_amount_)) >> 15;

    write_pos_++;
}

} // namespace kastle2::masterblaster
