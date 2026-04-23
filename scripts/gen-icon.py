import struct, zlib, os

w = h = 256
raw = b""
for y in range(h):
    raw += b"\x00"
    for x in range(w):
        r = int(45 + (x / w) * 120)
        g = int(85 + (y / h) * 80)
        b_ = int(220 - (x / w) * 40)
        raw += struct.pack("BBBB", r, g, b_, 255)

def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

sig = b"\x89PNG\r\n\x1a\n"
ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
idat = chunk(b"IDAT", zlib.compress(raw))
iend = chunk(b"IEND", b"")

out = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "icon.png")
with open(out, "wb") as f:
    f.write(sig + ihdr + idat + iend)
print(f"icon.png created at {out}")
