# Copilot Instructions for Kastle 2 Firmware Work

## Core rule
Every meaningful change to the firmware must be accompanied by tests that validate the real behavior of the affected subsystem before the code is considered complete.

## Required workflow for every iteration
1. Identify the intended behavior change.
2. Add or extend tests that describe the expected behavior.
3. Run the relevant test target.
4. Fix the implementation until the tests pass.
5. Re-run the targeted checks.
6. Only then consider the change ready for hardware validation.

## Testing expectations
- Prefer unit tests for DSP math, parameter mapping, state transitions, and mode logic.
- Prefer integration tests for end-to-end signal processing and app-level behavior.
- Cover edge cases: zero input, max input, clipping, hysteresis, mode transitions, and all major parameter ranges.
- Keep tests deterministic and host-runnable whenever possible.
- For firmware logic that cannot run on host, isolate it into pure functions and test those functions directly.

## Test coverage goals
- All DSP helpers must have boundary and monotonicity tests.
- All mapping functions must be tested across their full parameter ranges.
- All app mode changes must be tested for valid transitions and no invalid states.
- All signal path combinations must be verified for clipping, mixing, and output bounds.
- Any new hardware API usage should be paired with a pure logic test that proves the mapping and limits.

## Required documentation updates
When a change adds a feature, DSP block, UI mode, or parameter mapping, update the relevant design notes and add tests that cover it. Do not treat tests as optional or as something to do only after the firmware is already working.

## LLM operating rule
On each iteration, continue augmenting the test suite before or alongside implementation changes. If a change affects audio processing, control logic, or UI behavior, the LLM must add tests that exercise the behavior and then verify those tests pass.

## Minimum acceptance bar
A patch is not complete unless:
- the affected tests pass,
- the new behavior is covered by a test,
- the code path has been checked for edge conditions,
- and the change is documented in the relevant project notes or app documentation.

## Firmware safety principle
Treat the hardware as the final validation step, not the first one. The unit and integration test suite is the safety net that prevents shipping broken firmware to the actual unit.
