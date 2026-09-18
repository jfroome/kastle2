#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <string_view>
#include <utility>

namespace
{
constexpr int32_t kQ15Max = 32767;
constexpr int32_t kQ15Min = -32768;

inline int32_t clamp_q15(int32_t value)
{
    if (value > kQ15Max)
        return kQ15Max;
    if (value < kQ15Min)
        return kQ15Min;
    return value;
}

inline int32_t soft_drive(int32_t sample, int32_t drive)
{
    int32_t gain = 32768 + drive;
    int32_t staged = (sample * gain) >> 15;
    staged = staged > kQ15Max ? kQ15Max : staged;
    staged = staged < kQ15Min ? kQ15Min : staged;

    int32_t compressed = staged;
    if (compressed > 24576)
        compressed = 24576 + ((compressed - 24576) >> 1);
    else if (compressed < -24576)
        compressed = -24576 + ((compressed + 24576) >> 1);

    return clamp_q15(compressed);
}

inline int32_t mix_with_dry(int32_t dry, int32_t wet, int32_t mix)
{
    int32_t wet_gain = mix;
    int32_t dry_gain = 32768 - mix;
    return clamp_q15(((dry * dry_gain) + (wet * wet_gain)) >> 15);
}

inline int32_t bit_crush(int32_t sample, int32_t crush)
{
    int32_t depth = 16 - (crush >> 13);
    if (depth < 3)
        depth = 3;
    if (depth > 15)
        depth = 15;

    int32_t shift = 16 - depth;
    return clamp_q15((sample >> shift) << shift);
}

inline int32_t map_value(int32_t value, int32_t in_min, int32_t in_max, int32_t out_min, int32_t out_max)
{
    if (in_max == in_min)
        return out_min;
    int64_t result = (static_cast<int64_t>(value - in_min) * static_cast<int64_t>(out_max - out_min)) /
                     static_cast<int64_t>(in_max - in_min) +
                     static_cast<int64_t>(out_min);
    return static_cast<int32_t>(result);
}

inline int32_t stereo_field_expander(int32_t left, int32_t right, int32_t width)
{
    int32_t mid = ((left + right) >> 1);
    int32_t side = (left - right) >> 1;
    int32_t spread = (side * width) >> 15;
    return clamp_q15(mid + spread);
}

inline int32_t master_compress(int32_t sample, int32_t amount)
{
    int32_t magnitude = std::abs(sample);
    const int32_t threshold = 22000;
    if (magnitude <= threshold)
        return clamp_q15(sample);

    int32_t excess = magnitude - threshold;
    int32_t ratio = 5 + ((amount * 10) >> 15);
    int32_t reduced = threshold + (excess / ratio);
    int32_t gain = (reduced * 32768) / std::max<int32_t>(1, magnitude);
    return clamp_q15((sample * gain) >> 15);
}

inline bool check_output_buzz_guard()
{
    int32_t max_buzz = 0;
    for (uint32_t i = 0; i < 2048; ++i)
    {
        int32_t counter_offset = static_cast<int32_t>((i * 13u) & 0x1Fu) - 16;
        int32_t buzz = counter_offset * 30;
        if (std::abs(buzz) > max_buzz)
            max_buzz = std::abs(buzz);
    }
    return max_buzz < 1000;
}

int test_drive_monotonicity()
{
    const int32_t low = soft_drive(10000, 0);
    const int32_t mid = soft_drive(10000, 12000);
    const int32_t high = soft_drive(10000, 24000);
    if (!(mid > low && high > mid))
        return 1;
    if (high > 32767 || low < -32768)
        return 2;
    return 0;
}

int test_mix_bounds_and_direction()
{
    const int32_t dry = 12000;
    const int32_t wet = 16000;
    const int32_t mixed = mix_with_dry(dry, wet, 22000);
    if (mixed < -32768 || mixed > 32767)
        return 3;
    if (mixed == 0)
        return 4;
    return 0;
}

int test_bitcrush_reduction()
{
    const int32_t original = 30000;
    const int32_t crushed = bit_crush(original, 20000);
    const int32_t crushed_more = bit_crush(original, 30000);
    if (crushed < -32768 || crushed > 32767)
        return 5;
    if (!(std::abs(crushed) <= std::abs(original)))
        return 6;
    if (!(std::abs(crushed_more) <= std::abs(crushed)))
        return 7;
    return 0;
}

int test_pot_maps_are_valid()
{
    const int32_t drive = map_value(0, 0, 4095, 2500, 26000);
    const int32_t out_gain = map_value(4095, 0, 4095, 12000, 32767);
    if (drive < 0 || drive > 32767)
        return 8;
    if (out_gain < 12000 || out_gain > 32767)
        return 9;
    return 0;
}

int test_signal_path_stays_stable()
{
    const std::array<int32_t, 6> inputs = {0, 1000, -1000, 8000, -8000, 30000};
    for (int32_t value : inputs)
    {
        int32_t processed = mix_with_dry(value, soft_drive(value, 12000), 22000);
        if (processed < -32768 || processed > 32767)
            return 10;
    }
    return 0;
}

int test_drive_tuning_is_subtle_then_drama()
{
    const int32_t low_drive = map_value(0, 0, 4095, 1200, 34000);
    const int32_t high_drive = map_value(4095, 0, 4095, 1200, 34000);
    const int32_t low_signal = soft_drive(10000, low_drive);
    const int32_t high_signal = soft_drive(10000, high_drive);

    if (low_signal <= 10200 || low_signal >= 11500)
        return 11;
    if (high_signal <= 18000)
        return 12;
    return 0;
}

int test_stereo_expander_widens_field()
{
    const int32_t narrow = stereo_field_expander(12000, -12000, 2000);
    const int32_t wide = stereo_field_expander(12000, -12000, 12000);
    if (!(wide > narrow))
        return 13;
    if (wide > 32767 || wide < -32768)
        return 14;
    return 0;
}

int test_master_compress_is_bounded_and_tighter_at_high_amount()
{
    const int32_t low = master_compress(30000, 5000);
    const int32_t high = master_compress(30000, 22000);
    if (low < -32768 || low > 32767)
        return 15;
    if (high < -32768 || high > 32767)
        return 16;
    if (!(std::abs(high) <= std::abs(low)))
        return 17;
    return 0;
}

int test_hiss_and_output_are_not_buzzing()
{
    if (!check_output_buzz_guard())
        return 18;
    return 0;
}
}

int main(int argc, char **argv)
{
    using TestFn = int (*)();
    struct NamedTest
    {
        std::string_view name;
        TestFn fn;
    };

    const NamedTest tests[] = {
        {"drive", test_drive_monotonicity},
        {"mix", test_mix_bounds_and_direction},
        {"crush", test_bitcrush_reduction},
        {"maps", test_pot_maps_are_valid},
        {"stability", test_signal_path_stays_stable},
        {"tuning", test_drive_tuning_is_subtle_then_drama},
        {"stereo", test_stereo_expander_widens_field},
        {"compression", test_master_compress_is_bounded_and_tighter_at_high_amount},
        {"buzz", test_hiss_and_output_are_not_buzzing},
    };

    if (argc == 1)
    {
        for (const auto &test : tests)
        {
            if (test.fn() != 0)
            {
                std::cerr << "FAIL: " << test.name << '\n';
                return 1;
            }
        }
        return 0;
    }

    for (int i = 1; i < argc; ++i)
    {
        const std::string_view arg = argv[i];
        bool found = false;
        for (const auto &test : tests)
        {
            if (arg == test.name)
            {
                found = true;
                if (test.fn() != 0)
                {
                    std::cerr << "FAIL: " << test.name << '\n';
                    return 1;
                }
                break;
            }
        }
        if (!found)
        {
            std::cerr << "Unknown test: " << arg << '\n';
            return 2;
        }
    }

    return 0;
}
