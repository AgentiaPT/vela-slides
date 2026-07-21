//go:build !windows

package main

import "syscall"

// parentAlive reports whether pid is still running. Signal 0 performs error
// checking without delivering a signal: nil / EPERM mean alive, ESRCH gone.
func parentAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// watchParentExit is Windows-only (handle wait). On Unix the stdin-EOF and
// port/ppid poll in main.go cover parent-death detection, so return nil.
func watchParentExit(dir string) <-chan struct{} {
	logf(dir, "parent-handle watch: unix — not used (stdin-eof + poll cover it)")
	return nil
}

func processName(pid int) string { return "" }
