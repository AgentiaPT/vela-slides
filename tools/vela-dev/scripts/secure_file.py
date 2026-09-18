#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""One canonical way to put a secret on disk. Never hand-roll a second one.

`os.open(path, ..., 0o600)` does not restrict anything on Windows (the mode
reaches the C runtime, which maps it only to FILE_ATTRIBUTE_READONLY; the NTFS
ACL that decides access is inherited from the parent directory) nor on WSL
`drvfs` mounts. `os.stat().st_mode` is synthesized from that same attribute on
Windows, so a mode comparison there cannot fail on a safe file or pass on an
unsafe one — it is decoration, not a check.

So: never write a secret with a bare mode. Call `write_secret()`. It proves the
restriction is real *before* the secret reaches the disk, and raises
`InsecureFileError` when it cannot. Callers must let that propagate — the point
of the exception is that there is no safe way to continue.

Order matters: unlink any existing entry (acts on a symlink itself, never its
target), create empty and exclusively, verify, and only then write. The secret
never exists on disk while the permissions are unknown.

Background and the full threat model: `docs/SECURITY.md`.
"""

import errno
import os
import stat

__all__ = ["InsecureFileError", "write_secret"]


class InsecureFileError(Exception):
    """Raised when a secret's file permissions could not be proven restrictive.

    Callers must let this propagate or abort the operation. Writing the secret
    anyway is the exact failure this module exists to prevent.
    """


# There is deliberately NO "write it anyway" escape hatch here.
# jupyter_core has one (JUPYTER_ALLOW_INSECURE_WRITES) because Jupyter must
# write a connection file to function. Vela must not: a caller that cannot get
# a protected file supplies its own token through VELA_TOKEN instead, and the
# server then never persists a secret at all. Given that recourse exists, an
# opt-out here would only be a door for the fail-open behaviour this module was
# written to remove. Do not add one.


# Windows is refused rather than supported. Restricting a file there means
# building an explicit protected DACL through Win32 — perfectly possible, but it
# is a few hundred lines of ctypes that would exist only to serve an optional
# convenience file, and it could not be exercised on this repo's own machines.
# Since a caller who wants to script the local API can set VELA_TOKEN and skip
# the file entirely, refusing costs a Windows developer nothing real. If a
# genuine need for an on-disk secret appears on Windows, implement it here with
# SetNamedSecurityInfoW + PROTECTED_DACL_SECURITY_INFORMATION, verify the DACL
# by reading it back, and compare trustees by SID identity (EqualSid) — never by
# the rendered SDDL text, which Windows re-writes using whatever alias applies.
_WINDOWS_REFUSED = (
    "{path}: refusing to write a secret on Windows. POSIX mode bits do not "
    "restrict a file here, and this build does not set an NTFS ACL. Set "
    "VELA_TOKEN to a token you choose and skip the file instead."
)


def _posix_verify(fd, path):
    """Prove from the *descriptor* that no other user can read this file.

    Uses the fd, never the path: re-stat'ing by name after opening is the
    TOCTOU shape this repo has already been bitten by once.

    The predicate is "no group and no other bits", not "mode == 0o600". That is
    the property that matters, and it stays correct under a restrictive umask
    that hands us 0o400. A filesystem that does not honour mode bits at all
    (drvfs, CIFS, FAT) reports group/other bits here and fails, which is the
    intended outcome — we cannot protect a secret there.
    """
    st = os.fstat(fd)
    mode = stat.S_IMODE(st.st_mode)
    if mode & 0o077:
        raise InsecureFileError(
            f"{path}: filesystem did not apply owner-only permissions "
            f"(got {oct(mode)}). This filesystem cannot protect a secret."
        )
    if st.st_uid != os.geteuid():
        # O_EXCL means we created it, so this should be unreachable. If it ever
        # fires, something is wrong enough that writing would be reckless.
        raise InsecureFileError(f"{path}: unexpected owner (uid {st.st_uid}).")


def write_secret(path, text, *, encoding="utf-8"):
    """Write ``text`` to ``path`` so that only the current user can read it.

    Raises ``InsecureFileError`` if the restriction cannot be proven, having
    written nothing. Do not catch it and continue.
    """
    if os.name != "posix":
        # Checked before anything is created, so no empty file is left behind.
        raise InsecureFileError(_WINDOWS_REFUSED.format(path=path))

    # unlink acts on the link itself, never its target, so a planted symlink
    # cannot redirect this write or get something else truncated.
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        raise InsecureFileError(f"{path}: could not replace existing entry: {e}") from e

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
    except OSError as e:
        raise InsecureFileError(f"{path}: could not create the file safely: {e}") from e

    try:
        _posix_verify(fd, path)
        with os.fdopen(fd, "w", encoding=encoding) as f:
            fd = None
            f.write(text)
    except BaseException:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        # Remove the file we created. It holds no secret on any path that raises
        # before the write, and a partial write is worse than no file.
        try:
            os.unlink(path)
        except OSError as e:
            if e.errno != errno.ENOENT:
                pass
        raise
