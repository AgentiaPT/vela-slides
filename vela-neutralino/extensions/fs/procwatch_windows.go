//go:build windows

package main

import (
	"os"
	"strings"
	"syscall"
	"unsafe"
)

const (
	_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	_SYNCHRONIZE                       = 0x00100000
	_WAIT_TIMEOUT                      = 0x00000102
	_INFINITE                          = 0xFFFFFFFF
)

var (
	kernel32                       = syscall.NewLazyDLL("kernel32.dll")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
)

// processName returns the base executable name of pid (diagnostic only).
func processName(pid int) string {
	if pid <= 0 {
		return ""
	}
	h, err := syscall.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer syscall.CloseHandle(h)
	buf := make([]uint16, 260)
	size := uint32(len(buf))
	r, _, _ := procQueryFullProcessImageNameW.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if r == 0 {
		return ""
	}
	full := syscall.UTF16ToString(buf[:size])
	if i := strings.LastIndexAny(full, `\/`); i >= 0 {
		return full[i+1:]
	}
	return full
}

// parentAlive reports whether pid is still running (0ms handle wait).
func parentAlive(pid int) bool {
	h, err := syscall.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION|_SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	ev, err := syscall.WaitForSingleObject(h, 0)
	if err != nil {
		return true
	}
	return ev == _WAIT_TIMEOUT
}

type procInfo struct {
	ppid uint32
	name string
}

func snapshotProcs() map[uint32]procInfo {
	const _TH32CS_SNAPPROCESS = 0x00000002
	snap, err := syscall.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer syscall.CloseHandle(snap)
	m := map[uint32]procInfo{}
	var e syscall.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	if err := syscall.Process32First(snap, &e); err != nil {
		return m
	}
	for {
		m[e.ProcessID] = procInfo{ppid: e.ParentProcessID, name: syscall.UTF16ToString(e.ExeFile[:])}
		if err := syscall.Process32Next(snap, &e); err != nil {
			break
		}
	}
	return m
}

var shellWrappers = map[string]bool{
	"cmd.exe": true, "conhost.exe": true, "powershell.exe": true, "pwsh.exe": true,
}

// resolveAppAncestor walks up from the immediate parent, skipping the shell
// wrapper(s) Neutralino spawns the extension through, and returns the first
// non-shell ancestor — the app process whose death means "window closed".
func resolveAppAncestor(startPPID int) int {
	m := snapshotProcs()
	if len(m) == 0 {
		return startPPID
	}
	cur := uint32(startPPID)
	for hops := 0; hops < 8; hops++ {
		e, ok := m[cur]
		if !ok {
			break
		}
		if shellWrappers[strings.ToLower(e.name)] {
			if e.ppid == 0 || e.ppid == cur {
				break
			}
			cur = e.ppid
			continue
		}
		return int(cur)
	}
	return int(cur)
}

// watchParentExit blocks on the Neutralino APP process HANDLE and closes the
// returned channel when it exits. Watches the app ancestor (not the immediate
// cmd.exe wrapper) so it is immune to the inherited-socket / immortal-shell
// traps that defeat the port and ppid watches on Windows.
func watchParentExit(dir string) <-chan struct{} {
	ppid := os.Getppid()
	appPid := resolveAppAncestor(ppid)
	logf(dir, "parent-handle watch: ppid=%d -> app-ancestor=%d name=%q", ppid, appPid, processName(appPid))
	if appPid <= 0 {
		return nil
	}
	h, err := syscall.OpenProcess(_SYNCHRONIZE, false, uint32(appPid))
	if err != nil {
		logf(dir, "parent-handle watch: OpenProcess(app=%d) failed: %v — DISABLED", appPid, err)
		return nil
	}
	ch := make(chan struct{})
	go func() {
		defer syscall.CloseHandle(h)
		_, _ = syscall.WaitForSingleObject(h, _INFINITE)
		close(ch)
	}()
	return ch
}
