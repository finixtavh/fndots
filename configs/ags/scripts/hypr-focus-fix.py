#!/usr/bin/env python3
# hypr focus fix

import os
import socket
import sys
import time

RUNTIME_DIR = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
SIG = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
if not SIG:
    sys.exit("HYPRLAND_INSTANCE_SIGNATURE not set")
if not os.path.isabs(RUNTIME_DIR) or os.path.basename(SIG) != SIG:
    sys.exit("Invalid Hyprland runtime path")

EVENT_SOCK_PATH = f"{RUNTIME_DIR}/hypr/{SIG}/.socket2.sock"
CONTROL_SOCK_PATH = f"{RUNTIME_DIR}/hypr/{SIG}/.socket.sock"
TRIGGER_PREFIXES = ("openwindow>>", "closewindow>>", "openlayer>>", "closelayer>>")

def ipc(command: str) -> str:

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.0)
        sock.connect(CONTROL_SOCK_PATH)
        sock.sendall(command.encode())
        return sock.recv(4096).decode(errors="replace").strip()

def nudge() -> None:
    try:
        pos = ipc("cursorpos")
        parts = [part.strip() for part in pos.split(",")]
        if len(parts) != 2:
            return
        x, y = (int(part) for part in parts)
        ipc(f"dispatch hl.dsp.cursor.move({{x={x}, y={y}}})")
    except (OSError, ValueError):

        pass

def listen_once():
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.connect(EVENT_SOCK_PATH)
        buf = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                return
            buf += chunk
            should_nudge = False
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if line.decode(errors="ignore").startswith(TRIGGER_PREFIXES):
                    should_nudge = True

            if should_nudge:
                nudge()

def main():
    while True:
        try:
            listen_once()
        except (FileNotFoundError, ConnectionRefusedError, OSError):
            pass
        time.sleep(2)

if __name__ == "__main__":
    main()
