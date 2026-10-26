#!/usr/bin/env python3
"""Compare the JSON ABIs of the Fe build with the Solidity artifacts.

    scripts/compare_abi.py

For each Fe contract, lists functions, events and errors whose canonical
signature (including output types for functions) differs from the Solidity
contract it replaces. The README's expected listing differences are marked
and don't fail the comparison: Fe skips recv arms with numeric selectors
and events written with raw log operations, lists only the errors raised
with `revert_error`, doesn't list the PausableZone pair's shared events in
both, marks `PausableZone.supportsInterface` as `pure`, and marks the
`name()` of Seaport and Consideration as `view`.
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
    "fulfillOrder(",
    "fulfillAdvancedOrder(",
    "fulfillAvailableOrders(",
    "fulfillAvailableAdvancedOrders(",
    "matchOrders(",
    "matchAdvancedOrders(",
    "cancel(",
    "validate(",
    "getOrderHash(",
    "execute(",
    "executeBatch1155(",
    "executeWithBatch1155(",
    "authorizeOrder(",
    "validateOrder(",
}
# Events written with raw log operations (no `emit` in the Fe ABI walk).
RAW_LOGS = {"OrderValidated(", "OrderCancelled(", "OrderFulfilled(", "OrdersMatched("}
# Events Solidity lists for both PausableZone and its controller.
SHARED_EVENTS = {
    "PausableZone": {"OwnershipTransferred(", "PauserUpdated(", "PotentialOwnerUpdated(", "ZoneCreated("},
    "PausableZoneController": {"OperatorUpdated(", "Paused(", "Unpaused("},
}
# Listed with a different state mutability on purpose.
NAME_MUTABILITY = {"function name() -> (string) pure", "function name() -> (string) view"}
MUTABILITY = {
    "PausableZone": {"function supportsInterface(bytes4) -> (bool) view", "function supportsInterface(bytes4) -> (bool) pure"},
    "Seaport": NAME_MUTABILITY,
    "Consideration": NAME_MUTABILITY,
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
        known_mutability = MUTABILITY.get(fe_name, set())
        for m in missing:
            kind, sig = m.split(" ", 1)
            if kind == "function" and any(sig.startswith(n) for n in NUMERIC):
                note = "numeric selector"
            elif kind == "event" and any(sig.startswith(n) for n in RAW_LOGS):
                note = "raw log"
            elif kind == "event" and any(sig.startswith(n) for n in SHARED_EVENTS.get(fe_name, ())):
                note = "shared event"
            elif kind == "error":
                note = "not raised with revert_error"
            elif m in known_mutability:
                note = "mutability"
            else:
                note = None
            print(f"  missing ({note}): {m}" if note else f"  missing: {m}")
            bad += note is None
        for x in extra:
            note = " (mutability)" if x in known_mutability else ""
            print(f"  extra{note}:   {x}")
            bad += x not in known_mutability
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
