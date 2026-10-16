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

#pragma once

// Pure integer granular texture processor. No firmware dependencies, so it can be unit tested on the host and compiled
// to WebAssembly for the emulator.

#include <cstddef>
#include <cstdint>

namespace kastle2::beads
{

constexpr int32_t kParamMax = 32767;
constexpr int32_t kParamCentre = 16384;

/// The four recording qualities of Beads, sized for the RP2040's RAM.
enum class Media : uint8_t
{
    DIRTY_TAPE = 0,      ///< 8-bit mu-law, 22 kHz, longest buffer, dark and noisy
    CLEAN_TAPE = 1,      ///< 16-bit, 22 kHz, soft-saturating feedback
    VINTAGE_DIGITAL = 2, ///< 8-bit mu-law, 44 kHz
    DIGITAL = 3,         ///< 16-bit, 44 kHz, shortest buffer, transparent
    COUNT
};

/// Everything the processor needs, filled by the app once per UI loop.
/// Knobs are 0..kParamMax; pitch and the attenuverters are centred at kParamCentre. CV values are bipolar Q15 where
/// kParamMax = full scale (+5 V). Unused CV channels must be 0.
struct Params
{
    int32_t time = 16384;    ///< Where in the buffer grains start (granular), loop slice (delay, frozen)
    int32_t size = 16384;    ///< Grain length: reversed (CCW) -> short -> long forward (CW). Fully CW = delay mode
    int32_t shape = 16384;   ///< Grain envelope: square -> decay -> bell -> reverse
    int32_t density = 20000; ///< < 0.48 regular grains, ~0.5 manual/seed only, > 0.52 random grains
    int32_t pitch = 16384;   ///< +-24 semitones around the centre (fine near the middle)

    int32_t time_amt = 16384;  ///< Attenuverters: scale the CV if it's patched, else the amount of per-grain randomness
    int32_t size_amt = 16384;  ///< (size amount also sets the bandwidth in delay mode)
    int32_t shape_amt = 16384; ///<
    int32_t pitch_amt = 16384; ///<

    int32_t time_cv = 0;
    int32_t size_cv = 0;
    int32_t shape_cv = 0;
    int32_t density_cv = 0;
    int32_t pitch_cv_semitones_q8 = 0; ///< Pitch CV in semitones * 256 (1 V/oct = 12 * 256 per volt)
    bool time_has_cv = false;
    bool size_has_cv = false;
    bool shape_has_cv = false;
    bool pitch_has_cv = false;

    int32_t feedback = 8000;
    int32_t dry_wet = 16384;
    int32_t reverb = 6000;

    bool freeze = false;
    bool seed_locked = true; ///< Free-running grains. Unlocked: grains/taps only on a seed event
    bool seed_gate = false;  ///< Seed button or jack is high
    Media media = Media::DIGITAL;
};

/// 0..4095 style helpers shared with the app and the tests.
int32_t Clamp(int32_t value, int32_t low, int32_t high);


// ---- control mapping helpers shared by the app and the tests

/// Bipolar Q15 from a CV in ADC units (ADC_5V = full scale)
int32_t CvToQ15(int32_t adc, int32_t adc_5v);

/// Semitones * 256 from a 1 V/oct CV in ADC units
int32_t CvToSemitonesQ8(int32_t adc, int32_t adc_1v);

/// Beads detects patched CV jacks with a noise-injection trick. The Citadel can't, so a jack counts as patched for a
/// few seconds after it was last seen moving by more than ~100 mV.
class CvPresence
{
public:
    static constexpr uint32_t kHoldMs = 4000;
    void Update(int32_t adc, int32_t threshold_adc, uint32_t now_ms)
    {
        if ((adc < 0 ? -adc : adc) > threshold_adc)
        {
            last_seen_ms_ = now_ms;
            seen_ = true;
        }
    }
    bool Present(uint32_t now_ms) const
    {
        return seen_ && (now_ms - last_seen_ms_) < kHoldMs;
    }

private:
    uint32_t last_seen_ms_ = 0;
    bool seen_ = false;
};

/// A button that toggles/fires on release, unless a knob was moved while it was held or it was held for too long.
class TapDetector
{
public:
    static constexpr uint32_t kMaxTapMs = 500;
    void OnPress(uint32_t now_ms)
    {
        pressed_at_ = now_ms;
        knob_moved_ = false;
    }
    void OnKnobMoved()
    {
        knob_moved_ = true;
    }
    /// @return True if this release is a tap
    bool OnRelease(uint32_t now_ms)
    {
        const bool tap = !knob_moved_ && (now_ms - pressed_at_) <= kMaxTapMs;
        knob_moved_ = false;
        return tap;
    }

private:
    uint32_t pressed_at_ = 0;
    bool knob_moved_ = false;
};

/// SHIFT+K2: four zones
Media MediaFromKnob(int32_t knob);

/// Which of the three mix parameters the "assign" CV controls: 0 feedback, 1 dry/wet, 2 reverb (MODE+K6)
int AssignDestinationFromKnob(int32_t knob);

/// Applies the assign CV and clamps. Returns the three mix parameters in place.
void ApplyAssignCv(Params &p, int destination, int32_t cv_q15);

class Engine
{
public:
    static constexpr int kMaxGrains = 16; ///< 10 are used at 44 kHz
    static constexpr int kGhosts = 4; ///< Stolen grains finishing their fade-out
    static constexpr uint32_t kDelayBytes = 128 * 1024;
    static constexpr int kReverbWords = 10240;
    static constexpr int kBlockFrames = 48;
    static constexpr int kSampleRate = 44000;

    void Init();
    void Init(const Params &params);
    void SetParams(const Params &params);

    /// Processes interleaved stereo audio (Q15 in 32-bit containers). `frames` must be even.
    void Process(const int32_t *input, int32_t *output, size_t frames);

    int ActiveGrains() const;
    bool DelayMode() const
    {
        return delay_mode_;
    }
    bool Frozen() const
    {
        return frozen_;
    }
    /// Triggers (grains or taps) since the last call, for LEDs.
    int TakeTriggerCount()
    {
        const int n = trigger_count_;
        trigger_count_ = 0;
        return n;
    }
    /// Highest limiter gain reduction in the last block, Q15 (32768 = none).
    int32_t LimiterGain() const
    {
        return meter_limiter_gain_;
    }
    /// Frames of audio the current media can hold, and the sample rate it's recorded at.
    int BufferFrames() const
    {
        return static_cast<int>(capacity_);
    }
    int EngineSampleRate() const
    {
        return kSampleRate / ratio_;
    }
    Media GetMedia() const
    {
        return media_;
    }

private:
    struct Grain
    {
        int32_t delay = 0; // frames behind the write head, Q10
        int32_t speed = 1024;
        int32_t gain[2][2] = {};
        int32_t amp = 0;
        uint8_t stage = 3; // 0 attack, 1 sustain, 2 release, 3 done
        uint32_t phase = 0; // Q16 within the stage
        uint32_t inc[3] = {};
        int32_t smooth = 0; // Q15
        int32_t remaining = 0;
        int32_t fade = 32768;      // forced fade-out multiplier (ghosts), Q15
        int32_t fade_step = 0;     // per-sample decrement, 0 = not fading
        bool active() const
        {
            return stage < 3;
        }
    };

    struct Limiter
    {
        int32_t peak = 0;
        int32_t gain = 32768;
    };

    void UpdateBlock();
    void ProcessBlock(const int32_t *input, int32_t *output, size_t frames);
    void RunEngine(int frames);
    void RecordStep(int32_t in_l, int32_t in_r);
    void TrackOutput(int32_t wet_l, int32_t wet_r);
    void WriteFrame(int32_t l, int32_t r);
    void ReadFrame(int32_t delay_frames, int32_t &l, int32_t &r) const;
    void ReadFrameInterpolated(int32_t delay_q10, int32_t &l, int32_t &r) const;
    void StartGrain();
    template <bool kBits8>
    void RenderGrainChunk(int32_t *out_l, int32_t *out_r, int n, int shift);
    void RenderTaps(int32_t &out_l, int32_t &out_r);
    bool NextTrigger();
    int32_t EvaluateParam(int32_t base, int32_t amount, int32_t cv, bool has_cv, bool clamp, int32_t range_q15,
                          bool use_random_walk, int walk_index);
    void ReverbStep(int32_t in_mono, int32_t &out_l, int32_t &out_r);
    int32_t LimitSample(Limiter &lim, int32_t &l, int32_t &r, int32_t threshold, int release_shift);
    int32_t Dry(int32_t sample) const;
    uint32_t Rand();
    int32_t RandQ15();

    void ConfigureMedia(Media media);
    void ResetBuffers();

    // ----- parameters
    Params params_;
    Params target_;
    Media media_ = Media::DIGITAL;
    int ratio_ = 1;          // 1: 44 kHz, 2: 22 kHz engine
    bool bits8_ = false;     // mu-law storage
    uint32_t capacity_ = 0;  // frames, power of two
    uint32_t mask_ = 0;
    int32_t lp_coef_ = 32735;
    int32_t softlimit_gain_ = 0; // Q12 (4096 = 1.0), 0 = off
    int32_t fb_scale_q8_ = 0;
    bool caveman_ = false;

    // ----- delay line
    alignas(4) uint8_t memory_[kDelayBytes];
    uint32_t write_pos_ = 0;
    int32_t written_ = 0; // frames recorded since the last reset, saturating
    bool frozen_ = false;

    // ----- trigger generator
    uint32_t trig_phase_ = 0;
    uint32_t max_inc_ = 0;
    uint32_t trig_inc_ = 0;
    int32_t random_ratio_q12_ = 4096;
    bool randomize_ = false;
    bool trig_gate_ = false;
    bool prev_gate_ = false;
    bool trigger_enabled_ = false;
    int32_t regularity_ = 0;
    int trigger_count_ = 0;

    // ----- grains
    Grain grains_[kMaxGrains + kGhosts];
    int grain_interval_ = 0;
    int max_grain_frames_ = 0;
    int safety_frames_ = 0;

    // ----- delay mode
    bool delay_mode_ = false;
    bool want_delay_mode_ = false;
    int32_t mode_fade_ = 32768;
    int32_t tap_delay_q10_[2] = {};
    int32_t tap_target_[2] = {};
    int32_t tap_gain_[2] = {};
    int32_t tap_lp_coef_ = 8000;
    int32_t bandwidth_coef_ = 32767;
    int32_t bw_state_[2] = {};
    int32_t loop_start_ = 0;
    int32_t loop_len_ = 0;
    int32_t tap_lfo_ = 0;
    uint32_t tap_lfo_phase_ = 0;
    bool was_frozen_ = false;

    // ----- feedback / output
    int32_t prev_l_ = 0, prev_r_ = 0;
    int32_t dc_x_[2] = {}, dc_y_[2] = {};
    Limiter input_limiter_, pre_reverb_limiter_, output_limiter_;
    int32_t feedback_ = 0, dry_gain_ = 0, wet_gain_ = 0;
    int32_t feedback_target_ = 0, dry_target_ = 0, wet_target_ = 0;
    int32_t wet_prev_[2] = {};
    int32_t src_hist_[2] = {};

    // ----- randomness
    uint32_t rng_ = 0x2545F491u;

    // ----- reverb (22 kHz)
    int16_t reverb_mem_[kReverbWords] = {};
    int32_t rv_lp1_ = 0, rv_lp2_ = 0;
    int32_t rv_time_ = 0, rv_lp_ = 0, rv_send_ = 0, rv_wet_ = 0;
    uint32_t rv_lfo1_ = 0, rv_lfo2_ = 0;
    int32_t rv_prev_[2] = {};
    int rv_pos_[10] = {};
    int rv_idle_ = 0;
    bool rv_active_ = true;
    int32_t reverb_amount_ = 0;
    int32_t reverb_dry_ = 32768;

    // Engine-rate buffers for one 48-frame block
    int32_t eng_in_[2][kBlockFrames] = {};
    int32_t eng_out_[2][kBlockFrames] = {};
    static constexpr int kMaxChunk = 16;

    int32_t meter_limiter_gain_ = 32768;
    int32_t block_limiter_min_ = 32768;
};

} // namespace kastle2::beads
