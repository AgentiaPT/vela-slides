//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

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
