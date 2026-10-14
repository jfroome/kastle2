#pragma once
// Stand-in for lib/I2S.hpp (PIO/DMA driver). The emulator calls the audio callback itself.
#include <cstddef>
#include <cstdint>

class I2S
{
public:
    static constexpr size_t kAudioBufferSize = 48;
    static constexpr size_t kAudioBufferFrames = kAudioBufferSize * 2;
    typedef void (*AudioCallback)(int32_t *input, int32_t *output, size_t size);

    struct Pins
    {
        size_t mclk;
        size_t dout;
        size_t din;
        size_t bclk;
    };

    void Init(const float sample_rate, const Pins &pins)
    {
        sample_rate_ = sample_rate;
        pins_ = pins;
    }
    void StartAudio(const AudioCallback callback)
    {
        callback_ = callback;
        if (callback) installed_callback = callback;
    }
    static inline AudioCallback installed_callback = nullptr;

private:
    AudioCallback callback_ = nullptr;
    Pins pins_ = {0, 0, 0, 0};
    float sample_rate_ = 0.0f;
};
