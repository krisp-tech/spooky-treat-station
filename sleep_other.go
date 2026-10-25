//go:build !windows && !linux

package main

// preventSleep is implemented for Windows and Linux; elsewhere the web app's screen wake lock is used.
func preventSleep() {}
