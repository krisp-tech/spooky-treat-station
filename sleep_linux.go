//go:build linux

package main

import (
	"fmt"
	"os/exec"
	"time"
)

// preventSleep blocks system sleep and idle actions through systemd-logind while the app runs.
// The lock is held by `systemd-inhibit ... cat`, reading a pipe from us: when this program exits
// (even if it crashes), the pipe closes, cat ends and the lock is released.
// The screen itself is kept on by the web page's screen wake lock.
func preventSleep() {
	path, err := exec.LookPath("systemd-inhibit")
	if err != nil {
		fmt.Println("Sleep       : could not disable (systemd-inhibit not found) - turn off sleep in your system settings")
		return
	}
	cmd := exec.Command(path, "--what=sleep:idle", "--who=Spooky Treat Station", "--why=Halloween show is running", "--mode=block", "cat")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		fmt.Println("Sleep       : could not disable:", err)
		return
	}
	keepPipeOpen = stdin
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	select {
	case err := <-exited:
		fmt.Printf("Sleep       : could not disable (%v) - turn off sleep in your system settings\n", err)
	case <-time.After(500 * time.Millisecond):
		fmt.Println("Sleep       : disabled while running")
	}
}

// keepPipeOpen holds the inhibitor's stdin for the life of the program.
var keepPipeOpen any
