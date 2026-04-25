#!/usr/bin/env python3
"""
Verify that the Neutralino runtime binaries and client library files fetched
by `neu update` match the SHA256 pins committed under checksums/.

Run after `neu update` (locally and in CI). Exits non-zero on any mismatch
or missing file.

The runtime binary version is read from neutralino.config.json:cli.binaryVersion
and the client library version from cli.clientVersion. Each version maps to a
checksums/{runtime,clientlib}-v<version>.sha256 file in the standard
`<sha256>  <path>` format (lines starting with `#` are ignored).

Per-binary pins protect against a tampered upstream re-roll: even if neu
fetched the same nominal version, any bit-level drift fails the build.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def parse_checksums(path: Path) -> dict[str, str]:
    """Return {relative_path: sha256} from a sha256sum-formatted file."""
    pins: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        sha, _, rel = line.partition("  ")
        if not sha or not rel:
            print(f"  ✗ malformed line in {path.name}: {line!r}", file=sys.stderr)
            sys.exit(2)
        pins[rel] = sha
    return pins


def verify(pins: dict[str, str], label: str) -> int:
    failures = 0
    for rel, expected in pins.items():
        target = ROOT / rel
        if not target.exists():
            print(f"  ✗ {label}: missing {rel}", file=sys.stderr)
            failures += 1
            continue
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != expected:
            print(f"  ✗ {label}: {rel}", file=sys.stderr)
            print(f"      expected {expected}", file=sys.stderr)
            print(f"      actual   {actual}", file=sys.stderr)
            failures += 1
        else:
            print(f"  ✓ {label}: {rel}")
    return failures


def main() -> int:
    config = json.loads((ROOT / "neutralino.config.json").read_text())
    binary_version = config["cli"]["binaryVersion"]
    client_version = config["cli"]["clientVersion"]

    runtime_pins = ROOT / "checksums" / f"runtime-v{binary_version}.sha256"
    clientlib_pins = ROOT / "checksums" / f"clientlib-v{client_version}.sha256"

    for p in (runtime_pins, clientlib_pins):
        if not p.exists():
            print(f"✗ checksum file not found: {p.relative_to(ROOT)}", file=sys.stderr)
            print(
                "  Pinned versions in neutralino.config.json must have a matching "
                "checksums/ file. Bump the pin AND commit new hashes together.",
                file=sys.stderr,
            )
            return 2

    print(f"Verifying Neutralino runtime v{binary_version} + client v{client_version}")
    failures = verify(parse_checksums(runtime_pins), f"runtime  v{binary_version}")
    failures += verify(parse_checksums(clientlib_pins), f"client   v{client_version}")

    if failures:
        print(
            f"\n✗ {failures} mismatch(es). Either an upstream binary was re-rolled "
            "(audit and bump the pin) or the download was tampered with.",
            file=sys.stderr,
        )
        return 1

    print("\n✓ all runtime artefacts match committed pins.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
