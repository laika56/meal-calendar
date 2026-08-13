#!/usr/bin/env python3
"""앱 아이콘 생성 — 의존성 없이 PNG를 직접 쓴다.

이미지 라이브러리(PIL/ImageMagick/rsvg)가 이 머신에 없어서 zlib+struct로 직접 인코딩한다.
아이콘 모양을 바꾸려면 draw()만 고치고 `python3 scripts/make_icons.py` 를 다시 돌린다.

그리는 것: 어두운 배경 위 캘린더 윤곽 + 점 3×3, 그중 하나만 초록.
(캘린더가 메인 화면이고, 초록 점은 "목표 달성"이다)
"""
import struct
import zlib
from pathlib import Path

BG = (0x16, 0x18, 0x1D)
FG = (0xF2, 0xF4, 0xF7)
ACCENT = (0x5F, 0xD4, 0x8F)

OUT = Path(__file__).resolve().parent.parent / "public"
SIZES = [180, 192, 512]


def draw(size):
    """size×size RGB 픽셀 버퍼를 만든다. 좌표는 180 기준으로 잡고 비율로 환산."""
    s = size / 180.0
    px = [[BG] * size for _ in range(size)]

    def rect(x0, y0, x1, y1, color, radius=0):
        X0, Y0 = int(x0 * s), int(y0 * s)
        X1, Y1 = int(x1 * s), int(y1 * s)
        r = radius * s
        for y in range(max(0, Y0), min(size, Y1)):
            for x in range(max(0, X0), min(size, X1)):
                if r > 0:
                    # 모서리 안쪽 원 중심까지의 거리로 라운딩 판정
                    cx = min(max(x, X0 + r), X1 - r)
                    cy = min(max(y, Y0 + r), Y1 - r)
                    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                        continue
                px[y][x] = color

    def frame(x0, y0, x1, y1, w, color, radius=0):
        rect(x0, y0, x1, y1, color, radius)
        rect(x0 + w, y0 + w, x1 - w, y1 - w, BG, max(0, radius - w))

    # 상단 고리 2개
    rect(58, 28, 68, 48, FG, 5)
    rect(112, 28, 122, 48, FG, 5)

    # 달력 본체 윤곽
    frame(30, 38, 150, 152, 9, FG, 18)
    # 헤더 바
    rect(39, 47, 141, 66, FG, 0)

    # 3×3 점 — 마지막 줄 가운데만 초록
    for row in range(3):
        for col in range(3):
            cx = 55 + col * 35
            cy = 88 + row * 24
            color = ACCENT if (row, col) == (2, 1) else FG
            rect(cx - 7, cy - 7, cx + 7, cy + 7, color, 7)

    return px


def write_png(path, px):
    size = len(px)
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("3B", *p) for p in row) for row in px
    )

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    return len(png)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for n in SIZES:
        p = OUT / f"icon-{n}.png"
        print(f"{p.name}  {write_png(p, draw(n)):,} bytes")
