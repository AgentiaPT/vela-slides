//go:build windows

package main

import "syscall"

const (
	_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	_SYNCHRONIZE                       = 0x00100000
	_WAIT_TIMEOUT                      = 0x00000102
)

// parentAlive reports whether pid is still running. On Windows we open the
// process and ask whether its handle has become signaled: a 0ms wait returning
// WAIT_TIMEOUT means the process is still running; WAIT_OBJECT_0 means it has
// exited. A failed open means the process is gone.
func parentAlive(pid int) bool {
	h, err := syscall.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION|_SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	ev, err := syscall.WaitForSingleObject(h, 0)
	if err != nil {
		return true // indeterminate — assume alive to avoid premature exit
	}
	return ev == _WAIT_TIMEOUT
}
