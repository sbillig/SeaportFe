#!/usr/bin/env python3
"""Compare the JSON ABIs of the Fe build with the Solidity artifacts.

    scripts/compare_abi.py

For each Fe contract, lists functions, events and errors whose canonical
signature (including output types for functions) differs from the Solidity
contract it replaces. Fe skips recv arms with numeric selectors in the ABI
(basic order entry points), so those are reported as missing and listed
separately as expected.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reference" / "seaport" / "optimized-out"
FE = ROOT / "build" / "fe"

PAIRS = {
    "Seaport": "Seaport.sol/Seaport.json",
    "Consideration": "Consideration.sol/Consideration.json",
    "ConduitController": "ConduitController.sol/ConduitController.json",
    "Conduit": "Conduit.sol/Conduit.json",
    "TransferHelper": "TransferHelper.sol/TransferHelper.json",
    "PausableZone": "PausableZone.sol/PausableZone.json",
    "PausableZoneController": "PausableZoneController.sol/PausableZoneController.json",
    "SeaportRouter": "SeaportRouter.sol/SeaportRouter.json",
}
# Entry points declared with numeric selectors (no signature in the Fe ABI).
NUMERIC = {
    "fulfillBasicOrder(",
    "fulfillBasicOrder_efficient_6GL6yc(",
    "executeBatch1155(",
    "executeWithBatch1155(",
}


def canon(param):
    t = param["type"]
    if t.startswith("tuple"):
        inner = ",".join(canon(c) for c in param["components"])
        return f"({inner}){t[5:]}"
    return t


def entries(abi):
    out = set()
    for e in abi:
        kind = e["type"]
        if kind not in ("function", "event", "error"):
            continue
        sig = f"{e['name']}({','.join(canon(p) for p in e['inputs'])})"
        if kind == "function":
            sig += f" -> ({','.join(canon(p) for p in e['outputs'])}) {e.get('stateMutability', '')}"
        if kind == "event":
            idx = [str(i) for i, p in enumerate(e["inputs"]) if p.get("indexed")]
            sig += f" indexed[{','.join(idx)}]"
        out.add(f"{kind} {sig}")
    return out


def main():
    bad = 0
    for fe_name, sol_path in PAIRS.items():
        fe_file = FE / f"{fe_name}.abi.json"
        sol_file = OUT / sol_path
        if not fe_file.exists() or not sol_file.exists():
            print(f"skip {fe_name}")
            continue
        fe = entries(json.loads(fe_file.read_text()))
        sol = entries(json.loads(sol_file.read_text())["abi"])
        missing = sorted(sol - fe)
        extra = sorted(fe - sol)
        print(f"== {fe_name}: {len(sol & fe)} match")
        for m in missing:
            expected = any(m.split(" ", 1)[1].startswith(n) for n in NUMERIC)
            print(f"  missing{' (numeric selector)' if expected else ''}: {m}")
            bad += not expected
        for x in extra:
            print(f"  extra:   {x}")
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
