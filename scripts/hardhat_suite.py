#!/usr/bin/env python3
"""Run Seaport's Hardhat test suite against the Fe contracts.

The Hardhat tests deploy contracts from the compiled artifacts of the pinned
reference checkout. This script swaps the bytecode of the ported contracts in
those artifacts for the Fe build, runs `hardhat test --no-compile` and
restores the original artifacts afterwards.

    scripts/hardhat_suite.py                     # all specs
    scripts/hardhat_suite.py test/basic.spec.ts  # selected specs

Requires `yarn install` and `npx hardhat compile` in reference/seaport (see
scripts/bootstrap.py).
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "reference" / "seaport"
ARTIFACTS = REFERENCE / "artifacts"
PRISTINE = ROOT / "build" / "hardhat-artifacts"
FE_BUILD = ROOT / "build" / "fe"

# contract name in the artifacts -> Fe contract name
PORTED = {
    "Seaport": "Seaport",
    "Consideration": "Consideration",
    "Conduit": "Conduit",
    "ConduitController": "ConduitController",
    "TransferHelper": "TransferHelper",
    "SeaportRouter": "SeaportRouter",
    "PausableZone": "PausableZone",
    "PausableZoneController": "PausableZoneController",
}


def artifact_paths():
    found = {}
    for path in ARTIFACTS.rglob("*.json"):
        if path.name.endswith(".dbg.json") or "build-info" in path.parts:
            continue
        name = path.stem
        if name in PORTED and path.parent.name == f"{name}.sol":
            found.setdefault(name, []).append(path)
    return found


def main():
    if not PRISTINE.exists():
        shutil.copytree(ARTIFACTS, PRISTINE)
    else:
        shutil.rmtree(ARTIFACTS)
        shutil.copytree(PRISTINE, ARTIFACTS)
    try:
        for name, paths in artifact_paths().items():
            fe_name = PORTED[name]
            init = "0x" + (FE_BUILD / f"{fe_name}.bin").read_text().strip()
            runtime = "0x" + (FE_BUILD / f"{fe_name}.runtime.bin").read_text().strip()
            for path in paths:
                data = json.loads(path.read_text())
                data["bytecode"] = init
                data["deployedBytecode"] = runtime
                data["linkReferences"] = {}
                data["deployedLinkReferences"] = {}
                path.write_text(json.dumps(data))
                print(f"{path.relative_to(REFERENCE)}: Fe {fe_name}", file=sys.stderr)
        specs = sys.argv[1:]
        cmd = ["npx", "hardhat", "test", "--no-compile", "--config", "./hardhat.config.ts", *specs]
        return subprocess.call(cmd, cwd=REFERENCE, env=dict(os.environ))
    finally:
        shutil.rmtree(ARTIFACTS)
        shutil.copytree(PRISTINE, ARTIFACTS)


if __name__ == "__main__":
    sys.exit(main())
