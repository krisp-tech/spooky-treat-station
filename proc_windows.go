//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow starts helper programs (Piper) without a console window of their own.
func hideWindow(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
