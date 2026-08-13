<!--
PLACEHOLDER — this is NOT a real minified CLAUDE.md. It exists only so
prepare.py's variant-injection / parity-check / worktree machinery has a
second, genuinely different file to inject and diff against
variants/baseline/CLAUDE.md during self-tests (harness-design.md §14.4).

Producing the real "telegraphic" approach's actual minified output is phase
6 work (running the /minify skill's actual encoding on the real CLAUDE.md
and hand-verifying no constraint was dropped) and is out of scope for this
phase, which builds and self-tests the harness plumbing only — no real
`claude -p` runs, per the phase's hard constraint.

Before this campaign runs for real, replace this file's content with the
actual /minify-produced CLAUDE.md for the "telegraphic" approach.
-->

# Vela Slides — CLAUDE.md (placeholder variant, not yet minified)

This placeholder intentionally avoids naming any of the frozen scenario
catalogue's per-scenario identifiers (see scenarios/claude-md.yaml's
leak_tokens[] for each scenario) so variant_leak_check's self-test has a
known-clean fixture to check against, distinct from the poisoned fixtures
used elsewhere in that self-test.
