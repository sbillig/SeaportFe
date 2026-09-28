#!/usr/bin/env python3
"""Set up the pinned Seaport reference and the Fe compiler.

    scripts/bootstrap.py            # reference + compiler + Fe build
    scripts/bootstrap.py --no-hardhat

1. Clone ProjectOpenSea/seaport at the pinned revision into
   reference/seaport, with submodules, and build the Foundry artifacts the
   upstream tests deploy (`reference-out`, `optimized-out`). Unless
   `--no-hardhat`, also install the Node dependencies and compile the
   Hardhat artifacts.
2. Clone argotorg/fe at the pinned base into toolchain/fe and apply
   compiler/seaport-integration.patch, which is the complete source
   difference of the local `seaport-integration` branch (the merged open
   PRs and the fix branches listed in reference_manifest.json).
3. Build the compiler and the Fe contracts into build/fe.
"""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "reference_manifest.json").read_text())


def run(*args, cwd=ROOT, env=None):
    print("+", " ".join(str(a) for a in args), flush=True)
    subprocess.run([str(a) for a in args], cwd=cwd, check=True, env=env)


def reference(hardhat):
    ref = ROOT / "reference" / "seaport"
    pinned = MANIFEST["reference"]
    if not ref.exists():
        run("git", "clone", pinned["url"], ref)
    run("git", "checkout", "--detach", pinned["revision"], cwd=ref)
    run("git", "submodule", "update", "--init", "--recursive", cwd=ref)
    env = dict(os.environ)
    for profile in ("reference", "optimized"):
        env["FOUNDRY_PROFILE"] = profile
        run("forge", "build", cwd=ref, env=env)
    if hardhat:
        run("yarn", "install", "--frozen-lockfile", "--ignore-engines", cwd=ref)
        run("npx", "hardhat", "compile", "--config", "./hardhat.config.ts", cwd=ref)


def compiler():
    fe = ROOT / "toolchain" / "fe"
    pinned = MANIFEST["compiler"]
    patch = ROOT / pinned["patch"]
    digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    if digest != pinned["patch_sha256"]:
        raise SystemExit(f"{patch} does not match the manifest")
    if not fe.exists():
        run("git", "clone", pinned["url"], fe)
        run("git", "checkout", "--detach", pinned["base"], cwd=fe)
        run("git", "apply", patch, cwd=fe)
    run("npm", "ci", "--prefix", "crates/tree-sitter-fe", cwd=fe)
    run("cargo", "build", "--release", "-p", "fe", cwd=fe)


def build():
    fe = ROOT / "toolchain" / "fe" / "target" / "release" / "fe"
    run(fe, "build", ".", "-O", "1", "--out-dir", "build/fe")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-hardhat", action="store_true")
    args = parser.parse_args()
    reference(hardhat=not args.no_hardhat)
    compiler()
    build()


if __name__ == "__main__":
    main()
