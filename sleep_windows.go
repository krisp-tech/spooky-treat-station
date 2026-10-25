//go:build windows

package main

import (
	"fmt"
	"runtime"
	"syscall"
	"time"
)

const (
	esContinuous      = 0x80000000
	esSystemRequired  = 0x00000001
	esDisplayRequired = 0x00000002
)

// preventSleep asks Windows to keep the system and the display awake while the app runs.
func preventSleep() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("SetThreadExecutionState")
	if err := proc.Find(); err != nil {
		fmt.Println("Note: could not disable sleep:", err)
		return
	}
	// The execution state belongs to a thread, so refresh it periodically from a ticker goroutine.
	go func() {
		runtime.LockOSThread()
		for {
			proc.Call(uintptr(esContinuous | esSystemRequired | esDisplayRequired))
			time.Sleep(30 * time.Second)
		}
	}()
	fmt.Println("Sleep       : disabled while running")
}
