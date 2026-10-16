cmake_minimum_required(VERSION 3.13)

project(kastle2_tests LANGUAGES CXX)

enable_testing()

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(master_blaster_tests
    master_blaster_tests.cpp
    ../src/apps/MasterBlaster/MasterBlasterDsp.cpp
)

target_include_directories(master_blaster_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../src
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/apps/MasterBlaster
)

add_test(NAME master_blaster_bounds COMMAND master_blaster_tests bounds)
add_test(NAME master_blaster_silence COMMAND master_blaster_tests silence)
add_test(NAME master_blaster_transparent COMMAND master_blaster_tests transparent)
add_test(NAME master_blaster_mix COMMAND master_blaster_tests mix)
add_test(NAME master_blaster_drive COMMAND master_blaster_tests drive)
add_test(NAME master_blaster_compression COMMAND master_blaster_tests compression)
add_test(NAME master_blaster_comp_timing COMMAND master_blaster_tests comp_timing)
add_test(NAME master_blaster_lofi COMMAND master_blaster_tests lofi)
add_test(NAME master_blaster_wow COMMAND master_blaster_tests wow)
add_test(NAME master_blaster_vinyl COMMAND master_blaster_tests vinyl)
add_test(NAME master_blaster_width COMMAND master_blaster_tests width)
add_test(NAME master_blaster_switch_map COMMAND master_blaster_tests switch_map)
add_test(NAME master_blaster_switch_debounce COMMAND master_blaster_tests switch_debounce)
add_test(NAME master_blaster_noise_types COMMAND master_blaster_tests noise_types)
add_test(NAME master_blaster_noise_live COMMAND master_blaster_tests noise_live)
add_test(NAME master_blaster_wow_speeds COMMAND master_blaster_tests wow_speeds)
add_test(NAME master_blaster_wow_steady COMMAND master_blaster_tests wow_steady)
add_test(NAME master_blaster_knob_glide COMMAND master_blaster_tests knob_glide)
add_test(NAME master_blaster_limiter COMMAND master_blaster_tests limiter)
add_test(NAME master_blaster_bypass COMMAND master_blaster_tests bypass)
add_test(NAME master_blaster_sweep COMMAND master_blaster_tests sweep)
add_test(NAME master_blaster_maps COMMAND master_blaster_tests maps)
add_test(NAME master_blaster_bypass_toggle COMMAND master_blaster_tests bypass_toggle)

add_executable(beads_tests
    beads_tests.cpp
    ../src/apps/Beads/BeadsDsp.cpp
)

target_include_directories(beads_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../src
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/apps/Beads
)

foreach(name silence dry grains freeze density seed size pitch feedback delay reverb media media_switch sweep
        deterministic grain_budget controls)
    add_test(NAME beads_${name} COMMAND beads_tests ${name})
endforeach()
