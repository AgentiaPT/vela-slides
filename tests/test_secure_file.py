#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""Tests for the canonical secret-to-disk helper.

The defect this module exists to prevent: code asserts a permission property
the platform does not enforce, verifies it with a value the platform
synthesizes, and then writes the secret anyway when the check fails. Each of
those three is tested here on its own.

The Windows ACL path cannot fully execute on a POSIX CI runner, so it is split
so that as much as possible still is tested there: the SDDL parsing is pure
string logic and is tested directly, and the `os.name == "nt"` branch is taken
with the Win32 machinery unavailable to prove it fails CLOSED rather than
degrading to an unprotected write. The parts that need a real security
subsystem — resolving a trustee to a SID and comparing identities — run in
TestWindowsDaclEndToEnd, which the windows-latest CI job exists to execute.
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


class TestSddlParsing(unittest.TestCase):
    """The text half of the Windows decision — which is all of it that can be
    decided from a string. Runs on every platform.

    Trustee ACCEPTABILITY is deliberately not tested here: Windows renders a
    descriptor back using whatever alias applies, so the token we read is often
    not the token we wrote even for the same principal (the built-in
    Administrator comes back as `LA`). That comparison is done by SID identity
    in `_win_trustees_allowed`, and only Windows can do it.
    """

    USER = "S-1-5-21-1111111111-2222222222-3333333333-1001"

    def test_reads_protected_flag_and_trustees(self):
        protected, trustees = secure_file._parse_sddl_dacl(
            f"D:P(A;;FA;;;{self.USER})(A;;FA;;;BA)(A;;FA;;;SY)", "X")
        self.assertTrue(protected)
        self.assertEqual(trustees, [self.USER, "BA", "SY"])

    def test_unprotected_dacl_is_reported_as_such(self):
        """Without the P flag the parent directory's inheritable ACEs still
        apply — which is the whole defect."""
        for sddl in (f"D:(A;;FA;;;{self.USER})", f"D:AI(A;;FA;;;{self.USER})"):
            protected, _ = secure_file._parse_sddl_dacl(sddl, "X")
            self.assertFalse(protected, sddl)

    def test_owner_and_group_prefix_do_not_confuse_the_parser(self):
        """An owner or group alias ending in D sits immediately before the real
        `D:` section, so a naive split finds the wrong one."""
        for prefix in ("O:BAG:BA", "O:BAG:WD", "O:LAG:DU", ""):
            protected, trustees = secure_file._parse_sddl_dacl(
                f"{prefix}D:P(A;;FA;;;{self.USER})(A;;FA;;;BA)", "X")
            self.assertTrue(protected, prefix)
            self.assertEqual(trustees, [self.USER, "BA"], prefix)

    def test_alias_rendered_owner_is_parsed_not_rejected(self):
        """The shape a real Windows host returns when the current account is the
        built-in Administrator. Parsing must surface it; identity comparison
        decides it."""
        protected, trustees = secure_file._parse_sddl_dacl(
            "D:P(A;;FA;;;LA)(A;;FA;;;BA)(A;;FA;;;SY)", "X")
        self.assertTrue(protected)
        self.assertEqual(trustees, ["LA", "BA", "SY"])

    def test_rejects_descriptor_with_no_dacl(self):
        with self.assertRaises(secure_file.InsecureFileError):
            secure_file._parse_sddl_dacl("O:BAG:BA", "X")

    def test_rejects_unparsable_ace(self):
        with self.assertRaises(secure_file.InsecureFileError):
            secure_file._parse_sddl_dacl(f"D:P(A;;FA;;;{self.USER})(bogus)", "X")


class TestWindowsDaclEndToEnd(unittest.TestCase):
    """Windows only: the parts that need a real security subsystem."""

    def setUp(self):
        if os.name != "nt":
            self.skipTest("requires Windows")

    def test_written_file_carries_a_protected_owner_only_dacl(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        path = os.path.join(root, ".secret")
        secure_file.write_secret(path, "s3cret")

        api = secure_file._win_api()
        sddl = secure_file._win_read_dacl_sddl(api, path)
        protected, trustees = secure_file._parse_sddl_dacl(sddl, path)
        self.assertTrue(protected, f"DACL not protected: {sddl}")
        self.assertTrue(trustees, f"DACL has no ACEs: {sddl}")
        # Must not raise: every trustee resolves to one we put there.
        secure_file._win_trustees_allowed(
            api, trustees,
            secure_file._win_current_user_sid(*api), path)

    def test_an_extra_trustee_is_rejected_by_identity(self):
        api = secure_file._win_api()
        user = secure_file._win_current_user_sid(*api)
        # WD = Everyone. Nothing we ever grant.
        with self.assertRaises(secure_file.InsecureFileError):
            secure_file._win_trustees_allowed(api, [user, "WD"], user, "X")

    def test_our_own_sid_is_accepted_however_windows_renders_it(self):
        """Regression: the SID we set can come back as an alias. Comparing
        rendered text rejects our own ACE; comparing identity does not."""
        api = secure_file._win_api()
        user = secure_file._win_current_user_sid(*api)
        secure_file._win_trustees_allowed(api, [user, "BA", "SY"], user, "X")


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
