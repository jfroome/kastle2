cmake_minimum_required(VERSION 3.13)

project(kastle2_tests LANGUAGES CXX)

enable_testing()

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(master_blaster_tests
    master_blaster_tests.cpp
)

target_include_directories(master_blaster_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../src
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/apps/MasterBlaster
)

add_test(NAME master_blaster_drive COMMAND master_blaster_tests drive)
add_test(NAME master_blaster_mix COMMAND master_blaster_tests mix)
add_test(NAME master_blaster_crush COMMAND master_blaster_tests crush)
add_test(NAME master_blaster_maps COMMAND master_blaster_tests maps)
add_test(NAME master_blaster_stability COMMAND master_blaster_tests stability)
add_test(NAME master_blaster_tuning COMMAND master_blaster_tests tuning)
add_test(NAME master_blaster_stereo COMMAND master_blaster_tests stereo)
add_test(NAME master_blaster_compression COMMAND master_blaster_tests compression)
add_test(NAME master_blaster_buzz COMMAND master_blaster_tests buzz)
