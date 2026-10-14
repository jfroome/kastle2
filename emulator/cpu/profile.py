#!/usr/bin/env python3
"""
Cycle estimate of the real firmware on the RP2040 (dual Cortex-M0+ @ 176 MHz).

The firmware host built for ARM (cpu/build_arm.sh, -O3, same sources as the wasm build) runs in the Unicorn
instruction-set simulator. Every basic block is costed with the Cortex-M0+ timing table below; the numbers are
cycles of the audio callback per 48-sample block, compared with the 192,000-cycle budget of one block.

Modelled: instruction timings, real compiler output, real firmware data flow (Base + app).
Not modelled: flash/XIP cache misses and bus contention between the cores, the SDK's hardware divider and
bootrom float routines (libgcc's software versions are used, so divide/float-heavy code is pessimistic).
"""
import json
import random
import struct
import sys
from pathlib import Path

import capstone
from elftools.elf.elffile import ELFFile
from unicorn import (UC_ARCH_ARM, UC_HOOK_BLOCK, UC_HOOK_CODE, UC_MODE_MCLASS, UC_MODE_THUMB, Uc)
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_SP

ROOT = Path(__file__).resolve().parent.parent
CLOCK_HZ = 176_000_000
BLOCK_FRAMES = 48
SAMPLE_RATE = 44_000
BUDGET = CLOCK_HZ * BLOCK_FRAMES // SAMPLE_RATE  # cycles available per audio block on one core
FLASH, FLASH_SIZE = 0x10000000, 16 << 20
RAM, RAM_SIZE = 0x20000000, 32 << 20
SENTINEL = FLASH + FLASH_SIZE - 0x100

POT_ROUTE = {1: 1, 2: 6, 3: 7, 4: 2, 5: 0, 6: 3, 7: 5}  # POT_n -> multiplexer address on ADC1 (Hardware.cpp)

md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB | capstone.CS_MODE_MCLASS)
md.detail = False
COND = {"eq", "ne", "cs", "hs", "cc", "lo", "mi", "pl", "vs", "vc", "hi", "ls", "ge", "lt", "gt", "le"}


def regcount(op_str):
    inner = op_str[op_str.index("{") + 1: op_str.index("}")] if "{" in op_str else ""
    return len([r for r in inner.split(",") if r.strip()]), "pc" in inner


def cost_of(insn):
    """(fixed cycles, kind) with kind in None|'cond'|'taken_only'. Cortex-M0+ (ARMv6-M) timings."""
    m = insn.mnemonic.split(".")[0]
    ops = insn.op_str
    if m in ("ldr", "ldrb", "ldrh", "ldrsb", "ldrsh", "str", "strb", "strh"):
        return 2, None
    if m in ("ldm", "ldmia", "stm", "stmia"):
        return 1 + regcount(ops)[0], None
    if m == "push":
        return 1 + regcount(ops)[0], None
    if m == "pop":
        n, has_pc = regcount(ops)
        return (3 + n if has_pc else 1 + n), None
    if m == "bl" or m == "blx" and not ops.startswith("r"):
        return 3, None
    if m in ("bx", "blx"):
        return 2, None
    if m == "b":
        return 2, None
    if m.startswith("b") and m[1:] in COND:
        return 1, "cond"  # +1 if taken
    if m in ("mrs", "msr"):
        return 4, None
    if m in ("dmb", "dsb", "isb"):
        return 3, None
    return 1, None  # ALU, shifts, MULS (single-cycle multiplier on RP2040), moves, compares


class Profiler:
    def __init__(self, elf_path):
        self.elf_path = elf_path
        with open(elf_path, "rb") as f:
            elf = ELFFile(f)
            self.segments = [(s["p_vaddr"], s.data()) for s in elf.iter_segments() if s["p_type"] == "PT_LOAD" and s["p_filesz"]]
            self.symbols = {}
            for sec in elf.iter_sections():
                if sec.name == ".symtab":
                    for sym in sec.iter_symbols():
                        if sym.name:
                            self.symbols[sym.name] = sym["st_value"] & ~1
        self.block_cache = {}
        self.reset()

    def sym(self, name):
        if name in self.symbols:
            return self.symbols[name]
        for k, v in self.symbols.items():
            if name in k:
                return v
        raise KeyError(name)

    def reset(self):
        uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
        uc.mem_map(FLASH, FLASH_SIZE)
        uc.mem_map(RAM, RAM_SIZE)
        for addr, data in self.segments:
            uc.mem_write(addr, data)
        self.uc = uc
        self.counting = False
        self.paused = False
        self.core1 = False
        self.cycles = {"core0": 0, "core1": 0}
        self.prev = None
        self.blocks = 0
        # No crt0: run the static constructors ourselves
        start, end = self.symbols["__init_array_start"], self.symbols["__init_array_end"]
        for off in range(start, end, 4):
            fn = struct.unpack("<I", bytes(uc.mem_read(off, 4)))[0]
            self.call_addr(fn)

    # -- cycle accounting
    def _block_cost(self, address, size):
        key = (address, size)
        hit = self.block_cache.get(key)
        if hit is None:
            code = bytes(self.uc.mem_read(address, size))
            fixed, last_kind, last_cost = 0, None, 0
            insns = list(md.disasm(code, address))
            for i, insn in enumerate(insns):
                c, kind = cost_of(insn)
                if i == len(insns) - 1 and kind == "cond":
                    last_kind, last_cost = kind, c
                else:
                    fixed += c
            if last_kind:
                fixed += last_cost
            hit = (fixed, last_kind, address + size)
            self.block_cache[key] = hit
        return hit

    def _on_block(self, uc, address, size, _):
        if not self.counting or self.paused:
            self.prev = None
            return
        # taken conditional branch of the previous block costs one more cycle
        if self.prev is not None and self.prev[1] == "cond" and address != self.prev[2]:
            self.cycles["core1" if self.core1 else "core0"] += 1
        fixed, kind, end = self._block_cost(address, size)
        self.cycles["core1" if self.core1 else "core0"] += fixed
        self.prev = (fixed, kind, end)

    def hook_markers(self):
        uc = self.uc
        uc.hook_add(UC_HOOK_BLOCK, self._on_block)

        def at(name, fn):
            a = self.sym(name)
            uc.hook_add(UC_HOOK_CODE, lambda *_a: fn(), begin=a, end=a)

        def c1_begin():
            self.core1 = True

        def c1_end():
            self.core1 = False
            self.paused = False

        def on_throw():
            self.paused = True

        at("emu_core1_begin", c1_begin)
        at("emu_core1_end", c1_end)
        if "__cxa_throw" in self.symbols:
            at("__cxa_throw", on_throw)

    # -- calling into the firmware
    def call(self, name, *args):
        return self.call_addr(self.sym(name), *args)

    def call_addr(self, addr, *args):
        uc = self.uc
        for reg, v in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2), args):
            uc.reg_write(reg, v & 0xFFFFFFFF)
        uc.reg_write(UC_ARM_REG_SP, RAM + RAM_SIZE - 16)
        uc.reg_write(UC_ARM_REG_LR, SENTINEL | 1)
        uc.emu_start(addr | 1, SENTINEL)
        return uc.reg_read(UC_ARM_REG_R0)

    def measure(self, name, *args):
        self.cycles = {"core0": 0, "core1": 0}
        self.prev = None
        self.paused = False
        self.counting = True
        self.call(name, *args)
        self.counting = False
        return dict(self.cycles)


def pink_ish(n, rng, level=0.25):
    out, a, b = [], 0.0, 0.0
    for i in range(n):
        w = rng.uniform(-1, 1)
        a = 0.98 * a + 0.02 * w
        b = 0.9 * b + 0.1 * w
        out.append((a * 6 + b * 1.5 + w * 0.3) * level)
    return out


def run_scenario(elf, scenario, blocks_warmup=150, blocks_measure=300):
    p = Profiler(elf)
    rng = random.Random(1234)
    for n in range(1, 8):
        p.call("fw_set_adc", 1, POT_ROUTE[n], int(20 + scenario["pots"] * 4058))
    for pin, level in ((1, 1), (17, 1), (18, 1), (19, 1), (22, 1), (25, 1), (24, 1), (23, 1)):
        p.call("fw_set_pin", pin, level)
    ud = scenario.get("user_data")
    if ud:
        ptr = p.call("fw_user_data_ptr")
        p.uc.mem_write(ptr, Path(ud).read_bytes())
    p.call("fw_boot")
    in_ptr = p.call("fw_input")
    p.hook_markers()

    audio, core1, ui = [], [], []
    notes = [48, 51, 55, 60, 63, 60, 55, 51]
    last_note = None
    for b in range(blocks_warmup + blocks_measure):
        t = b * BLOCK_FRAMES / SAMPLE_RATE
        if scenario.get("notes"):
            step = int(t / 0.25)
            if step != last_note:
                if last_note is not None:
                    for byte in (0x80, notes[last_note % 8], 0):
                        p.call("fw_midi_in", byte)
                last_note = step
                for byte in (0x90, notes[step % 8], 100):
                    p.call("fw_midi_in", byte)
            p.call("fw_set_pin", 19, 0 if (t % 0.25) < 0.03 else 1)
        samples = pink_ish(BLOCK_FRAMES, rng)
        buf = bytearray()
        for s in samples:
            v = max(-32768, min(32767, int(s * 32768)))
            buf += struct.pack("<ii", v, v)
        p.uc.mem_write(in_ptr, bytes(buf))
        p.call("fw_advance_block_time")
        c_ui = p.measure("fw_ui_step", 4)
        c_audio = p.measure("fw_audio_block")
        if b >= blocks_warmup:
            audio.append(c_audio["core0"])
            core1.append(c_audio["core1"])
            ui.append(c_ui["core0"] / 4)
    def stats(xs):
        xs = sorted(xs)
        return {"mean": sum(xs) / len(xs), "p99": xs[int(len(xs) * 0.99) - 1], "max": xs[-1]}
    return {
        "name": scenario["name"],
        "description": scenario["description"],
        "core0_audio": stats(audio),
        "core1_audio": stats(core1),
        "ui_loop_iteration": stats(ui),
        "blocks": blocks_measure,
    }


def scenarios_for(app):
    base = [
        {"name": "defaults", "description": "All knobs at 50 %, demo-style stereo noise input", "pots": 0.5},
        {"name": "all knobs max", "description": "All seven knobs at 100 %", "pots": 1.0},
        {"name": "all knobs min", "description": "All seven knobs at 0 %", "pots": 0.0},
    ]
    if app in ("wavebard", "examplesynth"):
        for s in base:
            s["notes"] = True
            s["description"] += ", MIDI arpeggio + TRIG pulses at 120 BPM"
    if app == "wavebard":
        for s in base:
            s["user_data"] = str(ROOT.parent / "code/src/apps/WaveBard/SAMPLES.bin")
    return base


def main():
    apps = sys.argv[1:] or ["masterblaster", "wavebard", "examplesynth", "template"]
    result = {
        "clock_hz": CLOCK_HZ,
        "block_frames": BLOCK_FRAMES,
        "sample_rate": SAMPLE_RATE,
        "budget_cycles_per_block": BUDGET,
        "model": "Cortex-M0+ instruction timings on the real -O3 firmware build; no flash/XIP cache, bus contention, hardware divider or bootrom float model",
        "apps": {},
    }
    out = ROOT / "src/cpu/profile.json"
    if out.exists():
        result["apps"] = json.loads(out.read_text()).get("apps", {})
    for app in apps:
        elf = ROOT / ".build" / app / "arm.elf"
        print(f"== {app}", flush=True)
        entries = []
        for sc in scenarios_for(app):
            r = run_scenario(str(elf), sc)
            entries.append(r)
            print(
                f"  {r['name']:14s} core0 audio mean {r['core0_audio']['mean']:9.0f}  max {r['core0_audio']['max']:9.0f}"
                f" ({100 * r['core0_audio']['max'] / BUDGET:5.1f}% of budget)  core1 max {r['core1_audio']['max']:9.0f}",
                flush=True,
            )
        result["apps"][app] = {"scenarios": entries}
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
