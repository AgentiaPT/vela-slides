#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""One canonical way to put a secret on disk. Never hand-roll a second one.

WHY THIS MODULE EXISTS
----------------------
POSIX mode bits are the only file-permission primitive that Python's ``os``
layer exposes, and they do not work on two platforms this repo supports:

* **Windows.** The mode argument of ``os.open`` reaches the C runtime, which
  maps it only to ``FILE_ATTRIBUTE_READONLY``. The NTFS ACL that actually
  decides who can read the file is inherited from the parent directory. A
  ``0o600`` there is a no-op, not a restriction.
* **WSL ``drvfs`` mounts** — the dev setup that ``docs/DEVELOPMENT.md``
  documents as normal. Mode bits come from mount options, not from the file.

``os.stat().st_mode`` is synthesized from the same attribute on Windows
(``0o444`` when read-only, ``0o666`` otherwise), so a mode comparison there can
never prove anything: it reports ``0o666`` for a file with a perfectly tight
ACL and ``0o666`` for a world-readable one. A test that cannot fail on a safe
file and cannot pass on an unsafe one is not a test.

THE RULE
--------
Never write a secret with a bare ``os.open(path, ..., 0o600)``. Call
``write_secret()``. It proves the restriction is real **before** the secret
reaches the disk, and raises ``InsecureFileError`` when it cannot prove it.

Fail closed. A secret we could not protect is not written at all. The caller
must not catch ``InsecureFileError`` and continue — the point of the exception
is that there is no safe way to continue.

ORDER OF OPERATIONS (the invariant that makes this work)
--------------------------------------------------------
1. Remove any existing entry at the path (``unlink`` acts on a symlink itself,
   never its target, so a planted link cannot redirect the write).
2. Create the file **empty** and **exclusively** (``O_CREAT | O_EXCL``, plus
   ``O_NOFOLLOW`` where available). The file we write is always one we just
   made ourselves.
3. Restrict it, and **read the restriction back** to prove it took.
4. Only then write the secret.

The secret never exists on disk during a window when the permissions are
unknown. Any failure in steps 1-3 removes the empty file and raises.

The Windows path follows the approach used by ``jupyter_core.paths``
(``secure_write`` / ``win32_restrict_file_to_user``), which solves the same
problem for the same reason. The implementation here is our own and uses the
documented ``SetNamedSecurityInfoW`` path so the DACL can be marked protected.
"""

import errno
import os
import re
import stat

__all__ = ["InsecureFileError", "write_secret", "enforcement_available"]


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


# ── POSIX ────────────────────────────────────────────────────────────────────

def _posix_verify(fd, path):
    """Prove from the *descriptor* that no other user can read this file.

    Uses the fd, never the path: re-stat'ing by name after opening is the
    TOCTOU shape this repo has already been bitten by once.

    The predicate is "no group and no other bits", not "mode == 0o600". That
    is the property that matters, and it stays correct under a restrictive
    umask that hands us 0o400. A filesystem that does not honour mode bits at
    all (drvfs, CIFS, FAT) reports group/other bits here and fails, which is
    the intended outcome — we cannot protect a secret there.
    """
    st = os.fstat(fd)
    mode = stat.S_IMODE(st.st_mode)
    if mode & 0o077:
        raise InsecureFileError(
            f"{path}: filesystem did not apply owner-only permissions "
            f"(got {oct(mode)}). This filesystem cannot protect a secret."
        )
    if st.st_uid != os.geteuid():
        # O_EXCL means we created it, so this should be unreachable. If it
        # ever fires, something is wrong enough that writing would be reckless.
        raise InsecureFileError(f"{path}: unexpected owner (uid {st.st_uid}).")


# ── Windows ──────────────────────────────────────────────────────────────────

# Well-known SIDs we deliberately keep on the ACL.
#   S-1-5-32-544  BUILTIN\Administrators
#   S-1-5-18      NT AUTHORITY\SYSTEM
# Excluding them buys nothing: an administrator holds SeBackupPrivilege and can
# take ownership of any file, so a DACL that omits them is security theatre that
# also breaks backup and anti-malware. Jupyter grants admins for the same reason.
_WIN_ALLOWED_WELL_KNOWN = {"S-1-5-32-544", "S-1-5-18"}
_WIN_SDDL_ALIASES = {"BA": "S-1-5-32-544", "SY": "S-1-5-18", "LS": "S-1-5-19"}

_SDDL_ACE_RE = re.compile(r"\(([^)]*)\)")


def _win_api():
    """Load advapi32/kernel32 with explicit prototypes.

    Every function used here is declared. ctypes defaults a return value to
    ``c_int``, which silently truncates the 64-bit HANDLEs and pointers these
    calls return on Win64 — a truncated PSID or PSECURITY_DESCRIPTOR would be
    passed on to the next call as garbage. Declaring the prototypes is not
    tidiness here; it is the difference between working and corrupting.
    """
    import ctypes
    from ctypes import wintypes

    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    PVOID = ctypes.c_void_p
    LPDWORD = ctypes.POINTER(wintypes.DWORD)
    PBOOL = ctypes.POINTER(wintypes.BOOL)
    PPVOID = ctypes.POINTER(ctypes.c_void_p)
    PLPWSTR = ctypes.POINTER(ctypes.c_wchar_p)

    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.GetCurrentProcess.argtypes = ()
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.LocalFree.restype = wintypes.HLOCAL
    kernel32.LocalFree.argtypes = (wintypes.HLOCAL,)

    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.OpenProcessToken.argtypes = (
        wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE),
    )
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = (
        wintypes.HANDLE, ctypes.c_int, PVOID, wintypes.DWORD, LPDWORD,
    )
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = (PVOID, PLPWSTR)
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = (
        wintypes.LPCWSTR, wintypes.DWORD, PPVOID, LPDWORD,
    )
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.restype = wintypes.BOOL
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = (
        PVOID, wintypes.DWORD, wintypes.DWORD, PLPWSTR, LPDWORD,
    )
    advapi32.GetSecurityDescriptorDacl.restype = wintypes.BOOL
    advapi32.GetSecurityDescriptorDacl.argtypes = (PVOID, PBOOL, PPVOID, PBOOL)
    # Both return a Win32 error code (DWORD), not a BOOL. Zero means success.
    advapi32.SetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi32.SetNamedSecurityInfoW.argtypes = (
        wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD,
        PVOID, PVOID, PVOID, PVOID,
    )
    advapi32.GetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi32.GetNamedSecurityInfoW.argtypes = (
        wintypes.LPCWSTR, ctypes.c_int, wintypes.DWORD,
        PPVOID, PPVOID, PPVOID, PPVOID, PPVOID,
    )
    return ctypes, wintypes, advapi32, kernel32


def _win_current_user_sid(ctypes, wintypes, advapi32, kernel32):
    """Return the process token's user SID as a string (S-1-5-21-...)."""
    TOKEN_QUERY = 0x0008
    TokenUser = 1
    ERROR_INSUFFICIENT_BUFFER = 122

    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(
        kernel32.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(token)
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        size = wintypes.DWORD(0)
        ctypes.set_last_error(0)
        advapi32.GetTokenInformation(token, TokenUser, None, 0, ctypes.byref(size))
        last = ctypes.get_last_error()
        if last not in (ERROR_INSUFFICIENT_BUFFER, 0):
            raise ctypes.WinError(last)
        buf = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(
            token, TokenUser, buf, size, ctypes.byref(size)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        # TOKEN_USER is { SID_AND_ATTRIBUTES { PSID Sid; DWORD Attributes; } },
        # so the first pointer-sized field is the PSID.
        psid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p)).contents
        str_sid = ctypes.c_wchar_p()
        if not advapi32.ConvertSidToStringSidW(psid, ctypes.byref(str_sid)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return str(str_sid.value)
        finally:
            kernel32.LocalFree(str_sid)
    finally:
        kernel32.CloseHandle(token)


def _win_normalize_sid(token):
    token = token.strip().upper()
    return _WIN_SDDL_ALIASES.get(token, token)


def _win_read_dacl_sddl(api, path):
    """Return the file's DACL, read back from disk, as an SDDL string."""
    ctypes, _wintypes, advapi32, kernel32 = api

    SE_FILE_OBJECT = 1
    DACL_SECURITY_INFORMATION = 0x00000004
    SDDL_REVISION_1 = 1

    psd = ctypes.c_void_p()
    err = advapi32.GetNamedSecurityInfoW(
        path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
        None, None, None, None, ctypes.byref(psd),
    )
    if err != 0:
        raise ctypes.WinError(err)
    try:
        out = ctypes.c_wchar_p()
        if not advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(
            psd, SDDL_REVISION_1, DACL_SECURITY_INFORMATION,
            ctypes.byref(out), None,
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return str(out.value or "")
        finally:
            kernel32.LocalFree(out)
    finally:
        kernel32.LocalFree(psd)


def _win_verify_sddl(sddl, user_sid, path):
    """Prove the read-back DACL is protected and grants nobody unexpected.

    Two independent properties, both required:
      * the DACL carries the ``P`` (protected) flag, so inheritable ACEs from
        the parent directory are not applied — this is the flag that makes the
        launch directory's ACL irrelevant;
      * every ACE names a trustee we put there on purpose.
    """
    head = sddl.split("D:", 1)
    if len(head) != 2:
        raise InsecureFileError(f"{path}: security descriptor has no DACL.")
    body = head[1]
    flags = body[: len(body) - len(body.lstrip("PARIarip"))]
    if "P" not in flags.upper():
        raise InsecureFileError(
            f"{path}: DACL is not protected — the parent directory's "
            f"inheritable permissions still apply."
        )
    allowed = {_win_normalize_sid(user_sid)} | _WIN_ALLOWED_WELL_KNOWN
    for ace in _SDDL_ACE_RE.findall(body):
        fields = ace.split(";")
        if len(fields) < 6:
            raise InsecureFileError(f"{path}: unparsable ACE in DACL.")
        trustee = _win_normalize_sid(fields[5])
        if trustee not in allowed:
            raise InsecureFileError(
                f"{path}: DACL grants access to an unexpected trustee ({trustee})."
            )


def _windows_lock_down(path):
    """Replace the file's DACL with a protected, owner-only one, then verify.

    Always applied to an empty, freshly created file, before any secret is
    written into it — a file cannot be re-permissioned safely once it holds a
    secret, because the window between write and restriction is exactly the
    exposure we are removing.
    """
    api = _win_api()
    ctypes, wintypes, advapi32, kernel32 = api

    SE_FILE_OBJECT = 1
    DACL_SECURITY_INFORMATION = 0x00000004
    PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    SDDL_REVISION_1 = 1

    user_sid = _win_current_user_sid(ctypes, wintypes, advapi32, kernel32)

    # D:P  -> a DACL marked protected, so the inheritable ACEs of the parent
    # directory are NOT merged in. That flag is the whole point: without it the
    # launch directory's ACL decides who can read this file.
    # FA -> FILE_ALL_ACCESS. BA -> Administrators, SY -> SYSTEM (see above).
    sddl = "D:P(A;;FA;;;{0})(A;;FA;;;BA)(A;;FA;;;SY)".format(user_sid)

    psd = ctypes.c_void_p()
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl, SDDL_REVISION_1, ctypes.byref(psd), None
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        present = wintypes.BOOL()
        defaulted = wintypes.BOOL()
        pdacl = ctypes.c_void_p()
        if not advapi32.GetSecurityDescriptorDacl(
            psd, ctypes.byref(present), ctypes.byref(pdacl), ctypes.byref(defaulted)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if not present.value:
            raise InsecureFileError(f"{path}: built security descriptor has no DACL.")
        # SetNamedSecurityInfoW, not SetFileSecurityW: only this call documents
        # PROTECTED_DACL_SECURITY_INFORMATION, which is what stops the parent
        # directory's inheritable ACEs from being applied to our file.
        err = advapi32.SetNamedSecurityInfoW(
            path, SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None, None, pdacl, None,
        )
        if err != 0:
            raise ctypes.WinError(err)
    finally:
        kernel32.LocalFree(psd)

    # Read it back from disk. Setting a DACL and assuming it took is the same
    # class of mistake as assuming a 0o600 took.
    _win_verify_sddl(_win_read_dacl_sddl(api, path), user_sid, path)


# ── Public API ───────────────────────────────────────────────────────────────

def enforcement_available():
    """True when this platform has a permission primitive we can prove.

    Callers use this to decide whether to *offer* persistence, not to decide
    whether to skip the check. ``write_secret`` still verifies.
    """
    return os.name in ("posix", "nt")


def write_secret(path, text, *, encoding="utf-8"):
    """Write ``text`` to ``path`` so that only the current user can read it.

    Raises ``InsecureFileError`` if the restriction cannot be proven, having
    written nothing. Do not catch it and continue.
    """
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
        if os.name == "nt":
            # The ACL is set by path, and Windows will not re-permission a file
            # that is open. Close first; the file is still empty, and O_EXCL
            # above means nothing else can have taken the name in between.
            os.close(fd)
            fd = None
            try:
                _windows_lock_down(path)
            except InsecureFileError:
                raise
            except Exception as e:  # ctypes / Win32 failure
                raise InsecureFileError(
                    f"{path}: could not apply an owner-only ACL: {e}"
                ) from e
            fd = os.open(path, os.O_WRONLY | os.O_TRUNC)
        else:
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
        # Remove the file we created. It holds no secret at this point on any
        # path that raises before the write, and a partial write is worse than
        # no file.
        try:
            os.unlink(path)
        except OSError as e:
            if e.errno != errno.ENOENT:
                pass
        raise
