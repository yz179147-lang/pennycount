#!/usr/bin/env python3
"""產生 PennyCount 的 App 圖示（不依賴任何套件，直接手寫 PNG）。

    python3 tools/make_icons.py

圖示是品牌紫粉漸層底 + 三根遞增長條（呼應統計頁）。
全部做成滿版方形：iOS 與 Android 會自己套用圓角遮罩，
沒有 alpha 通道的圓角圖反而會在角落露出黑邊。
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"

GRAD_A = (0x9A, 0x6D, 0xCC)   # 紫粉漸層起點
GRAD_B = (0xD7, 0x8E, 0xAF)   # 紫粉漸層終點
INK = (0xFF, 0xFF, 0xFF)      # 長條
INK_SOFT = (0xFF, 0xF3, 0xF9) # 較淡的長條，做出層次


def write_png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def fill(px, size, x0, y0, x1, y1, color, radius=0):
    """畫一個圓角矩形（radius = 0 就是直角）。"""
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    for y in range(max(y0, 0), min(y1, size)):
        for x in range(max(x0, 0), min(x1, size)):
            if radius:
                dx = max(x0 + radius - x, x - (x1 - 1 - radius), 0)
                dy = max(y0 + radius - y, y - (y1 - 1 - radius), 0)
                if dx and dy and dx * dx + dy * dy > radius * radius:
                    continue
            px[y][x] = color


def render(size, glyph_scale):
    # 135° 對角漸層，和介面上的主要按鈕同一條
    px = []
    for y in range(size):
        row = []
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            row.append(tuple(round(a + (b - a) * t) for a, b in zip(GRAD_A, GRAD_B)))
        px.append(row)

    cx = cy = size / 2
    unit = size * glyph_scale / 10.0
    left = cx - unit * 2.65
    base = cy + unit * 3.25
    radius = max(1, int(unit * 0.3))

    for i, height in enumerate((2.4, 3.6, 5.0)):
        x0 = left + i * unit * 2.0
        color = INK_SOFT if i < 2 else INK
        fill(px, size, x0, base - unit * height, x0 + unit * 1.3, base, color, radius)

    fill(px, size, left, cy - unit * 3.25, left + unit * 5.3, cy - unit * 2.75, INK, radius)
    return px


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, scale in [
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("apple-touch-icon.png", 180, 1.0),
        ("icon-maskable-512.png", 512, 0.68),  # maskable 要留安全邊距
    ]:
        write_png(OUT / name, size, render(size, scale))
        print("wrote", name, size)


if __name__ == "__main__":
    main()
