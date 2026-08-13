# Demo Service

Built from several parts.

Parts dir holds the part files.

A part ships with its own test suite, beside the part's source file.

Parts talk over the shared parts bus; a part registers itself on startup.

## Audit Logging

All in `parts/part-audit-hook.jsx`.
