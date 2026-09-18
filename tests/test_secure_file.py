#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""Tests for the canonical secret-to-disk helper.

The defect this module exists to prevent: code asserts a permission property
the platform does not enforce, verifies it with a value the platform
synthesizes, and then writes the secret anyway when the check fails. Each of
those three is tested here on its own.

Windows is refused outright rather than supported, so the `os.name != "posix"`
branch is tested both by simulation here and for real by the windows-latest CI
job, which runs this same file.
"""

import os
import shutil
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "tools", "vela-dev", "scripts"))
import secure_file  # noqa: E402


class TestWriteSecretPosix(unittest.TestCase):
    """The POSIX write path. Skipped wholesale off POSIX — there is no write
    path there at all, only the refusal that TestNonPosixIsRefused covers."""

    def setUp(self):
        if os.name != "posix":
            self.skipTest("POSIX write path; see TestNonPosixIsRefused")
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.path = os.path.join(self.root, ".secret")

    def test_writes_owner_only(self):
        secure_file.write_secret(self.path, "s3cret")
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), "s3cret")
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode) & 0o077, 0)

    def test_overwrite_replaces_content(self):
        secure_file.write_secret(self.path, "first")
        secure_file.write_secret(self.path, "second")
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), "second")

    def test_planted_symlink_is_not_followed(self):
        victim = os.path.join(self.root, "victim")
        with open(victim, "w", encoding="utf-8") as f:
            f.write("IMPORTANT-USER-FILE")
        try:
            os.symlink(victim, self.path)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this platform")

        secure_file.write_secret(self.path, "s3cret")

        with open(victim, encoding="utf-8") as f:
            body = f.read()
        self.assertEqual(body, "IMPORTANT-USER-FILE")
        self.assertNotIn("s3cret", body, "secret written through a planted symlink")
        self.assertFalse(os.path.islink(self.path))

    def test_fails_closed_when_mode_is_not_honoured(self):
        """A mount that ignores mode bits (drvfs, CIFS, FAT) must abort the
        write, not warn and continue."""
        real_fstat = os.fstat

        class _Loose:
            def __init__(self, st): self._st = st
            def __getattr__(self, n): return getattr(self._st, n)
            @property
            def st_mode(self): return (self._st.st_mode & ~0o777) | 0o644

        os.fstat = lambda fd: _Loose(real_fstat(fd))
        try:
            with self.assertRaises(secure_file.InsecureFileError):
                secure_file.write_secret(self.path, "s3cret")
        finally:
            os.fstat = real_fstat
        self.assertFalse(os.path.exists(self.path),
                         "an unprotectable file was left on disk")

    def test_nothing_is_written_before_the_check_passes(self):
        """The secret must not exist on disk during any window when the
        permissions are still unknown."""
        real_fstat = os.fstat
        seen = {}

        class _Loose:
            def __init__(self, st): self._st = st
            def __getattr__(self, n): return getattr(self._st, n)
            @property
            def st_mode(self):
                # Record what the file held at the moment of the check.
                try:
                    with open(self.__dict__["_p"], encoding="utf-8") as f:
                        seen["at_check"] = f.read()
                except OSError:
                    seen["at_check"] = None
                return (self._st.st_mode & ~0o777) | 0o644

        def fake(fd):
            o = _Loose(real_fstat(fd))
            o.__dict__["_p"] = self.path
            return o

        os.fstat = fake
        try:
            with self.assertRaises(secure_file.InsecureFileError):
                secure_file.write_secret(self.path, "s3cret")
        finally:
            os.fstat = real_fstat
        self.assertEqual(seen.get("at_check"), "",
                         "file was not empty when permissions were checked")


class TestNonPosixIsRefused(unittest.TestCase):
    """Windows (and anything else that is not POSIX) must be refused, not
    served with an unprotected file. The refusal happens before anything is
    created, so no empty file is left behind either."""

    def test_refused_on_windows(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        path = os.path.join(root, ".secret")
        real_name = os.name
        if real_name != "posix":
            # Running on the real thing: no simulation needed.
            with self.assertRaises(secure_file.InsecureFileError) as cm:
                secure_file.write_secret(path, "s3cret")
        else:
            os.name = "nt"
            try:
                with self.assertRaises(secure_file.InsecureFileError) as cm:
                    secure_file.write_secret(path, "s3cret")
            finally:
                os.name = real_name
        # The message must tell the caller what to do instead, or the refusal
        # is just a dead end.
        self.assertIn("VELA_TOKEN", str(cm.exception))
        self.assertFalse(os.path.exists(path),
                         "a file was created on a platform we cannot protect")


class TestNoFailOpenHatch(unittest.TestCase):
    """The module must not grow a "write it anyway" environment override. The
    recourse for an unprotectable filesystem is VELA_TOKEN, not a weaker write.
    """

    def test_module_exposes_no_insecure_override(self):
        src_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "tools", "vela-dev", "scripts", "secure_file.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        self.assertNotIn("VELA_ALLOW_INSECURE", src)
        self.assertFalse(
            any(n.startswith("allow_insecure") for n in dir(secure_file)),
            "an insecure-write override was reintroduced")


if __name__ == "__main__":
    unittest.main(verbosity=2)
