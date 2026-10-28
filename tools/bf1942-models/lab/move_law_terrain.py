"""A level's terrain as the server's PatchTerrain reads it, for move_law_check.py.

PatchTerrain::getHeight (lnxded 0x083d6520) and getHeightAndNormal (0x083d6f10):
the cell is split into two triangles, the diagonal chosen by the parity of
(ix + iz) -- (0,0)-(1,1) when it is even, (1,0)-(0,1) when it is odd -- and the
height is the plane of the triangle the point is in, times yScale / 256
(Wake: 0.6 / 256). HeightMap::getHeight (0x0838d660) masks both indices, so the
lattice wraps (TERR-6). The normal is the triangle's face normal. The material
is the nearest sample, 0 outside the world (TERR-9).

Load either the whole Heightmap.raw / Materialmap.raw pair or the window of
samples tests/fixtures/move_law_wake_terrain.json.gz carries.
"""
import gzip, json, math, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, '..', 'tests', 'fixtures', 'move_law_wake_terrain.json.gz')


class Terrain:
    def __init__(self, sample, material, dim=512, spacing=4.0, y_scale=0.6):
        self._sample = sample
        self._material = material
        self.dim = dim
        self.spacing = spacing
        self.hs = y_scale / 256.0

    @classmethod
    def from_raw(cls, height_path, material_path, dim=512, spacing=4.0, y_scale=0.6):
        raw = struct.unpack('<%dH' % (dim * dim), open(height_path, 'rb').read())
        mat = open(material_path, 'rb').read()
        m = dim - 1
        return cls(lambda i, j: raw[((j & m) * dim) + (i & m)],
                   # The server keeps a byte's low nibble (TERR-18).
                   lambda i, j: mat[j * dim + i] & 0xF if 0 <= i < dim and 0 <= j < dim else 0,
                   dim, spacing, y_scale)

    @classmethod
    def from_fixture(cls, path=FIXTURE):
        doc = json.load(gzip.open(path, 'rt'))
        i0, j0, n, dim = doc['i0'], doc['j0'], doc['n'], doc['dim']
        hs, ms = doc['heights'], doc['materials']
        m = dim - 1

        def sample(i, j):
            i &= m; j &= m
            if not (i0 <= i < i0 + n and j0 <= j < j0 + n):
                raise IndexError('sample (%d, %d) is outside the fixture window' % (i, j))
            return hs[(j - j0) * n + (i - i0)]

        def material(i, j):
            if not (0 <= i < dim and 0 <= j < dim): return 0
            return ms[(j - j0) * n + (i - i0)]
        return cls(sample, material, dim, doc['spacing'], doc['yScale'])

    def height_normal(self, x, z):
        S = self._sample
        u = x / self.spacing; v = z / self.spacing
        i = int(math.floor(u)); j = int(math.floor(v))
        fx = u - i; fz = v - j
        h00, h10, h01, h11 = S(i, j), S(i + 1, j), S(i, j + 1), S(i + 1, j + 1)
        if ((i + j) & 1) == 0:          # diagonal (0,0)-(1,1)
            if fz >= fx:                 # triangle (0,0),(0,1),(1,1)
                h = h01 + (h11 - h01) * fx + (h00 - h01) * (1 - fz)
                dhdx = (h11 - h01); dhdz = (h01 - h00)
            else:                        # (0,0),(1,0),(1,1)
                h = h10 + (h00 - h10) * (1 - fx) + (h11 - h10) * fz
                dhdx = (h10 - h00); dhdz = (h11 - h10)
        else:                            # diagonal (1,0)-(0,1)
            if (1 - fx) < fz:            # (1,1),(0,1),(1,0)
                h = h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
                dhdx = (h11 - h01); dhdz = (h11 - h10)
            else:                        # (0,0),(1,0),(0,1)
                h = h00 + (h10 - h00) * fx + (h01 - h00) * fz
                dhdx = (h10 - h00); dhdz = (h01 - h00)
        gx = dhdx * self.hs / self.spacing; gz = dhdz * self.hs / self.spacing
        L = math.sqrt(gx * gx + 1 + gz * gz)
        return h * self.hs, (-gx / L, 1 / L, -gz / L)

    def material(self, x, z):
        return self._material(int(round(x / self.spacing)), int(round(z / self.spacing)))
