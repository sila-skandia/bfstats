"""Keep a brotli copy beside the biggest glbs, for nginx's `brotli_static`.

Phase 2b of `features/mesh-asset-size`. The `.glb.gz` of phase 2a cuts a level
to about 42% of the glb; brotli's window spans the whole buffer where gzip's
is 32 KB, so the same level's `.glb.br` is about 19-24%. Cloudflare asks the
origin for `br, gzip` on every plan, so the `.br` is what the edge caches for
the browsers that take it (all of them); the `.gz` stays beside it for
everything else, and the plain glb under both.

Models and rigs already gzip to 10-35% and brotli gains them little in
absolute bytes (`features/mesh-asset-size`, phase 2b's table), so only a glb
of at least `MIN_BYTES` gets a `.br`: the level scenes and the largest models,
where the bytes are.

The staleness problem `glbgz` solves with the gzip trailer needs its own
answer here, because a brotli stream records nothing about its content. The
answer is RFC 7932's metadata meta-block: a skippable block every conforming
decoder ignores, emitted by the reference encoder itself
(`BROTLI_OPERATION_EMIT_METADATA`) as the stream's FIRST block, carrying a
magic and the CRC-32 and length of the glb the stream inflates to. The file is
then self-describing exactly as a `.gz` is through its trailer -- `is_fresh`
reads 19 bytes, and the publisher and the API route make the same check at the
same cost as the gzip one. A `.br` made by a plain `brotli` call has no such
block and reads as stale, so nothing hand-made ever passes for fresh.

The encoder is the reference library (`libbrotlienc`, loaded with ctypes;
there is no stdlib brotli), deterministic for a version: no name, no
timestamp, nothing but the input and our record in the stream. Freshness is
content-based, so a library upgrade never rewrites a `.br` that still inflates
to its glb -- the same rule as the `.gz`. Every write is decoded back and
compared to the glb first.
"""

from __future__ import annotations

import ctypes
import os
import struct
import zlib
from ctypes.util import find_library
from pathlib import Path

# q11 against q9 on a 70 MB FHSW scene: 19.3% against 22.6% of the glb, for
# CPU paid once per changed glb (and parallelised by the optimiser's -j) and
# saved on every transfer. --lgwin 24 is the largest window the "br" content
# coding allows.
QUALITY = 11
LGWIN = 24
SUFFIX = ".br"

# Only a glb at least this big gets a .br: the level scenes and the few
# largest models. Below it the win over the .gz that every glb already has is
# a few percent of an already-small transfer, not worth the storage or the
# encoder minutes (features/mesh-asset-size, phase 2b).
MIN_BYTES = 4 * 1000 * 1000

MAGIC = b"GBR1"
PAYLOAD_LEN = 4 + 4 + 8  # magic, crc32, u64 length
# The payload starts at the byte boundary after the WBITS code (1, 4 or 7
# bits) and the 14 bits of meta-block header: byte 2 or 3, so the whole
# record fits in the first 19 bytes.
HEADER_LEN = 3 + PAYLOAD_LEN

_PROCESS, _FLUSH, _FINISH, _EMIT_METADATA = 0, 1, 2, 3
_PARAM_QUALITY, _PARAM_LGWIN, _PARAM_SIZE_HINT = 1, 2, 5
_DECODER_SUCCESS = 1


class BrotliUnavailable(RuntimeError):
    pass


_libs: tuple[ctypes.CDLL, ctypes.CDLL] | None = None


def _lib() -> tuple[ctypes.CDLL, ctypes.CDLL]:
    global _libs
    if _libs is not None:
        return _libs
    try:
        enc = ctypes.CDLL(find_library("brotlienc") or "libbrotlienc.so.1")
        dec = ctypes.CDLL(find_library("brotlidec") or "libbrotlidec.so.1")
    except OSError as exc:
        raise BrotliUnavailable(
            "no brotli library found: install brotli (libbrotlienc/libbrotlidec) "
            "to write .glb.br copies") from exc
    u8p = ctypes.POINTER(ctypes.c_ubyte)
    enc.BrotliEncoderCreateInstance.restype = ctypes.c_void_p
    enc.BrotliEncoderCreateInstance.argtypes = [ctypes.c_void_p] * 3
    enc.BrotliEncoderDestroyInstance.argtypes = [ctypes.c_void_p]
    enc.BrotliEncoderSetParameter.restype = ctypes.c_int
    enc.BrotliEncoderSetParameter.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint32]
    enc.BrotliEncoderCompressStream.restype = ctypes.c_int
    enc.BrotliEncoderCompressStream.argtypes = [
        ctypes.c_void_p, ctypes.c_int,
        ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(u8p),
        ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(u8p),
        ctypes.POINTER(ctypes.c_size_t)]
    enc.BrotliEncoderHasMoreOutput.restype = ctypes.c_int
    enc.BrotliEncoderHasMoreOutput.argtypes = [ctypes.c_void_p]
    enc.BrotliEncoderIsFinished.restype = ctypes.c_int
    enc.BrotliEncoderIsFinished.argtypes = [ctypes.c_void_p]
    dec.BrotliDecoderDecompress.restype = ctypes.c_int
    dec.BrotliDecoderDecompress.argtypes = [
        ctypes.c_size_t, ctypes.c_char_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_char_p]
    _libs = (enc, dec)
    return _libs


def br_path(glb: Path) -> Path:
    return glb.with_name(glb.name + SUFFIX)


def wants(size: int) -> bool:
    return size >= MIN_BYTES


def _pump(enc: ctypes.CDLL, state, op: int, chunk: bytes, out: bytearray) -> None:
    u8p = ctypes.POINTER(ctypes.c_ubyte)
    src = (ctypes.c_ubyte * len(chunk)).from_buffer_copy(chunk) if chunk \
        else (ctypes.c_ubyte * 1)()
    next_in = ctypes.cast(src, u8p)
    avail_in = ctypes.c_size_t(len(chunk))
    buf = (ctypes.c_ubyte * (1 << 20))()
    while True:
        next_out = ctypes.cast(buf, u8p)
        avail_out = ctypes.c_size_t(len(buf))
        if not enc.BrotliEncoderCompressStream(
                state, op, ctypes.byref(avail_in), ctypes.byref(next_in),
                ctypes.byref(avail_out), ctypes.byref(next_out), None):
            raise ValueError("the brotli encoder refused the stream")
        out += bytes(buf[:len(buf) - avail_out.value])
        if avail_in.value == 0 and not enc.BrotliEncoderHasMoreOutput(state):
            if op != _FINISH or enc.BrotliEncoderIsFinished(state):
                return


def compress(data: bytes) -> bytes:
    """A brotli stream of `data` that opens with a metadata meta-block naming
    what it inflates to: MAGIC, crc32 and length. Conforming decoders skip it
    (RFC 7932 section 9.2); `read_meta` is how everyone else reads it."""
    enc, _ = _lib()
    state = enc.BrotliEncoderCreateInstance(None, None, None)
    if not state:
        raise MemoryError("BrotliEncoderCreateInstance failed")
    out = bytearray()
    try:
        enc.BrotliEncoderSetParameter(state, _PARAM_QUALITY, QUALITY)
        enc.BrotliEncoderSetParameter(state, _PARAM_LGWIN, LGWIN)
        enc.BrotliEncoderSetParameter(state, _PARAM_SIZE_HINT, len(data) & 0xFFFFFFFF)
        payload = MAGIC + struct.pack("<IQ", zlib.crc32(data), len(data))
        _pump(enc, state, _EMIT_METADATA, payload, out)
        _pump(enc, state, _FINISH, data, out)
    finally:
        enc.BrotliEncoderDestroyInstance(state)
    done = bytes(out)
    # Belt and braces, once per write: the record must read back, and the
    # stream must inflate to exactly its input.
    if parse_meta(done[:HEADER_LEN]) != (zlib.crc32(data), len(data)):
        raise ValueError("the encoder did not open the stream with our metadata block")
    if decompress(done, len(data)) != data:
        raise ValueError("the brotli stream does not inflate to its input")
    return done


def decompress(data: bytes, size: int | None = None) -> bytes:
    """Inflate a `.br`'s bytes. `size` is the inflated length when the caller
    knows it; otherwise it is read from the stream's metadata block."""
    if size is None:
        meta = parse_meta(data[:HEADER_LEN])
        if meta is None:
            raise ValueError("no metadata block to size the output from")
        size = meta[1]
    _, dec = _lib()
    out_len = ctypes.c_size_t(size)
    buf = ctypes.create_string_buffer(max(size, 1))
    if dec.BrotliDecoderDecompress(len(data), data, ctypes.byref(out_len),
                                   buf) != _DECODER_SUCCESS:
        raise ValueError("not a brotli stream, or larger than its record says")
    return buf.raw[:out_len.value]


def _wbits_len(byte0: int) -> int | None:
    """How many bits the stream's WBITS code occupies (RFC 7932 section 9.1),
    or None for the reserved pattern the reference encoder never emits."""
    if not byte0 & 1:
        return 1
    if (byte0 >> 1) & 0b111:
        return 4
    if (byte0 >> 4) & 0b111 == 1:
        return None  # reserved / large-window, not the "br" coding
    return 7


def _header(byte0: int, payload_len: int) -> bytes | None:
    """The bytes that open a stream whose WBITS code is `byte0`'s, up to the
    metadata payload: the code, then one metadata meta-block header -- ISLAST
    0, MNIBBLES code 3 (a metadata block), the reserved bit, MSKIPBYTES 1,
    MSKIPLEN-1 -- then zero fill to the byte boundary the payload starts on
    (RFC 7932 section 9.2). This is byte for byte what the reference encoder
    writes for EMIT_METADATA at the head of a stream."""
    length = _wbits_len(byte0)
    if length is None:
        return None
    bits = byte0 & ((1 << length) - 1)
    at = length
    for value, width in ((0, 1), (3, 2), (0, 1), (1, 2), (payload_len - 1, 8)):
        bits |= value << at
        at += width
    return bits.to_bytes((at + 7) // 8, "little")


def parse_meta(head: bytes) -> tuple[int, int] | None:
    if not head:
        return None
    header = _header(head[0], PAYLOAD_LEN)
    if header is None or len(head) < len(header) + PAYLOAD_LEN:
        return None
    at = len(header)
    if head[:at] != header or head[at:at + len(MAGIC)] != MAGIC:
        return None
    crc, length = struct.unpack_from("<IQ", head, at + len(MAGIC))
    return crc, length


def read_meta(br: Path) -> tuple[int, int] | None:
    """(crc32, length) of the glb a `.br` written here inflates to, from its
    metadata meta-block, or None when the file is missing or is not ours."""
    try:
        with open(br, "rb") as handle:
            head = handle.read(HEADER_LEN)
    except OSError:
        return None
    return parse_meta(head)


def is_fresh(data: bytes, br: Path) -> bool:
    """Whether `br` inflates to `data`, going by its metadata block."""
    return read_meta(br) == (zlib.crc32(data), len(data))


def ensure(glb: Path, data: bytes | None = None, create: bool = True) -> tuple[bool, int]:
    """Make `<glb>.br` match the glb, for a glb big enough to want one.
    Returns (rewritten, size of the .br; 0 when the glb goes without).

    The same rules as `glbgz.ensure`: rewritten through its own inode for the
    hard-link mirrors, and a fresh copy older than its glb is touched so the
    API's mtime check holds. A glb that gets no new `.br` (too small, or
    `create` is off for a cheap pass) still has an EXISTING one kept in step:
    a stale `.br` on the volume is what every browser would be sent, so the
    publisher refuses it, and nothing here may leave one behind."""
    data = glb.read_bytes() if data is None else data
    br = br_path(glb)
    if (not create or not wants(len(data))) and not br.exists():
        return False, 0
    if is_fresh(data, br):
        stat = br.stat()
        if stat.st_mtime_ns < glb.stat().st_mtime_ns:
            os.utime(br)
        return False, stat.st_size
    out = compress(data)
    mode = "r+b" if br.exists() else "wb"
    with open(br, mode) as handle:
        handle.write(out)
        handle.truncate()
    return True, len(out)
