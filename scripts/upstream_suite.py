#!/usr/bin/env python3
"""Run Seaport's own Foundry test suite against the Fe contracts.

The upstream suite deploys the "optimized" contracts from precompiled
artifacts (`optimized-out/<Name>.sol/<Name>.json`) and the reference
implementation from `reference-out/`. This script prepares a work directory
next to the pinned reference checkout in which those artifacts carry the Fe
bytecode, then runs `forge test` there.

    scripts/upstream_suite.py                # Fe as `consideration`
    scripts/upstream_suite.py --both         # Fe also as `referenceConsideration`
    scripts/upstream_suite.py -- --mc Foo    # extra forge arguments

The Solidity artifacts must exist (see scripts/bootstrap.py).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "reference" / "seaport"
WORK = ROOT / "build" / "upstream"
FE_BUILD = ROOT / "build" / "fe"

# artifact path -> Fe contract name
OPTIMIZED = {
    "optimized-out/Consideration.sol/Consideration.json": "Consideration",
    "optimized-out/ConduitController.sol/ConduitController.json": "ConduitController",
    "optimized-out/TransferHelper.sol/TransferHelper.json": "TransferHelper",
}
REFERENCE_ARTIFACTS = {
    "reference-out/ReferenceConsideration.sol/ReferenceConsideration.json": "Consideration",
    "reference-out/ReferenceConduitController.sol/ReferenceConduitController.json": "ConduitController",
}
LINKED = ["contracts", "lib", "reference", "test", "foundry.toml", "remappings.txt", "package.json"]


def link_tree():
    WORK.mkdir(parents=True, exist_ok=True)
    for name in LINKED:
        src = REFERENCE / name
        dst = WORK / name
        if not src.exists() or dst.exists() or dst.is_symlink():
            continue
        dst.symlink_to(src)
    for out in ("optimized-out", "reference-out"):
        dst = WORK / out
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(REFERENCE / out, dst)


def inject(artifact, contract):
    path = WORK / artifact
    init = (FE_BUILD / f"{contract}.bin").read_text().strip()
    runtime = (FE_BUILD / f"{contract}.runtime.bin").read_text().strip()
    data = json.loads(path.read_text())
    data["bytecode"] = {"object": "0x" + init, "linkReferences": {}}
    data["deployedBytecode"] = {"object": "0x" + runtime, "linkReferences": {}}
    path.write_text(json.dumps(data))
    return len(runtime) // 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--both", action="store_true", help="replace the reference artifacts too")
    parser.add_argument("forge_args", nargs="*")
    args = parser.parse_args()

    link_tree()
    artifacts = dict(OPTIMIZED)
    if args.both:
        artifacts.update(REFERENCE_ARTIFACTS)
    for artifact, contract in artifacts.items():
        if not (FE_BUILD / f"{contract}.bin").exists():
            print(f"skip {artifact}: no Fe build of {contract}", file=sys.stderr)
            continue
        size = inject(artifact, contract)
        print(f"{artifact}: Fe {contract}, runtime {size} bytes", file=sys.stderr)

    # The Fe runtime code exceeds EIP-170 (ISSUES.md #13).
    env = dict(os.environ, FOUNDRY_PROFILE="test", FOUNDRY_DISABLE_CODE_SIZE_LIMIT="true")
    cmd = ["forge", "test", *args.forge_args]
    return subprocess.call(cmd, cwd=WORK, env=env)


if __name__ == "__main__":
    sys.exit(main())
