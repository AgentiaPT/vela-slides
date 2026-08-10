# Failure-mode → real commit index

Each rule in `SKILL.md` §3 exists because this repo shipped it. **Every entry
below is fixed and regression-tested** — this is a lessons index, not an issue
list. Read the commit for the full reasoning (the in-code comments carry the
durable version). Kept deliberately mechanism-light per the repo's disclosure
discipline — the commits and the in-code comments are the maintainer-facing
detail.

| # | Failure mode | Where it bit | Commits |
|---|---|---|---|
| 1 | Validate-then-return-raw | `sanitizeUrl` — validated a parsed view, returned raw input; PPTX/PDF/DOM re-parsed it | `fae1431`, `4c9aca1` |
| 2 | Fail-open on type | CSS scrubbers skipped non-strings; `cssColor`/`cssGradient` coerced with `String()` | `dd4a30c`, `54c9352` |
| 3 | Depth guard returns instead of dropping | `scrubSubObject` returned an over-deep subtree unvisited | `09300d5` |
| 4 | Incomplete mediation | colour sinks gated at some renderers only; PDF URI sink un-encoded; md-export fields raw; `/api/decks` listing outside the containment gate | `cc97d13`, `af632bd`, `89444c4`, `88748e8` |
| 5 | Two copies that drift | three hand-copied scrubber value filters; per-site PDF escape; per-site script escapers; three copied test-surface conditions | `09300d5`, `af632bd`, `60ee016`, `9ff304d` |
| 6 | Incomplete escaping | Markdown export: five successive adversarial rounds each found another markdown form the encoder had missed | `88748e8`, `4b486b5`, `e795100`, `89444c4`, `d189656` |
| 7 | Regex needing a well-formed match | SVG/CSS filters matched only well-formed syntax, so malformed input passed | `6eb7804` |
| 8 | TOCTOU (CWE-367) | deck listing re-resolved a validated path at open; desktop watcher stat/read race | `8edb514`, `32bfebc` |
| 9 | Origin as a boundary | AI channel accepted an opaque origin with optional auth; MCP bridge had no sender auth + permissive CORS | `88748e8`, `e45159e` |
| 10 | Wildcard capability grants | `nativeAllowList` namespace wildcards admitted an unused native file-write primitive | `b5d2b9e`, `e2b962c` |
| 11 | Secret to a long-lived sink | minted channel token written to the log file | `8c5228f` |
| 12 | Test surface shipped | window hooks + both in-app test panels mounted on every boot; release paths missing `--release` | `208dab6`, `9ff304d`, `b2ab661`, `b404761` |
| 13 | Namespace forgery | deck could forge `_virtual` and other renderer-private flags | `8d005e2` |
| 14 | `.map(fn)` index-as-arg | `.map(sanitizeBlock)` would have passed the index as recursion depth | palisade sprint, `8d005e2` |
| — | mutation XSS (SVG↔HTML re-parse) | `<style>` attribute pass skipped; nodes outside the SVG namespace; needed an output-side re-parse backstop | `2e4f653`, `64c2144` |
| — | Path containment | fs-guard: volume roots, shallow roots, nested OS-critical dirs; archive builder followed symlinks | `2e4f653`, `64c2144`, `5d2bdf9`, `77cff62` |
| — | CSP asymmetry | desktop `<meta>` CSP allowed `https:` image/font egress that `serve.py` blocked | `8a2295a` |
| — | Script-context injection | `$`-pattern splicing in marker substitution; U+2028/2029; Python↔JS escaper drift | `60ee016` |

## Structural lessons worth repeating

- **Adversarial re-review pays.** The v13.28→13.32 markdown chain and the
  13.22→13.27 scrubber chain were each found by re-reviewing the *previous fix*.
  After landing a security fix, re-attack it before closing.
- **Turn a fix into a lint when the class can regress.** `check_deck_key_drift`
  and `check_css_fetch_sink_gate` in `tools/vela-dev/scripts/lint.py` are the
  pattern: the allowlist is the single source of truth and CI fails on drift.
- **Prefer behavioral tests to source-text assertions** — `09300d5` and `32bfebc`
  replaced grep-style assertions with real ones for exactly this reason.
- **Fixing at the sink and at the source both** — "complete mediation" here means
  no field's safety depends on a single encoder.
- Sprint write-up with the full method:
  `.hyper-sprint/completed/2026-08-08-palisade/README.md`.
