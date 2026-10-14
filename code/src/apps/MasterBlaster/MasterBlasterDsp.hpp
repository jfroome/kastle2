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

#pragma once

// Pure integer DSP for MasterBlaster. It has no firmware dependencies so it can be unit tested on the host.

#include <cstddef>
#include <cstdint>

namespace kastle2::masterblaster
{

/// All parameters are 0..kParamMax.
constexpr int32_t kParamMax = 32767;

struct Params
{
    int32_t drive = 8000;       ///< Input gain + saturation amount
    int32_t tone = 16384;       ///< Tilt EQ, centre = flat
    int32_t comp = 9000;        ///< Bus compressor amount (threshold + auto makeup), 0 = off
    int32_t comp_speed = 16384; ///< Bus compressor attack/release, higher = faster
    int32_t vinyl = 0;          ///< HF rolloff, hiss and crackle
    int32_t wow = 0;            ///< Wow and flutter depth
    int32_t lofi = 0;           ///< Sample rate + bit depth reduction
    int32_t width = 16384;      ///< Stereo width, centre = unchanged
    int32_t mix = kParamMax;    ///< Dry/wet
    int32_t output = 23170;     ///< Output trim, ~0.707 = unity
    bool bypass = false;
};

/// 0..4095 pot to 0..kParamMax.
int32_t PotToParam(int32_t pot_value, int32_t pot_max);

/// Adds a CV (ADC units, 0 V = no change, adc_5v = full range) to a parameter. Unpatched jacks read 0 V.
int32_t ApplyCv(int32_t param, int32_t cv_adc, int32_t adc_5v);

/// MODE button short press toggles bypass, but not when the button was used as a layer modifier for a knob.
class BypassToggle
{
public:
    void OnPress()
    {
        knob_moved_ = false;
    }
    void OnKnobMoved()
    {
        knob_moved_ = true;
    }
    /// @return True if bypass should be toggled
    bool OnRelease()
    {
        const bool toggle = !knob_moved_;
        knob_moved_ = false;
        return toggle;
    }

private:
    bool knob_moved_ = false;
};

class Chain
{
public:
    static constexpr int32_t kLatencySamples = 96; ///< Fixed delay of the wow stage, dry path is matched
    static constexpr int32_t kLimiterCeiling = 31000;

    void Init();
    /// Init with the smoothed parameters already settled at the given values
    void Init(const Params &params);
    void SetParams(const Params &params);

    /// Processes interleaved stereo audio (Q15 in 32-bit containers).
    template <typename T>
    void Process(const T *input, T *output, size_t frames)
    {
        UpdateBlock();
        for (size_t i = 0; i < frames; i++)
        {
            int32_t left = input[2 * i];
            int32_t right = input[2 * i + 1];
            ProcessSample(left, right);
            output[2 * i] = static_cast<T>(left);
            output[2 * i + 1] = static_cast<T>(right);
        }
    }

    /// Lowest compressor gain (Q15, 32768 = no reduction) in the last block.
    int32_t GetCompGain() const
    {
        return meter_comp_gain_;
    }
    /// Lowest limiter gain (Q15, 32768 = no limiting) in the last block.
    int32_t GetLimiterGain() const
    {
        return meter_limiter_gain_;
    }
    /// 0..32768 bypass crossfade position.
    int32_t GetBypassAmount() const
    {
        return bypass_amount_;
    }

private:
    static constexpr size_t kRingSize = 256;
    static constexpr size_t kRingMask = kRingSize - 1;

    // Values derived from Params, slewed once per block to avoid zipper noise.
    struct Derived
    {
        int32_t drive_gain = 4096; // Q12
        int32_t sat_amount = 0;    // Q15
        int32_t sat_bias = 0;
        int32_t sat_makeup = 32767; // Q15
        int32_t tone_tilt = 0;      // Q15, -1..1
        int32_t comp_threshold = 32767;
        int32_t comp_makeup = 4096; // Q12
        int32_t attack_coef = 700;  // Q15
        int32_t release_coef = 600; // Q20
        int32_t wow_depth = 0;      // Q8 samples
        int32_t lowpass_coef = 32767;
        int32_t noise_amp = 0;
        int32_t crackle_thresh = 0;
        int32_t crackle_amp = 0;
        int32_t lofi_step = 256; // Q8 phase increment
        int32_t width_gain = 4096;
        int32_t mix = 32768;
        int32_t out_gain = 4096;
    };

    void UpdateBlock();
    void ProcessSample(int32_t &left, int32_t &right);
    int32_t Saturate(int32_t sample, int32_t &dc_in, int32_t &dc_out) const;
    uint32_t NextRandom();

    Params params_;
    Derived current_;
    Derived target_;

    int16_t ring_left_[kRingSize] = {};
    int16_t ring_right_[kRingSize] = {};
    int16_t dry_left_[kRingSize] = {};
    int16_t dry_right_[kRingSize] = {};
    uint32_t write_pos_ = 0;

    int32_t dc_in_left_ = 0, dc_out_left_ = 0, dc_in_right_ = 0, dc_out_right_ = 0;
    int32_t tone_lp_left_ = 0, tone_lp_right_ = 0;
    int32_t comp_env_ = 0; // Q15 << 6
    int32_t comp_gain_ = 32768;
    uint32_t wow_phase_ = 0, flutter_phase_ = 0, drift_phase_ = 0;
    int32_t vinyl_lp_left_ = 0, vinyl_lp_right_ = 0;
    int32_t pop_ = 0;
    uint32_t rng_ = 0x1234567u;
    int32_t lofi_phase_ = 0;
    int32_t lofi_shift_ = 0;
    int32_t hold_left_ = 0, hold_right_ = 0;
    int32_t limiter_gain_ = 32768;
    int32_t bypass_amount_ = 0;

    int32_t meter_comp_gain_ = 32768;
    int32_t meter_limiter_gain_ = 32768;
    int32_t block_comp_min_ = 32768;
    int32_t block_limiter_min_ = 32768;
};

} // namespace kastle2::masterblaster
