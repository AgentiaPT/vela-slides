#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""Tests for the canonical secret-to-disk helper.

The defect this module exists to prevent: code asserts a permission property
the platform does not enforce, verifies it with a value the platform
synthesizes, and then writes the secret anyway when the check fails. Each of
those three is tested here on its own.

The Windows ACL path cannot execute on a POSIX CI runner. Two things cover it
anyway: the SDDL predicate is pure string logic and is tested directly, and the
`os.name == "nt"` branch is exercised with the Win32 machinery unavailable to
prove it fails CLOSED rather than falling back to an unprotected write.
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
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.path = os.path.join(self.root, ".secret")

    def test_writes_owner_only(self):
        secure_file.write_secret(self.path, "s3cret")
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), "s3cret")
        if os.name != "nt":
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
        if os.name == "nt":
            self.skipTest("POSIX mode path")
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
        if os.name == "nt":
            self.skipTest("POSIX mode path")
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


class TestWindowsBranchFailsClosed(unittest.TestCase):
    """On a POSIX runner the Win32 calls are unavailable, so taking the nt
    branch here proves the branch aborts instead of degrading to a plain,
    unprotected write."""

    def test_nt_branch_raises_and_leaves_nothing(self):
        if os.name == "nt":
            self.skipTest("this simulates nt on a non-nt host")
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        path = os.path.join(root, ".secret")
        real_name = os.name
        os.name = "nt"
        try:
            with self.assertRaises(secure_file.InsecureFileError):
                secure_file.write_secret(path, "s3cret")
        finally:
            os.name = real_name
        self.assertFalse(os.path.exists(path))


class TestSddlPredicate(unittest.TestCase):
    """The Windows security decision is pure string logic once the DACL is read
    back, so it is testable on every platform. These are the assertions that
    actually decide whether a Windows token file is safe."""

    USER = "S-1-5-21-1111111111-2222222222-3333333333-1001"

    def _ok(self, sddl):
        secure_file._win_verify_sddl(sddl, self.USER, "X")

    def _bad(self, sddl):
        with self.assertRaises(secure_file.InsecureFileError):
            secure_file._win_verify_sddl(sddl, self.USER, "X")

    def test_accepts_protected_owner_only_dacl(self):
        self._ok(f"D:P(A;;FA;;;{self.USER})(A;;FA;;;BA)(A;;FA;;;SY)")

    def test_accepts_well_known_sids_in_expanded_form(self):
        self._ok(f"D:P(A;;FA;;;{self.USER})(A;;FA;;;S-1-5-32-544)(A;;FA;;;S-1-5-18)")

    def test_rejects_unprotected_dacl(self):
        """Without the P flag the parent directory's inheritable ACEs still
        apply — which is the whole defect."""
        self._bad(f"D:(A;;FA;;;{self.USER})")
        self._bad(f"D:AI(A;;FA;;;{self.USER})")

    def test_rejects_extra_trustee(self):
        # BU = BUILTIN\Users, i.e. every local interactive account.
        self._bad(f"D:P(A;;FA;;;{self.USER})(A;;FA;;;BU)")
        self._bad(f"D:P(A;;FA;;;{self.USER})(A;;FA;;;WD)")  # Everyone

    def test_rejects_descriptor_with_no_dacl(self):
        self._bad("O:BAG:BA")

    def test_rejects_unparsable_ace(self):
        self._bad(f"D:P(A;;FA;;;{self.USER})(bogus)")

    def test_owner_and_group_prefix_do_not_confuse_the_parser(self):
        self._ok(f"O:BAG:BAD:P(A;;FA;;;{self.USER})(A;;FA;;;BA)(A;;FA;;;SY)")


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
