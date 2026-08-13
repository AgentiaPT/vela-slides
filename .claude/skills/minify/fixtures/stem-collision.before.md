# Demo Service

This service is built from several parts.

The parts directory holds the part files.

A part ships with its own test suite, kept beside the part's source file.

Parts talk over the shared parts bus, and a part registers itself on
startup.

## Audit Logging

All in `parts/part-audit-hook.jsx`.
