#pragma once
// Force-included into every firmware translation unit. libstdc++ (used by the ARM build) pulls these in
// transitively from other standard headers; libc++ (Emscripten) does not.
#ifdef __cplusplus
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <limits>
#include <memory>
#include <numeric>
#include <utility>
#endif
