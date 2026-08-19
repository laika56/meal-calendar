#!/usr/bin/env python3
"""앱 아이콘 생성 — 의존성 없이 PNG를 직접 쓴다.

이미지 라이브러리(PIL/ImageMagick/rsvg)가 이 머신에 없어서 zlib+struct로 직접 인코딩한다.
아이콘 모양을 바꾸려면 draw()만 고치고 `python3 scripts/make_icons.py` 를 다시 돌린다.

**그리는 것: 칼로리 진행 링.** (2026-08-19 교체)

전에는 캘린더 윤곽 + 3×3 점이었는데 두 가지가 문제였다:
  · 캘린더 앱이면 다 그렇게 생겼다 — 「식단」이라는 게 안 보인다
  · 점 9개가 홈화면 60px 에서 뭉갠다

이 앱의 시그니처는 이미 안에 있다 — 날짜마다 도는 진행 링과 반원 칼로리 게이지.
그걸 그대로 아이콘으로 쓴다. 획이 굵어서 작아도 살고, 앱을 열었을 때 보이는 것과
같은 물건이라 학습이 필요 없다.

**닫힌 링이 아니라 아래가 열린 게이지**인 이유: 꽉 찬 초록 링은 애플 피트니스와
헷갈린다. 홈화면에 나란히 놓이면 구분이 안 된다. 아래를 트면 「게이지」로 읽히고,
그건 일간 상세 화면의 반원 칼로리 게이지와 같은 물건이다.

72% 를 채운 이유: 100% 는 「끝난 것」처럼 보이고 50% 는 반쪽처럼 보인다.
진행 중이면서 한눈에 읽히는 지점이다.
"""
import math
import struct
import zlib
from pathlib import Path

BG = (0x0F, 0x1A, 0x14)      # --ok-bg. 순검정이 아니라 깊은 초록빛 — 다크 배경화면에서 안 사라진다
TRACK = (0x25, 0x33, 0x2B)   # 안 채워진 구간. 배경보다 한 단계만 밝게
ACCENT = (0x37, 0xD6, 0x7A)  # --ok. 앱 안에서 쓰는 바로 그 초록

PROGRESS = 0.72
GAP = 0.22          # 아래쪽으로 비워두는 비율. 이만큼이 게이지의 '입'이다

OUT = Path(__file__).resolve().parent.parent / "public"
SIZES = [180, 192, 512]


def draw(size):
    """size×size RGB 픽셀 버퍼. 2×2 슈퍼샘플링으로 가장자리 계단을 없앤다."""
    ss = 2
    n = size * ss
    cx = cy = (n - 1) / 2.0
    outer = n * 0.34          # 바깥 반지름
    inner = n * 0.235         # 안쪽 반지름 (획 두께 = outer - inner)

    px = [[BG] * size for _ in range(size)]

    for y in range(size):
        row = px[y]
        for x in range(size):
            r_acc = g_acc = b_acc = 0
            for sy in range(ss):
                for sx in range(ss):
                    fx = x * ss + sx
                    fy = y * ss + sy
                    dx = fx - cx
                    dy = fy - cy
                    dist = math.hypot(dx, dy)
                    if dist < inner or dist > outer:
                        c = BG
                    else:
                        # 12시에서 시계방향으로 도는 각도 0~1
                        ang = ((math.atan2(dx, -dy) / (2 * math.pi)) + 0.5) % 1.0
                        # 아래쪽 GAP 구간은 비운다 — 0.5(6시)를 중심으로 대칭
                        span = 1.0 - GAP
                        start = GAP / 2.0          # 게이지 시작 지점(왼쪽 아래)
                        t = (ang - start) % 1.0    # 시작점 기준 진행도
                        if t > span:
                            c = BG                 # 입 — 아무것도 안 그린다
                        else:
                            c = ACCENT if t <= span * PROGRESS else TRACK
                    r_acc += c[0]; g_acc += c[1]; b_acc += c[2]
            k = ss * ss
            row[x] = (r_acc // k, g_acc // k, b_acc // k)

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
