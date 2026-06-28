//go:build !windows

package main

import "syscall"

// parentAlive reports whether pid is still running. On POSIX, signal 0 performs
// error checking without delivering a signal: nil means alive, EPERM means the
// process exists but we lack permission (still alive), ESRCH means it is gone.
func parentAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
