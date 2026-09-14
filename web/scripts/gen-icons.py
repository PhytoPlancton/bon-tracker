#!/usr/bin/env python3
"""Génère les icônes PWA sans dépendance externe (zlib + PNG brut)."""
import math, struct, zlib, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
BG_TOP = (255, 122, 26)
BG_BOTTOM = (240, 78, 8)
INK = (12, 13, 15)
WHITE = (255, 255, 255)

# Courbe de prix stylisée, en coordonnées normalisées (0..1).
CURVE = [(0.12, 0.34), (0.32, 0.52), (0.50, 0.40), (0.68, 0.70), (0.88, 0.60)]


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def coverage(distance, radius, softness=1.0):
    """Anti-aliasing simple : 1 au cœur du trait, 0 au-delà du rayon."""
    if distance <= radius - softness:
        return 1.0
    if distance >= radius + softness:
        return 0.0
    return (radius + softness - distance) / (2 * softness)


def render(size, rounded):
    radius = size * 0.22 if rounded else 0
    stroke = max(2.0, size * 0.055)
    dot = stroke * 1.35
    points = [(x * size, y * size) for x, y in CURVE]
    rows = []

    for y in range(size):
        row = bytearray()
        for x in range(size):
            cx, cy = x + 0.5, y + 0.5

            # Fond : dégradé vertical orange.
            ratio = y / max(1, size - 1)
            pixel = tuple(
                round(t + (b - t) * ratio) for t, b in zip(BG_TOP, BG_BOTTOM)
            )
            alpha = 1.0

            if rounded:
                # Masque en coins arrondis (squircle approximé par un rayon).
                dx = max(radius - cx, cx - (size - radius), 0)
                dy = max(radius - cy, cy - (size - radius), 0)
                if dx > 0 and dy > 0:
                    alpha = coverage(math.hypot(dx, dy), radius)

            # Ligne de prix.
            best = min(
                dist_to_segment(cx, cy, *points[i], *points[i + 1])
                for i in range(len(points) - 1)
            )
            line_a = coverage(best, stroke / 2)
            if line_a > 0:
                pixel = blend(pixel, WHITE, line_a)

            # Points d'observation, cœur sombre cerclé de blanc.
            for px, py in points:
                d = math.hypot(cx - px, cy - py)
                ring = coverage(d, dot)
                if ring > 0:
                    pixel = blend(pixel, WHITE, ring)
                core = coverage(d, dot * 0.45)
                if core > 0:
                    pixel = blend(pixel, INK, core)

            row += bytes((*pixel, round(alpha * 255)))
        rows.append(row)

    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    return png(size, size, raw)


def png(width, height, raw):
    def chunk(tag, data):
        payload = tag + data
        return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload))

    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', header)
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


os.makedirs(OUT, exist_ok=True)
for size, rounded, name in [
    (192, True, 'icon-192.png'),
    (512, True, 'icon-512.png'),
    (180, False, 'apple-touch-icon.png'),  # iOS applique lui-même le masque
    (32, True, 'favicon-32.png'),
]:
    with open(os.path.join(OUT, name), 'wb') as handle:
        handle.write(render(size, rounded))
    print('généré', name, size)
