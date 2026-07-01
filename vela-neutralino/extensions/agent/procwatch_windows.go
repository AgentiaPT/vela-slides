//go:build windows

package main

import (
	"os"
	"os/exec"
	"strings"
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
	kernel32                       = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObject            = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJob          = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJob         = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject         = kernel32.NewProc("TerminateJobObject")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
)

// processName returns the base executable name of pid (diagnostic only), or ""
// if it cannot be read. Lets the log show whether ppid is the Neutralino app or
// something else — the crux of why the parent watch may not fire.
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

// checkBinaryTrusted is a no-op on Windows: os.FileMode does not represent NTFS
// ACLs, so the Unix world-writable permission test (procwatch_unix.go) would be
// meaningless here. On Windows the integrity guarantee rests on the
// absolute-path pin in resolveAgentBin plus standard install-directory ACLs.
func checkBinaryTrusted(string) error { return nil }

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

type procInfo struct {
	ppid uint32
	name string
}

// snapshotProcs returns a pid -> {ppid, name} map of every running process.
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
// wrapper(s) Neutralino spawns the extension through (agent -> cmd.exe -> app),
// and returns the first non-shell ancestor — the Neutralino app process whose
// death actually means "the window closed". Falls back to the immediate parent
// if the walk cannot resolve it.
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
		return int(cur) // first non-shell ancestor == the app
	}
	return int(cur)
}

// watchParentExit blocks on the Neutralino APP process's HANDLE and closes the
// returned channel when it exits. It deliberately watches the app ancestor, not
// the immediate parent: on Windows Neutralino launches the extension through a
// cmd.exe wrapper that (a) inherits the app's server socket — so the loopback
// port watch sees it as open long after the app dies — and (b) blocks waiting on
// this agent, so the immediate ppid never dies either. Only the app process's
// death is a true "window closed" signal, and a direct handle to it is immune to
// PID reuse and to the inherited-socket/immortal-shell traps. Primary signal on
// Windows; stdin EOF closes too early here to be usable, and the port watch is
// unreliable for the same inheritance reason.
func watchParentExit(dir string) <-chan struct{} {
	ppid := os.Getppid()
	appPid := resolveAppAncestor(ppid)
	logf(dir, "parent-handle watch: ppid=%d parent=%q -> app-ancestor=%d name=%q",
		ppid, processName(ppid), appPid, processName(appPid))
	if appPid <= 0 {
		logf(dir, "parent-handle watch: no app ancestor — DISABLED")
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
		ev, werr := syscall.WaitForSingleObject(h, _INFINITE)
		logf(dir, "parent-handle watch: app process %d exited ev=0x%x err=%v", appPid, ev, werr)
		close(ch)
	}()
	logf(dir, "parent-handle watch: ARMED on app-ancestor pid=%d name=%q", appPid, processName(appPid))
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
