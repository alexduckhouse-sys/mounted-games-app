#!/usr/bin/env python3
"""Summarise a cobertura file per source file; exit 1 if total line coverage < --min.

Usage: scripts/api-coverage.py <coverage.cobertura.xml> [--min 95] [--files]
"""
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

args = sys.argv[1:]
path = args[0]
minimum = float(args[args.index("--min") + 1]) if "--min" in args else 0
show_files = "--files" in args

lines = defaultdict(dict)  # file -> {line: hits}
for cls in ET.parse(path).getroot().iter("class"):
    for ln in cls.iter("line"):
        f = cls.get("filename")
        if f.startswith("obj/") or "/obj/" in f or "Migrations/" in f:
            continue
        n = int(ln.get("number"))
        lines[f][n] = max(lines[f].get(n, 0), int(ln.get("hits")))

total = covered = 0
rows = []
for f, ls in sorted(lines.items()):
    t, c = len(ls), sum(1 for h in ls.values() if h > 0)
    total += t
    covered += c
    rows.append((c / t * 100 if t else 100, f, c, t, sorted(n for n, h in ls.items() if h == 0)))

if show_files:
    for pct, f, c, t, missed in sorted(rows):
        print(f"{pct:6.1f}%  {c:5}/{t:<5} {f}")
        if pct < 100 and "--missed" in args:
            print(f"          missed: {missed}")
pct = covered / total * 100 if total else 100
print(f"TOTAL line coverage: {pct:.2f}% ({covered}/{total})")
sys.exit(1 if pct < minimum else 0)
