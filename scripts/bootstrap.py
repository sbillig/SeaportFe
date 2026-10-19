#!/usr/bin/env python3
"""Set up the pinned Seaport reference and the Fe compiler.

    scripts/bootstrap.py            # reference + compiler + Fe build
    scripts/bootstrap.py --no-hardhat

1. Clone ProjectOpenSea/seaport at the pinned revision into
   reference/seaport, with submodules, and build the Foundry artifacts the
   upstream tests deploy (`reference-out`, `optimized-out`). Unless
   `--no-hardhat`, also install the Node dependencies and compile the
   Hardhat artifacts.
2. Clone the pinned Fe repository and revision into toolchain/fe. Use its
   committed Cargo dependencies without compiler patches or local overrides.
3. Build the compiler and the Fe contracts into build/fe.
"""
import argparse
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
        run("npx", "--yes", "yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-engines", cwd=ref)
        run("npx", "hardhat", "compile", "--config", "./hardhat.config.ts", cwd=ref)


def compiler():
    fe = ROOT / "toolchain" / "fe"
    pinned = MANIFEST["compiler"]
    if not fe.exists():
        run("git", "clone", pinned["url"], fe)
        run("git", "checkout", "--detach", pinned["revision"], cwd=fe)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=fe, text=True).strip()
    if head != pinned["revision"]:
        raise SystemExit(f"{fe} must be at {pinned['revision']}; found {head}")
    if subprocess.run(["git", "diff", "--quiet", "HEAD", "--"], cwd=fe).returncode:
        raise SystemExit(f"{fe} has tracked changes; the build requires the pinned sources")
    run("npm", "ci", "--prefix", "crates/tree-sitter-fe", cwd=fe)
    run("cargo", "build", "--locked", "--release", "-p", "fe", cwd=fe)


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
