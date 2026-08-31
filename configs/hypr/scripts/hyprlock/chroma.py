#!/usr/bin/env python3
# chroma

from __future__ import annotations

import argparse
import html
import os
import re
import signal
import subprocess
from pathlib import Path

HEADER = re.compile(
    rb"^CHROMA_FRAME v=1 frame=\d+ width=(\d+) height=(\d+) "
    rb"format=cells encoding=utf-8 bytes=(\d+)\n$"
)
RGB = re.compile(r"^[0-9A-Fa-f]{6}$")
MAX_FRAME_BYTES = 4 * 1024 * 1024

stopping = False
chroma: subprocess.Popen[bytes] | None = None

def stop(_signum: int, _frame: object) -> None:
    global stopping
    stopping = True
    if chroma is not None and chroma.poll() is None:
        chroma.terminate()

def render_pango(payload: bytes, width: int, height: int) -> str:
    glyphs = [["\u00a0"] * width for _ in range(height)]
    colors: list[list[str | None]] = [[None] * width for _ in range(height)]

    for record in payload.decode("utf-8", errors="replace").splitlines():
        fields = record.split("\t")
        if len(fields) != 6:
            continue
        try:
            x, y, display_width = map(int, fields[:3])
            codepoint = int(fields[3].removeprefix("U+"), 16)
            glyph = chr(codepoint)
        except (ValueError, OverflowError):
            continue
        if not (0 <= x < width and 0 <= y < height):
            continue

        color = fields[4].upper() if RGB.fullmatch(fields[4]) else None
        glyphs[y][x] = "\u00a0" if glyph == " " else glyph
        colors[y][x] = color
        for continuation in range(1, max(1, display_width)):
            if x + continuation < width:
                glyphs[y][x + continuation] = ""
                colors[y][x + continuation] = color

    rendered_rows: list[str] = []
    for row_glyphs, row_colors in zip(glyphs, colors, strict=True):
        chunks: list[str] = []
        start = 0
        while start < width:
            color = row_colors[start]
            end = start + 1
            while end < width and row_colors[end] == color:
                end += 1
            text = html.escape("".join(row_glyphs[start:end]), quote=False)
            if color:
                chunks.append(f'<span foreground="#{color}">{text}</span>')
            else:
                chunks.append(text)
            start = end
        rendered_rows.append("".join(chunks))

    return '<span line_height="0.82">' + "\n".join(rendered_rows) + "</span>"

def write_atomic(path: Path, content: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)

def main() -> int:
    global chroma

    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a Chroma command is required after --")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        chroma = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        assert chroma.stdout is not None

        while not stopping:
            header = chroma.stdout.readline()
            if not header:
                break
            match = HEADER.fullmatch(header)
            if not match:
                continue

            width, height, payload_size = map(int, match.groups())
            if payload_size < 0 or payload_size > MAX_FRAME_BYTES:
                break
            payload = chroma.stdout.read(payload_size)
            if len(payload) != payload_size:
                break
            write_atomic(args.output, render_pango(payload, width, height))
    finally:
        if chroma is not None and chroma.poll() is None:
            chroma.terminate()
            try:
                chroma.wait(timeout=1)
            except subprocess.TimeoutExpired:
                chroma.kill()
                chroma.wait()
        args.output.with_suffix(args.output.suffix + ".tmp").unlink(missing_ok=True)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
