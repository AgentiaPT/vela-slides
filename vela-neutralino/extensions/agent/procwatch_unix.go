//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// checkBinaryTrusted refuses an agent binary that resolves into a location where
// a lower-/same-privileged local account could plant or swap the executable we
// then launch with --dangerously-skip-permissions. It checks the file itself and
// every parent directory up to the root.
//
// Only the world-writable bit (0o002) disqualifies, and for directories only
// when the sticky bit is NOT set:
//   - group-writable install dirs (e.g. Homebrew's admin-owned /usr/local on
//     Intel macOS) are legitimate, so group-write is not treated as a risk.
//   - a world-writable *sticky* dir (e.g. /tmp, mode 01777) only lets the file's
//     owner rename/delete it, so an attacker cannot swap our vetted binary —
//     accepted. A world-writable file is always rejected regardless of dir.
func checkBinaryTrusted(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("cannot stat agent binary %s: %v", path, err)
	}
	if info.Mode().Perm()&0o002 != 0 {
		return fmt.Errorf("refusing world-writable agent binary: %s", path)
	}
	dir := filepath.Dir(path)
	for {
		di, err := os.Stat(dir)
		if err != nil {
			return fmt.Errorf("cannot stat agent dir %s: %v", dir, err)
		}
		if di.Mode().Perm()&0o002 != 0 && di.Mode()&os.ModeSticky == 0 {
			return fmt.Errorf("refusing agent binary under world-writable dir: %s", dir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break // reached the filesystem root
		}
		dir = parent
	}
	return nil
}

// parentAlive reports whether pid is still running. On POSIX, signal 0 performs
// error checking without delivering a signal: nil means alive, EPERM means the
// process exists but we lack permission (still alive), ESRCH means it is gone.
func parentAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// watchParentExit is Windows-only (handle wait). On Unix the stdin-EOF and
// ppid/port poll in main.go cover parent-death detection, so return nil.
func watchParentExit() <-chan struct{} { return nil }

// ---------------------------------------------------------------------------
// childTree — puts each spawned agent in its OWN process group so the whole
// tree can be torn down at once. claude/copilot fork a node subtree; os/exec's
// ctx-cancel kills only the direct child, orphaning the rest when the desktop
// window closes. Setpgid makes the child a group leader (pgid == its pid); we
// SIGKILL the negative pgid to reap the group. Unlike the Windows job there is
// no kill-on-parent-exit primitive here, so the gatekeeper's shutdown handler
// must reapChildren() explicitly before os.Exit (main.go).
// ---------------------------------------------------------------------------

type childTree struct {
	pgid int
}

func newChildTree(cmd *exec.Cmd) *childTree {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true // new group, leader pid == group id
	t := &childTree{}
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		return nil
	}
	return t
}

func (t *childTree) enrol(cmd *exec.Cmd) error {
	if cmd.Process != nil {
		t.pgid = cmd.Process.Pid // == pgid, since Setpgid made it the leader
	}
	return nil
}

func (t *childTree) killTree() {
	if t.pgid > 0 {
		_ = syscall.Kill(-t.pgid, syscall.SIGKILL) // negative pid signals the group
	}
}

func (t *childTree) dispose() {}
