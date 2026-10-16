#!/usr/bin/env python3
"""Where do the cycles go? Attributes the audio interrupt's cycles to functions for one profile scenario.
   usage: hotspots.py <app> <scenario index>"""
import bisect, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import profile as P
from elftools.elf.elffile import ELFFile

app, idx = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0
elf = P.ROOT / ".build" / app / "arm.elf"
funcs = []
with open(elf, "rb") as f:
    for sec in ELFFile(f).iter_sections():
        if sec.name == ".symtab":
            for s in sec.iter_symbols():
                if s["st_info"]["type"] == "STT_FUNC" and s["st_size"]:
                    funcs.append((s["st_value"] & ~1, s["st_size"], s.name))
funcs.sort()
starts = [x[0] for x in funcs]

class Attr(P.Profiler):
    def __init__(self, *a):
        self.by = {}
        super().__init__(*a)
    def _on_block(self, uc, address, size, _):
        before = self.cycles["core0"] + self.cycles["core1"]
        super()._on_block(uc, address, size, _)
        spent = self.cycles["core0"] + self.cycles["core1"] - before
        if spent:
            i = bisect.bisect_right(starts, address) - 1
            name = funcs[i][2] if i >= 0 and address < funcs[i][0] + funcs[i][1] else "?"
            self.by[name] = self.by.get(name, 0) + spent

P.Profiler = Attr
sc = P.scenarios_for(app)[idx]
holder = {}
orig = Attr.measure
def measure(self, name, *args):
    if name == "fw_audio_block":
        self.by = {}
    r = orig(self, name, *args)
    if name == "fw_audio_block":
        holder["by"] = dict(self.by)
    return r
Attr.measure = measure
P.run_scenario(str(elf), sc, blocks_warmup=150, blocks_measure=4)
by = holder["by"]
total = sum(by.values())
print(f"{app} / {sc['name']}: {total} cycles in the last audio block")
import subprocess
for name, c in sorted(by.items(), key=lambda kv: -kv[1])[:16]:
    print(f"{c:9d} {100*c/total:5.1f}%  {subprocess.run(['c++filt', name], capture_output=True, text=True).stdout.strip()[:90]}")
