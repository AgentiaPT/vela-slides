//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
	"unsafe"
)

const (
	_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	_SYNCHRONIZE                       = 0x00100000
	_WAIT_TIMEOUT                      = 0x00000102

	_PROCESS_SET_QUOTA = 0x0100
	_PROCESS_TERMINATE = 0x0001

	_JobObjectExtendedLimitInformation  = 9
	_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

	_INFINITE = 0xFFFFFFFF
)

var (
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObject    = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJob  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJob = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject = kernel32.NewProc("TerminateJobObject")
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

// watchParentExit blocks on the parent process's HANDLE and closes the returned
// channel when it exits. Unlike the ppid poll (parentAlive), the handle is
// bound to the actual process object opened at startup, so a later process
// reusing the parent's PID cannot fool it into thinking the parent is alive —
// the exact leak that keeps vela-agent.exe orphaned under window churn. It is
// the primary shutdown signal on Windows; stdin EOF / the port watch remain.
func watchParentExit() <-chan struct{} {
	ppid := os.Getppid()
	if ppid <= 0 {
		return nil
	}
	h, err := syscall.OpenProcess(_SYNCHRONIZE, false, uint32(ppid))
	if err != nil {
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

// ---------------------------------------------------------------------------
// childTree — binds a spawned agent's WHOLE process tree to a Windows Job
// Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. claude/copilot launch their
// own node subtree; os/exec's ctx-cancel only kills the direct child, so those
// grandchildren would orphan when the desktop window closes. With the job:
//   - killTree() (ctx timeout / shutdown reap) terminates the whole tree now;
//   - if the gatekeeper exits without disposing (crash), the last job handle
//     closes and the OS kills the tree anyway (kill-on-close safety net).
// One job per spawn keeps concurrent /send calls from tearing down each other.
// ---------------------------------------------------------------------------

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectExtendedLimitInformation struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

type childTree struct {
	job syscall.Handle
}

// newChildTree creates the kill-on-close job and wires cmd.Cancel to tear the
// tree down when the request context is cancelled (timeout / client gone). It
// does NOT start the process — enrol() must be called after cmd.Start().
func newChildTree(cmd *exec.Cmd) *childTree {
	t := &childTree{}
	if r, _, _ := procCreateJobObject.Call(0, 0); r != 0 {
		job := syscall.Handle(r)
		var info jobObjectExtendedLimitInformation
		info.BasicLimitInformation.LimitFlags = _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		ret, _, _ := procSetInformationJob.Call(
			uintptr(job), _JobObjectExtendedLimitInformation,
			uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info),
		)
		if ret == 0 {
			syscall.CloseHandle(job)
		} else {
			t.job = job
		}
	}
	cmd.Cancel = func() error { t.killTree(); return nil }
	return t
}

// enrol assigns the just-started child to the job. Any descendant it spawns
// after this inherits the job (a microsecond race before assignment is possible
// but the child has not yet booted its own children by then).
func (t *childTree) enrol(cmd *exec.Cmd) error {
	if t.job == 0 || cmd.Process == nil {
		return nil
	}
	ph, err := syscall.OpenProcess(_PROCESS_SET_QUOTA|_PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(ph)
	if r, _, callErr := procAssignProcessToJob.Call(uintptr(t.job), uintptr(ph)); r == 0 {
		return callErr
	}
	return nil
}

func (t *childTree) killTree() {
	if t.job != 0 {
		procTerminateJobObject.Call(uintptr(t.job), 1)
	}
}

func (t *childTree) dispose() {
	if t.job != 0 {
		syscall.CloseHandle(t.job)
		t.job = 0
	}
}
