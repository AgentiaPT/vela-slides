## CRITICAL: Security-Fix Disclosure Discipline

RULE sec-disclosure. Permanent — every future change, not just the current one.
WHEN public-facing text about a security fix.
SCOPE `VELA_CHANGELOG` · commit msg · PR title/body · code-review comment · any other public-exposed doc (changelog also renders in the in-app About dialog).
MUST high level only; MUST NOT include detail that helps reproduce the issue in the wild.
DO class of issue (e.g. "CSS exfil channel", "mutation-XSS", "fail-open sanitization") · severity · affected area · what the fix does · that regression tests were added.
NEVER working payload / example attack string · exact bypass token or primitive · step-by-step repro · "where the gap was" map (precise unguarded field/endpoint/param an attacker should target) · chained CVE/exploit ref amounting to a recipe.
TEST reader could copy a string or follow the steps ⇒ too much ⇒ generalize.
EXC precise mechanics MAY go to a non-public channel (private security thread/advisory), or — where genuinely needed for maintenance — an in-code comment (maintainer-facing, not surfaced in release notes); even there, the minimum needed to explain WHY the guard exists.
TIE in doubt ⇒ write less.
