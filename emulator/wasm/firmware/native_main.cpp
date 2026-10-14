// Command-line driver for the native debug build: boots the app and runs some blocks.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <vector>

extern "C"
{
    void fw_boot();
    void fw_run_block(int);
    void fw_set_adc(int, int, int);
    unsigned char *fw_user_data_ptr();
    int *fw_output();
    int fw_get_led(int);
}

int main(int argc, char **argv)
{
    if (argc > 1)
    {
        std::ifstream f(argv[1], std::ios::binary);
        std::vector<char> data((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
        std::memcpy(fw_user_data_ptr(), data.data(), data.size());
    }
    const int pot_route[8] = {0, 1, 6, 7, 2, 0, 3, 5}; // POT_1..7 -> mux on ADC1
    for (int n = 1; n <= 7; n++) fw_set_adc(1, pot_route[n], 2000);
    fw_boot();
    std::puts("booted");
    for (int b = 0; b < 100; b++) fw_run_block(4);
    std::puts("ran 100 blocks");
    return 0;
}
