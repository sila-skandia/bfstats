#!/usr/bin/env python3
"""Generates the BF1942 Model Extraction and Web Reconstruction Field Guide PDF."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

OUT_DIR = Path("/home/dylan/projects/skandia/bfstats/features/bf1942-3d-models/explainer")
OUT_HTML = OUT_DIR / "refractor-field-guide.html"
OUT_PDF = OUT_DIR / "refractor-field-guide.pdf"
PARENT_PDF = OUT_DIR.parent / "refractor-field-guide.pdf"

HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Dissecting Refractor: BF1942 asset storage and web reconstruction manual</title>
<style>
  @page {
    size: A4;
    margin: 16mm 15mm 18mm 15mm;
    @top-left {
      content: "Dissecting Refractor: Asset storage and web reconstruction";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 7.5pt;
      color: #555;
      border-bottom: 1px solid #bbb;
      padding-bottom: 3px;
      margin-bottom: 6mm;
    }
    @top-right {
      content: "Technical manual";
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 7.5pt;
      color: #555;
      border-bottom: 1px solid #bbb;
      padding-bottom: 3px;
      margin-bottom: 6mm;
    }
    @bottom-center {
      content: "- " counter(page) " -";
      font-family: "Courier New", Courier, monospace;
      font-size: 8.5pt;
      color: #444;
    }
  }

  @page :first {
    margin: 0;
    @top-left { content: none; }
    @top-right { content: none; }
    @bottom-center { content: none; }
  }

  * { box-sizing: border-box; }

  body {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 9pt;
    line-height: 1.36;
    color: #1a1a1a;
    background: #fff;
    margin: 0;
    padding: 0;
  }

  /* Cover page */
  .cover-page {
    page-break-after: always;
    height: 100vh;
    padding: 30mm 24mm 24mm 24mm;
    background: #181a15;
    color: #e6e4d9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    box-sizing: border-box;
  }

  .cover-border {
    border: 2px solid #5a6b32;
    padding: 24px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .cover-top-tag {
    font-family: "Courier New", Courier, monospace;
    font-size: 8.5pt;
    letter-spacing: 0.2em;
    color: #9aab5a;
    border-bottom: 1px solid #333a20;
    padding-bottom: 8px;
  }

  .cover-title-group {
    margin-top: 16px;
  }

  .cover-title {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 24pt;
    font-weight: 800;
    line-height: 1.15;
    color: #f5f4ed;
    margin: 0 0 10px 0;
  }

  .cover-subtitle {
    font-size: 11.5pt;
    line-height: 1.35;
    color: #b0b59b;
    font-weight: 400;
    margin: 0 0 16px 0;
  }

  .cover-badge {
    display: inline-block;
    background: #2b3318;
    color: #c4d67e;
    font-family: "Courier New", Courier, monospace;
    font-size: 8pt;
    padding: 4px 10px;
    border: 1px solid #5a6b32;
    border-radius: 2px;
  }

  .cover-ascii {
    font-family: "Courier New", Courier, monospace;
    font-size: 6.8pt;
    line-height: 1.15;
    color: #6d7752;
    background: #11130e;
    padding: 10px;
    border: 1px solid #282e1b;
    margin: 16px 0;
    white-space: pre;
    overflow: hidden;
  }

  .cover-footer {
    border-top: 1px solid #333a20;
    padding-top: 10px;
    font-size: 8pt;
    color: #7d826a;
    display: flex;
    justify-content: space-between;
  }

  /* Headings */
  h1 {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12.5pt;
    font-weight: bold;
    color: #1e2412;
    border-bottom: 2px solid #2d3618;
    padding-bottom: 2px;
    margin-top: 14pt;
    margin-bottom: 6pt;
    page-break-after: avoid;
  }

  .chapter-header {
    page-break-before: always;
    margin-top: 0;
    padding-top: 0;
  }

  .chapter-num {
    font-family: "Courier New", Courier, monospace;
    font-size: 8pt;
    font-weight: bold;
    letter-spacing: 0.15em;
    color: #5d6e2e;
    margin-bottom: 2px;
  }

  h2 {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 9.8pt;
    font-weight: bold;
    color: #2b3318;
    margin-top: 10pt;
    margin-bottom: 4pt;
    page-break-after: avoid;
    border-left: 3px solid #6b8032;
    padding-left: 5px;
  }

  h3 {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 8.8pt;
    font-weight: bold;
    color: #333;
    margin-top: 8pt;
    margin-bottom: 3pt;
    page-break-after: avoid;
  }

  p {
    margin-top: 0;
    margin-bottom: 4.5pt;
    text-align: justify;
  }

  ul, ol {
    margin-top: 0;
    margin-bottom: 4.5pt;
    padding-left: 16px;
  }

  li {
    margin-bottom: 1.5pt;
  }

  /* Code and syntax */
  pre, code {
    font-family: "Courier New", Courier, monospace;
  }

  code {
    font-size: 8pt;
    background: #f0f2eb;
    color: #2b3318;
    padding: 1px 3px;
    border: 1px solid #d5dbcb;
    border-radius: 2px;
  }

  pre {
    background: #141710;
    color: #e0e2d8;
    padding: 6px 8px;
    font-size: 7.4pt;
    line-height: 1.28;
    border-left: 3px solid #7c9438;
    border-radius: 2px;
    overflow-x: hidden;
    margin-top: 2.5pt;
    margin-bottom: 5pt;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-all;
  }

  pre .kw { color: #d48550; font-weight: bold; }
  pre .str { color: #a4b95f; }
  pre .com { color: #6e7562; font-style: italic; }
  pre .typ { color: #68a8b8; }
  pre .num { color: #d4a750; }

  /* Callout boxes */
  .callout {
    margin: 5pt 0;
    padding: 6px 8px;
    border-radius: 2px;
    page-break-inside: avoid;
    font-size: 8.4pt;
    line-height: 1.34;
  }

  .callout-title {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 8pt;
    font-weight: bold;
    letter-spacing: 0.05em;
    margin-bottom: 3px;
  }

  .gotcha {
    background: #fbf7f2;
    border: 1px solid #d8b89e;
    border-left: 4px solid #b8574a;
  }
  .gotcha .callout-title { color: #9c3325; }

  .warstory {
    background: #f7f9f2;
    border: 1px solid #ccd6b6;
    border-left: 4px solid #5a7322;
  }
  .warstory .callout-title { color: #435914; }

  .specbox {
    background: #f4f6f8;
    border: 1px solid #b8c4d1;
    border-left: 4px solid #3b6285;
  }
  .specbox .callout-title { color: #234768; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 4pt 0 6pt 0;
    font-size: 7.8pt;
    page-break-inside: avoid;
  }

  th {
    background: #283018;
    color: #edf2dc;
    font-family: "Courier New", Courier, monospace;
    font-size: 7.4pt;
    letter-spacing: 0.05em;
    padding: 3px 5px;
    border: 1px solid #1a2010;
    text-align: left;
  }

  td {
    padding: 3px 5px;
    border: 1px solid #d3d9c7;
    vertical-align: top;
  }

  tr:nth-child(even) td {
    background: #f7f9f3;
  }

  .diag {
    font-family: "Courier New", Courier, monospace;
    font-size: 6.9pt;
    line-height: 1.12;
    background: #141710;
    color: #9bb060;
    padding: 6px;
    border: 1px solid #283018;
    margin: 4pt 0;
    white-space: pre;
    page-break-inside: avoid;
  }
</style>
</head>
<body>

<!-- Cover page -->
<div class="cover-page">
  <div class="cover-border">
    <div>
      <div class="cover-top-tag">Refractor 2 technical documentation</div>
      <div class="cover-title-group">
        <div class="cover-title">Dissecting Refractor</div>
        <div class="cover-subtitle">Asset storage in Battlefield 1942 and transformation for web rendering</div>
        <div class="cover-badge">DirectX 8, LZO1X, glTF 2.0, Three.js</div>
      </div>
      <div class="cover-ascii">
+-------------------------------------------------------------------------+
| [RFA ARCHIVES] ===(LZO1X)===> [.CON SCRIPT TREES] ===(SCENE HIERARCHY)  |
|                                     |                                   |
| [STANDARDMESH .SM] <====(.RS)=======+=====(.SKN / .SKE)====> [RIGGING]  |
|         |                                                        |      |
|   (STRIDE 32 / 40)   [Z-MIRROR CONJUGATION: R->SRS]          (BAF QUATS)|
|         |                                                        |      |
|         v                                                        v      |
| [glTF / BINARY GLB] =========> [WEBGL / THREE.JS] <====(sRGB MOD-2X)==  |
+-------------------------------------------------------------------------+</div>
    </div>
    <div>
      <p style="font-size: 8.5pt; color: #a4ab93; margin-bottom: 12px; line-height: 1.4;">
        A technical manual for developers. This document explains the binary asset formats used
        by the Refractor 2 engine in Battlefield 1942, identifies the parsing rules required to read
        them, and describes the pipeline that converts those assets into binary glTF files for
        rendering in web browsers.
      </p>
      <div class="cover-footer">
        <span>Skandia Research</span>
        <span>bfstats documentation</span>
      </div>
    </div>
  </div>
</div>

<!-- Introduction -->
<div style="page-break-after: always; padding-top: 4mm;">
  <h1>System architecture and asset structure</h1>
  <p>
    Battlefield 1942 was released in September 2002 using the Refractor 2 engine. The engine relied on
    DirectX 8 fixed-function graphics pipelines, flat compressed archives, imperative console scripts,
    binary geometry files with fixed vertex strides, and hierarchical skeletal animations.
  </p>
  <p>
    Standard 3D software packages cannot open these files directly. Mesh files contain vertex buffers but
    no texture references. Weapon and soldier skeletons use mirrored coordinate frames along the Z axis.
    Animation clips store quaternion tracks with row-vector conventions and a 180-degree yaw offset.
    Terrain tiles contain baked sunlight, so standard WebGL scene lighting produces dark surfaces.
  </p>
  <p>
    This guide explains the file formats used by the engine, outlines the failure modes encountered when
    parsing them, and details the extraction pipeline built in <code>tools/bf1942-models/</code> to
    convert these assets into binary glTF for Three.js.
  </p>

  <div class="callout warstory">
    <div class="callout-title">Analysis rule: Measure before decompiling</div>
    When an extracted asset renders incorrectly, inspect multiple files across the dataset before
    reading engine binaries in Ghidra. Write a Python script to scan the 33,000 meshes across vanilla
    and mod archives. Most discrepancies stem from coordinate system mismatches or mod-specific authoring
    variations.
  </div>

  <h2>Pipeline overview from archive to WebGL</h2>
  <div class="diag">
1. ARCHIVES (.rfa)      Unpack data payloads using LZO1X segment decompression.
2. OBJECT SCRIPTS (.con) Execute command streams to construct the parent-child scene graph.
3. GEOMETRY (.sm)       Read 16-bit indices, bounding boxes, collision hulls, and vertex strides.
4. SHADERS (.rs)        Match mesh material names to texture stages and alpha test flags.
5. TEXTURES (.dds/.tga) Decode DXT1, DXT3, DXT5, and BGRA rasters; bleed edges to prevent halos.
6. SKELETONS (.ske/.skn)Conjugate Z-mirrored bone matrices; align detached hand meshes to forearms.
7. ANIMATION (.baf)     Decode 7-channel fixed-point RLE tracks; conjugate quaternions; yaw root 180°.
8. EXPORT (glTF / .glb) Convert Refractor left-handed coordinates to WebGL right-handed coordinates.
9. BROWSER (Three.js)   Render with unlit materials, sRGB modulate-2x detail shaders, and Web Audio.</div>

  <h2>The asset resolution contract</h2>
  <p>
    In Battlefield 1942, an asset is not a single file. An object definition relies on
    interdependent files spread across distinct archive directories:
  </p>
  <div class="diag">
+---------------------+     +-----------------------+     +------------------------+
| Objects.con         | --> | Geometries.con        | --> | StandardMesh/*.sm      |
| (Tree & Hierarchy)  |     | (Template Indirection)|     | (Indexed Triangles)    |
+---------------------+     +-----------------------+     +------------------------+
                                                                      |
+---------------------+     +-----------------------+                 v
| Textures (*.dds)    | <-- | RenderShader (*.rs)   | <---------------+
| (DXT1/3/5 Pixels)   |     | (Material Shaders)    |
+---------------------+     +-----------------------+</div>
  <ol>
    <li><code>Objects.con</code> defines the object hierarchy, such as a tank hull parenting a turret, which parents a gun barrel.</li>
    <li><code>Geometries.con</code> resolves geometry aliases, mapping template names to geometry files.</li>
    <li><code>*.sm</code> stores vertex coordinates, surface normals, texture coordinates, and material slot names.</li>
    <li><code>*.rs</code> (RenderShader) matches material slot names to texture filenames.</li>
    <li><code>*.dds</code> and <code>*.tga</code> store the compressed or raw image rasters.</li>
  </ol>
</div>

<!-- Part 1: How Battlefield 1942 stores assets -->
<!-- Chapter 1: Archives and scripts -->
<div class="chapter-header">
  <div class="chapter-num">Part 1 &bull; Chapter 1</div>
  <h1>Archives and scripts</h1>
</div>

<p>
  All game assets reside within Refractor flat archives (<code>.rfa</code>). The format combines a
  header, a data payload, and an index table stored at the end of the file.
</p>

<table>
  <tr>
    <th style="width: 22%;">Offset or field</th>
    <th style="width: 18%;">Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>0x00</code> Header</td>
    <td><code>char[28]</code></td>
    <td>Magic string: <code>Refractor2 FlatArchive 1.1  </code>. When absent, base offset is zero.</td>
  </tr>
  <tr>
    <td><code>data_size</code></td>
    <td><code>uint32</code></td>
    <td>Length of the payload block in bytes.</td>
  </tr>
  <tr>
    <td><code>compressed</code></td>
    <td><code>uint32</code></td>
    <td>Payload compression flag (1 for compressed, 0 for raw).</td>
  </tr>
  <tr>
    <td><code>index_table</code></td>
    <td>Appended at EOF</td>
    <td>Located at <code>base_offset + data_size</code>. Contains entry count and directory records.</td>
  </tr>
</table>

<h2>Entry tables and LZO1X segment decompression</h2>
<p>
  The index table at <code>base_offset + data_size</code> begins with a 32-bit unsigned integer
  recording the entry count. Variable-length entry records follow. Each record contains the path length,
  the path string, compressed size, uncompressed size, and data offset:
</p>
<pre><span class="kw">def</span> <span class="typ">read_entries</span>(data: bytes, base_offset: int, data_size: int):
    pos = base_offset + data_size
    entry_count, = struct.unpack_from(<span class="str">"&lt;I"</span>, data, pos)
    pos += <span class="num">4</span>
    entries = {}
    <span class="kw">for</span> _ <span class="kw">in</span> range(entry_count):
        name_len, = struct.unpack_from(<span class="str">"&lt;I"</span>, data, pos)
        name = data[pos+<span class="num">4</span> : pos+<span class="num">4</span>+name_len].decode(<span class="str">"latin-1"</span>).replace(<span class="str">"\\\\"</span>, <span class="str">"/"</span>)
        comp_size, uncomp_size, offset = struct.unpack_from(<span class="str">"&lt;III"</span>, data, pos+<span class="num">4</span>+name_len)
        pos += <span class="num">4</span> + name_len + <span class="num">12</span> + <span class="num">12</span>  <span class="com"># 12 bytes metadata plus 12 reserved bytes</span>
        entries[name.lower()] = (offset, comp_size, uncomp_size)
    <span class="kw">return</span> entries</pre>
<p>
  Compressed entries use the LZO1X algorithm. A compressed entry does not decompress in a single call.
  It begins with a 32-bit segment count, followed by descriptors for each segment:
</p>
<pre><span class="kw">import</span> ctypes
_lzo = ctypes.CDLL(<span class="str">"liblzo2.so.2"</span>)

<span class="kw">def</span> <span class="typ">decompress_entry</span>(raw_entry_data: bytes, uncompressed_size: int) -> bytes:
    segments_count, = struct.unpack_from(<span class="str">"&lt;I"</span>, raw_entry_data, <span class="num">0</span>)
    pos = <span class="num">4</span>
    out_buf = ctypes.create_string_buffer(uncompressed_size)
    out_offset = <span class="num">0</span>
    <span class="kw">for</span> _ <span class="kw">in</span> range(segments_count):
        seg_csize, seg_usize, seg_offset = struct.unpack_from(<span class="str">"&lt;III"</span>, raw_entry_data, pos)
        pos += <span class="num">12</span>
        chunk = raw_entry_data[seg_offset : seg_offset + seg_csize]
        written = ctypes.c_ulong(seg_usize)
        _lzo.lzo1x_decompress(chunk, seg_csize,
                              ctypes.byref(out_buf, out_offset), ctypes.byref(written), <span class="kw">None</span>)
        out_offset += seg_usize
    <span class="kw">return</span> bytes(out_buf)</pre>

<h2>Mod search paths and case sensitivity</h2>
<p>
  Refractor mods declare parent search paths in their <code>init.con</code> scripts using
  <code>game.addModPath</code>:
</p>
<pre><span class="typ">game.addModPath</span> Mods/FHSW/
<span class="typ">game.addModPath</span> Mods/FH/
<span class="typ">game.addModPath</span> Mods/Bf1942/</pre>
<p>
  The asset resolver checks the nearest child first and falls back to parents. Level archives also
  require underlaying. A mod level archive often supplies only vehicle spawns, relying on the base game
  level archive for terrain heightmaps, textures, and capture flags.
</p>

<div class="callout gotcha">
  <div class="callout-title">File system difference: Linux case sensitivity</div>
  Battlefield 1942 was developed on Windows, where paths are case-insensitive. Total conversion mods
  use mixed casing, such as <code>GCMOD/Archives</code>, <code>EoD/archives</code>, and
  <code>interstate/archives</code>. A direct path lookup on Linux fails when cases differ. The extractor
  scans directory entries with lowercase comparisons:
  <pre style="margin: 3px 0 0 0;"><span class="kw">def</span> <span class="typ">find_archives</span>(p): <span class="kw">return</span> next((c <span class="kw">for</span> c <span class="kw">in</span> p.iterdir() <span class="kw">if</span> c.name.lower() == <span class="str">"archives"</span>), <span class="kw">None</span>)</pre>
</div>

<h2>Stateful console scripts and child scoping</h2>
<p>
  Game scripts use the <code>.con</code> extension. The engine processes these files as sequential
  command streams. It tracks an active template context as commands run:
</p>
<pre><span class="kw">ObjectTemplate.create</span> Bundle ShermanComplex
<span class="kw">ObjectTemplate.geometry</span> Sherman_Hull_M1
<span class="kw">ObjectTemplate.addTemplate</span> ShermanTower
<span class="kw">ObjectTemplate.setPosition</span> <span class="num">0</span>/<span class="num">-0.8</span>/<span class="num">0</span></pre>

<div class="callout gotcha">
  <div class="callout-title">Scoping rule: Child instance transforms</div>
  In Refractor syntax, <code>setPosition</code> and <code>setRotation</code> calls placed after an
  <code>addTemplate</code> invocation apply to the child template just added, not to the parent bundle.
  Before any <code>addTemplate</code> line, position and rotation configure the parent. If a parser
  assigns position to the enclosing parent template, every child part collapses to the origin, causing
  turrets and wheels to render at the center of the vehicle hull.
</div>

<h2>Vehicle inputs and accumulator spans</h2>
<p>
  Movable vehicle parts connect to player inputs using <code>setInputToYaw</code>,
  <code>setInputToPitch</code>, and <code>setInputToRoll</code>. The script declares input indices
  or symbolic names. The declared angular span indicates whether a part spins continuously or holds
  a pose:
</p>
<ul>
  <li>Large spans (such as 2250 to 15000 degrees) identify continuous accumulators, including aircraft propellers, helicopter rotors, and wheels.</li>
  <li>Small spans (such as 2.0 degrees) identify deflection bounds, including chassis roll during acceleration and steering.</li>
</ul>

<div class="callout gotcha">
  <div class="callout-title">Animation rule: Distinguishing continuous rotation from chassis lean</div>
  If an extractor treats every template of type <code>Engine</code> as a continuous spin, the chassis
  lean angle is integrated continuously over time. Because suspension components and wheels are children
  of the engine template, the running gear rotates around the tank hull. Setting an accumulator
  threshold at 360.0 degrees prevents this defect: values below 360.0 degrees are clamped poses rather
  than continuous rotation rates.
</div>

<!-- Chapter 2: Meshes, materials, and textures -->
<div class="chapter-header">
  <div class="chapter-num">Part 1 &bull; Chapter 2</div>
  <h1>Meshes, materials, and textures</h1>
</div>

<p>
  Rigid geometry is stored in StandardMesh files (<code>.sm</code>). The format contains a fixed header,
  collision hulls, and an array of Level of Detail (LOD) representations.
</p>

<table>
  <tr>
    <th>Byte offset</th>
    <th>Type</th>
    <th>Field</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>0x00</code></td>
    <td><code>uint32</code></td>
    <td><code>version</code></td>
    <td>Format version: 9 or 10.</td>
  </tr>
  <tr>
    <td><code>0x04</code></td>
    <td><code>uint32</code></td>
    <td><code>reserved</code></td>
    <td>Zero.</td>
  </tr>
  <tr>
    <td><code>0x08 to 0x1F</code></td>
    <td><code>float[6]</code></td>
    <td><code>boundsMinMax</code></td>
    <td>Axis-aligned bounding box coordinates.</td>
  </tr>
  <tr>
    <td><code>0x20</code></td>
    <td><code>uint8</code></td>
    <td><code>qflag</code></td>
    <td>Present only when <code>version &gt; 9</code>.</td>
  </tr>
  <tr>
    <td>Variable</td>
    <td><code>uint32</code></td>
    <td><code>colCount</code></td>
    <td>Count of collision hulls embedded in the file.</td>
  </tr>
  <tr>
    <td>Variable</td>
    <td><code>uint32</code></td>
    <td><code>lodCount</code></td>
    <td>LOD chain depth (1 for handheld items, up to 6 for vehicles).</td>
  </tr>
</table>

<h2>Material descriptors and vertex strides</h2>
<p>
  Within each LOD block, material descriptors are grouped together before the binary vertex and index
  buffers:
</p>
<div class="diag">
[LOD Header] -> [Mat 0 Desc] -> [Mat 1 Desc] -> [Mat 0 Verts] -> [Mat 0 Indices] -> [Mat 1 Verts] -> [Mat 1 Indices]</div>
<p>
  All material descriptors appear first. Vertex and index payloads follow in the same sequence.
</p>
<pre><span class="com"># Material descriptor layout</span>
name_len, = struct.unpack_from(<span class="str">"&lt;I"</span>, data, pos)
name = data[pos+<span class="num">4</span> : pos+<span class="num">4</span>+name_len].decode(<span class="str">"latin-1"</span>)
pos += <span class="num">4</span> + name_len
u0, u1, u2, prim, flags, stride, vcount, icount, u3 = struct.unpack_from(<span class="str">"&lt;9I"</span>, data, pos)
pos += <span class="num">36</span></pre>
<p>
  Refractor uses two vertex layouts:
</p>
<ul>
  <li><strong>Stride 32 bytes</strong> (Standard): Position (3 floats), Normal (3 floats), and Texture UV (2 floats).</li>
  <li><strong>Stride 40 bytes</strong> (Static lightmapped): Position (3 floats), Normal (3 floats), Texture UV0 (2 floats), and Lightmap UV1 (2 floats).</li>
</ul>

<h2>Index buffers and primitive types</h2>
<p>
  DirectX 8 index buffers in Refractor use unsigned 16-bit integers. Meshes support two primitive types:
</p>
<ul>
  <li><code>primitive == 4</code>: Triangle List. Every three indices form one triangle.</li>
  <li><code>primitive == 5</code>: Triangle Strip. Each additional index after the first two creates a triangle, alternating vertex order:
    <pre style="margin: 3px 0;"><span class="kw">for</span> i <span class="kw">in</span> range(len(idx) - <span class="num">2</span>):
    a, b, c = idx[i], idx[i+<span class="num">1</span>], idx[i+<span class="num">2</span>]
    <span class="kw">if</span> a != b <span class="kw">and</span> b != c <span class="kw">and</span> a != c:
        tris.append((a, c, b) <span class="kw">if</span> i % <span class="num">2</span> <span class="kw">else</span> (a, b, c))</pre>
  </li>
</ul>

<div class="callout gotcha">
  <div class="callout-title">Format rule: Unsigned index buffers</div>
  DirectX 8 index buffers use unsigned 16-bit integers (format <code>&lt;H</code>). If unpacked as
  signed 16-bit integers (format <code>&lt;h</code>), any mesh with more than 32,767 vertices produces
  negative index values. Large objects, such as battleships and industrial buildings, then render with
  stretched polygons connecting across distant coordinates.
</div>

<h2>RenderShader definitions and texture lookup</h2>
<p>
  Material names declared in the <code>.sm</code> file are matched to shader definitions in
  <code>StandardMesh/&lt;mesh&gt;.rs</code> or <code>Objects/.../Art/&lt;mesh&gt;.rs</code>:
</p>
<pre><span class="kw">subshader</span> <span class="str">"Sherman_Hull_M1_Material0"</span> <span class="str">"StandardMesh/Default"</span> {
    <span class="kw">texture</span> <span class="str">"texture/sherma_I"</span>;
    <span class="kw">alphaTest</span> <span class="num">0.5</span>;
    <span class="kw">twosided</span> <span class="typ">true</span>;
}</pre>
<p>
  Texture paths in shader scripts omit file extensions. The engine searches for a <code>.dds</code> file
  first, then falls back to <code>.tga</code>.
</p>

<h2>DDS block compression and alpha channels</h2>
<p>
  Textures use DirectDraw Surface compression formats:
</p>
<ul>
  <li><strong>DXT1:</strong> Blocks of 4x4 pixels with 1-bit alpha or opaque color punchthrough.</li>
  <li><strong>DXT3:</strong> Explicit 4-bit alpha channels, used for sharp transparency edges.</li>
  <li><strong>DXT5:</strong> Interpolated 8-step alpha ramps, used for gradients and smoke.</li>
</ul>

<!-- Chapter 3: Skeletons, skins, and animations -->
<div class="chapter-header">
  <div class="chapter-num">Part 1 &bull; Chapter 3</div>
  <h1>Skeletons, skins, and animations</h1>
</div>

<p>
  Vehicles use rigid node trees positioned through script offsets. Human soldiers and animated weapons
  use a three-part deformation system:
</p>
<div class="diag">
[1. .SKE (Armature)] =========> [2. .SKN (Skin Weights)] <==== [3. .SM (3D Geometry)]
         |                                     |
         v (Drives Joints)                     v (Deforms Vertices)
[4. .BAF (Animation Tracks)] =========> [FINAL POSED MODEL]</div>

<h2>Rest-pose skeletons (.ske)</h2>
<p>
  A <code>.ske</code> file defines the rest-pose bone hierarchy:
</p>
<pre><span class="typ">uint32</span> version (<span class="num">1</span>)
<span class="typ">uint32</span> boneCount
  per bone:
    <span class="typ">uint16</span> nameLen
    <span class="typ">char</span>   name[nameLen]
    <span class="typ">int16</span>  parentIndex (-1 for root)
    <span class="typ">float</span>  matrix[<span class="num">12</span>]  (Row-major 3x4: [R00 R01 R02 Tx, R10 R11 R12 Ty, R20 R21 R22 Tz])</pre>

<div class="callout gotcha">
  <div class="callout-title">Geometry rule: Skeleton coordinate reflection</div>
  A <code>.ske</code> file stores bones reflected across the Z axis relative to the <code>.sm</code>
  geometry it controls. In <code>UsSoldier.ske</code>, the head bone sits at z = -1.51 m, whereas the
  head mesh geometry sits at z = +1.56 to 1.87 m. Reading the skeleton without reflection places weapon
  magazines and bolt handles behind the weapon body.
</div>

<h2>Skin bindings (.skn)</h2>
<p>
  A <code>.skn</code> file assigns vertex weights to bones:
</p>
<pre><span class="typ">float</span> restPos[<span class="num">3</span>]
<span class="typ">uint8</span> influenceCount
  per influence:
    <span class="typ">uint16</span> boneIndex, <span class="typ">float</span> weight, <span class="typ">float</span> boneLocalOffset[<span class="num">3</span>]</pre>
<p>
  The bind pose satisfies: <code>rest = R_bone * offset + T_bone</code>.
</p>

<h2>Keyframed bone animation clips (.baf)</h2>
<p>
  Soldier animations blend a lower-body clip (such as <code>Lb_Stand</code>) with an upper-body clip
  (such as <code>3PStandAimUpperThompson.baf</code>).
</p>

<table>
  <tr>
    <th>Header field</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td><code>uint32</code></td>
    <td>Always 3 in vanilla archives.</td>
  </tr>
  <tr>
    <td><code>boneCount</code></td>
    <td><code>uint16</code></td>
    <td>Count of animated bones.</td>
  </tr>
  <tr>
    <td><code>frameCount</code></td>
    <td><code>uint32</code></td>
    <td>Frame count of the animation.</td>
  </tr>
  <tr>
    <td><code>precision</code></td>
    <td><code>uint8</code></td>
    <td>Fractional bits for position channels only.</td>
  </tr>
</table>

<p>
  Each bone stores seven channels: Quaternion (x, y, z, w) followed by Position (x, y, z).
  Channels are stored as 16-bit signed fixed-point integers compressed with run-length encoding:
</p>
<ul>
  <li><code>control &amp; 0x80</code>: Hold run. Read one value and repeat it for <code>control &amp; 0x7F</code> frames.</li>
  <li>Else: Literal run. Read <code>control &amp; 0x7F</code> distinct values.</li>
</ul>

<div class="callout gotcha">
  <div class="callout-title">Decompression rule: Position and quaternion precision</div>
  The header byte <code>precision</code> indicates the fractional bit count for position values:
  <code>pos = val / (2^precision)</code>. This scaling factor does not apply to quaternions. Quaternions
  consistently use 1.15 fixed-point format: <code>quat = val / 32768.0</code>. Applying the position
  scaling factor to quaternions corrupts rotations when precision drops below 15.
</div>

<h2>The animation state machine (AnimationStates.con)</h2>
<p>
  Weapon templates do not reference animation clips directly. The engine resolves clips by replaying
  <code>animations/AnimationStates.con</code>:
</p>
<ul>
  <li><code>copyState2</code> commands replace generic weapon placeholders with weapon names.</li>
  <li><code>copyState</code> commands assign fallback clips: the K98 uses the British Lee-Enfield No. 4 aim clip; the Panzerschreck uses the Bazooka clip; the Walther P38 uses the Colt 1911 clip.</li>
  <li>Weapon skeletons root at a bone named <code>Bip01 R Hand</code>, attaching directly to the soldier skeleton hand bone.</li>
</ul>

<!-- Chapter 4: Terrains, lighting, and audio -->
<div class="chapter-header">
  <div class="chapter-num">Part 1 &bull; Chapter 4</div>
  <h1>Terrains, lighting, and audio</h1>
</div>

<h2>Elevation grids and pre-lit terrain tiles</h2>
<p>
  Terrains in Battlefield 1942 are defined by two data sources:
</p>
<ul>
  <li><code>Heightmap.raw</code>: 16-bit unsigned elevation samples on a 4-meter grid:
    <code>elevation = (sample / 65535) * 256 * yScale</code>.
  </li>
  <li><code>Tx*.dds</code>: 256-meter square terrain color tiles.</li>
</ul>

<div class="callout warstory">
  <div class="callout-title">Lighting rule: Pre-calculated terrain illumination</div>
  The level editor pre-calculated sunlight, ambient color, and building cast shadows directly into
  the pixels of the terrain tiles. The original game rendered terrain without dynamic directional
  lights. Adding standard WebGL directional and hemisphere lights produces duplicate lighting,
  causing terrain to appear over-darkened and discolored.
</div>

<h2>Static mesh lightmaps</h2>
<p>
  Structures, bridges, and bunkers use Stride 40 vertices containing a secondary UV channel (<code>uv1</code>)
  mapped to pre-calculated lightmap images (such as <code>radarbun_m1_406-75-761.png</code>). These textures
  store direct sunlight and shadow values, which the engine multiplies by the diffuse texture at runtime.
</p>

<h2>Sound scripts and polyline area sounds</h2>
<p>
  Audio files are stored in <code>Sound.rfa</code> and level archives as uncompressed 16-bit PCM WAV
  files. Playback rules are defined in Sound Script Configuration (<code>.ssc</code>) files:
</p>
<pre><span class="kw">newPatch</span>
<span class="kw">load</span> @ROOT/Sound/@RT/Water_waves.wav
<span class="kw">loop</span>
<span class="kw">minDistance</span> <span class="num">10.0</span>
<span class="kw">maxDistance</span> <span class="num">150.0</span>
<span class="kw">volume</span> <span class="num">0.8</span>
<span class="kw">priority</span> <span class="num">5</span></pre>
<p>
  Levels define ambient loops in <code>Sounds/Environment.con</code> and shoreline audio as polylines
  tracing the water boundary. Sound emanates from the point on the polyline closest to the camera.
</p>

<!-- Part 2: Transforming assets for web rendering -->
<!-- Chapter 5: glTF generation and coordinate conversion -->
<div class="chapter-header">
  <div class="chapter-num">Part 2 &bull; Chapter 5</div>
  <h1>glTF generation and coordinate conversion</h1>
</div>

<p>
  To render Refractor assets in web browsers, the pipeline in <code>tools/bf1942-models/</code> extracts
  geometry, transforms coordinate spaces, and compiles assets into binary glTF 2.0 (<code>.glb</code>)
  files.
</p>

<h2>Extraction pipeline modules</h2>
<p>
  The extraction tools are structured as focused modules:
</p>
<ul>
  <li><code>rfa.py</code>: Reads archives, caches index tables, and performs LZO1X decompression.</li>
  <li><code>con.py</code>: Parses script syntax and tracks template trees.</li>
  <li><code>stdmesh.py</code>: Reads vertex records, material descriptors, and index buffers.</li>
  <li><code>rs.py</code>: Parses shader scripts to map material slots to texture names.</li>
  <li><code>gltf.py</code>: Constructs binary glTF containers with vertex buffers and accessors.</li>
  <li><code>assemble.py</code>: Traverses template hierarchies and builds complete vehicle models.</li>
  <li><code>pose.py</code>: Assembles soldier skeletons, skins, and weapon attachments.</li>
  <li><code>level.py</code> and <code>terrain.py</code>: Extract terrain meshes and place map objects.</li>
</ul>

<h2>Coordinate system handedness conversion</h2>
<p>
  Refractor uses a left-handed coordinate system (+X right, +Y up, +Z forward).
  glTF and WebGL use a right-handed coordinate system (+X right, +Y up, -Z forward).
</p>
<p>
  Applying a negative scale on the root node inverts polygon winding, corrupts surface normal vectors,
  and breaks back-face culling. The pipeline bakes coordinate transformation into the vertex buffers:
</p>
<pre><span class="com"># Coordinate conversion in gltf.py</span>
positions = [(x, y, -z) <span class="kw">for</span> (x, y, z) <span class="kw">in</span> sm.positions]
normals   = [(nx, ny, -nz) <span class="kw">for</span> (nx, ny, nz) <span class="kw">in</span> sm.normals]
indices   = [idx <span class="kw">for</span> i <span class="kw">in</span> range(<span class="num">0</span>, len(raw_indices), <span class="num">3</span>)
                 <span class="kw">for</span> idx <span class="kw">in</span> (raw_indices[i], raw_indices[i+<span class="num">2</span>], raw_indices[i+<span class="num">1</span>])] <span class="com"># Reverse winding</span></pre>
<p>
  For vehicle Euler rotations (Yaw, Pitch, Roll): <code>R = Ry(-yaw) * Rx(-pitch) * Rz(roll)</code>.
  Inverting the Z axis reverses the direction of rotations around X and Y while preserving Z rotation.
</p>

<h2>Assembling binary glTF containers</h2>
<p>
  When exporting to glTF 2.0:
</p>
<ul>
  <li><strong>Sub-mesh primitives:</strong> An <code>.sm</code> part with multiple materials is mapped to a single glTF node containing multiple primitives. Each primitive references its own material definition and index slice.</li>
  <li><strong>Collision geometry isolation:</strong> Collision hulls from the <code>.sm</code> file are omitted from the visible render tree and stored in <code>mesh.extras.collision</code> to prevent collision shapes from drawing over the vehicle body.</li>
</ul>

<h2>Texture export and alpha dilation</h2>
<p>
  Textures are decoded from DXT rasters and exported as PNG or WebP images.
</p>
<p>
  Cutout textures, such as foliage, wire fences, and tank tracks, frequently store zero values
  (black) in transparent pixels. When Three.js applies bilinear interpolation at the boundary between
  opaque and transparent pixels, the black color bleeds into the edge, creating a dark outline.
</p>
<p>
  The exporter runs an alpha dilation pass: for any pixel with an alpha value of 16 or lower, it copies
  the RGB values from the nearest opaque neighbor. This eliminates dark halos around cutout boundaries.
</p>

<!-- Chapter 6: Rigging and animation in the browser -->
<div class="chapter-header">
  <div class="chapter-num">Part 2 &bull; Chapter 6</div>
  <h1>Rigging and animation in the browser</h1>
</div>

<h2>Skeleton rest matrix Z-mirror conjugation</h2>
<p>
  Because skeletons in <code>.ske</code> files are mirrored along the Z axis relative to mesh geometry,
  the exporter conjugates rotation matrices and translations using reflection matrix
  <code>S = diag(1, 1, -1)</code>:
</p>
<pre><span class="kw">def</span> <span class="typ">conjugate_ske</span>(rot, trans):
    rot_c = (( rot[<span class="num">0</span>][<span class="num">0</span>],  rot[<span class="num">0</span>][<span class="num">1</span>], -rot[<span class="num">0</span>][<span class="num">2</span>]),
             ( rot[<span class="num">1</span>][<span class="num">0</span>],  rot[<span class="num">1</span>][<span class="num">1</span>], -rot[<span class="num">1</span>][<span class="num">2</span>]),
             (-rot[<span class="num">2</span>][<span class="num">0</span>], -rot[<span class="num">2</span>][<span class="num">1</span>],  rot[<span class="num">2</span>][<span class="num">2</span>]))
    trans_c = (trans[<span class="num">0</span>], trans[<span class="num">1</span>], -trans[<span class="num">2</span>])
    <span class="kw">return</span> rot_c, trans_c</pre>
<p>
  This transformation aligns skeleton joint positions with the mesh coordinate frame.
</p>

<h2>Quaternion conjugation and root bone yaw</h2>
<p>
  Animation clips require two adjustments before playback in WebGL:
</p>
<ol>
  <li><strong>Quaternion conjugation:</strong> Refractor stores row-vector quaternions. To convert to standard column-vector matrices, the exporter conjugates each quaternion: <code>(x, y, z, w) &rarr; (-x, -y, -z, w)</code>.</li>
  <li><strong>Root joint yaw:</strong> The clip coordinate space is rotated 180 degrees around Y relative to mesh world space. The root bone transform is pre-multiplied by <code>Ry(180) = diag(-1, 1, -1)</code>.</li>
</ol>

<h2>Aligning detached hand meshes</h2>
<p>
  Soldier models use separate meshes for the body, head, and hands. The body and head share an origin,
  but hand meshes were exported in separate coordinate frames.
</p>
<p>
  Both the body and hand meshes share the forearm bone. The pipeline finds vertices with a weight of 1.0
  on the forearm bone in both meshes, calculates the rigid coordinate offset between the two frames,
  and transforms the hand vertices to connect with the sleeve.
</p>

<h2>Stance crossfading and action bundling</h2>
<p>
  Rather than writing separate files for each posture, <code>pose.py</code> packages standing,
  crouching, and prone stances into a single <code>.glb</code> file as single-frame animation actions:
</p>
<ul>
  <li><code>stand</code>: Upper-body aim clip combined with <code>Lb_Stand</code>.</li>
  <li><code>crouch</code>: Upper-body aim clip combined with <code>Lb_Crouch</code>.</li>
  <li><code>lie</code>: Upper-body aim clip combined with <code>Lb_Lie</code>.</li>
</ul>
<p>
  The browser uses Three.js <code>AnimationMixer</code> to crossfade between stances over 0.25 seconds,
  producing continuous posture transitions without joint discontinuities.
</p>

<!-- Chapter 7: Three.js browser reconstruction -->
<div class="chapter-header">
  <div class="chapter-num">Part 2 &bull; Chapter 7</div>
  <h1>Three.js browser reconstruction</h1>
</div>

<h2>Unlit terrain shading</h2>
<p>
  Because terrain tiles already contain baked illumination and shadows, terrain meshes use
  <code>MeshBasicMaterial</code> in Three.js without scene light calculations. This preserves the
  original color balance without double lighting.
</p>

<h2>The sRGB modulate-2x detail shader</h2>
<p>
  Refractor blends a repeating 512-pixel detail texture across each terrain tile using the formula:
  <code>FinalColor = clamp(2.0 * TileColor * DetailColor, 0.0, 1.0)</code>.
  Neutral gray (128, 128, 128) leaves the surface unchanged.
</p>

<div class="callout gotcha">
  <div class="callout-title">Color space rule: Modulate-2x detail calculation</div>
  Modern WebGL applies linear color space conversions to textures. In linear space, neutral gray 0.5
  becomes approximately 0.218. Multiplying by 2.0 yields 0.43 instead of 1.0, making the terrain
  2.3 times darker than intended. The viewer sets <code>detailTex.colorSpace = THREE.NoColorSpace</code>
  and performs the calculation in sRGB space through an <code>onBeforeCompile</code> GLSL hook:
  <pre style="margin: 4px 0 0 0;"><span class="com">// Three.js onBeforeCompile fragment hook</span>
diffuseColor.rgb = bfFromSrgb( min( vec3(<span class="num">1.0</span>),
    <span class="num">2.0</span> * bfToSrgb( diffuseColor.rgb ) * texture2D( tDetail, vMapUv * detailRepeats ).rgb ) );</pre>
</div>

<h2>Lightmap sampling and ambient floor injection</h2>
<p>
  Static buildings sample lightmap atlases using their second UV channel.
</p>

<div class="callout gotcha">
  <div class="callout-title">Texture rule: Lightmap coordinate orientation</div>
  glTF images load with <code>flipY = false</code>, whereas <code>THREE.TextureLoader</code> defaults
  to <code>flipY = true</code>. Sampling an inverted lightmap projects roof shadows onto interior floors.
  Setting <code>lightmap.flipY = false</code> aligns the lightmap coordinates with the mesh geometry.
</div>

<p>
  The material fragment shader applies the level's ambient light floor to keep shadowed surfaces
  visible:
</p>
<pre><span class="com">// Patched fragment shader for static lightmaps</span>
vec3 lmTexel = texture2D( lightMap, vLightMapUv ).rgb;
reflectedLight.indirectDiffuse += diffuseColor.rgb * max( lmTexel * <span class="num">2.0</span>, ambientFloor );</pre>

<h2>Interactive vehicle controls and projectile ballistics</h2>
<p>
  In the viewer, vehicle parts react to user controls:
</p>
<ul>
  <li>Rotational parts with spans above 360 degrees update continuously using their rotational speed.</li>
  <li>Parts with small spans clamp to their authored deflection limits.</li>
  <li>Recoil offsets move gun barrels backward along their local Z axis upon firing.</li>
  <li>Muzzle smoke particles drift backward along the barrel using authored drift velocities.</li>
  <li>Weapons spawn typed projectiles: kinetic bullets draw tracer lines; artillery shells and rockets render 3D meshes with gravity drop and acceleration.</li>
</ul>

<!-- Chapter 8: Spatial audio in the browser -->
<div class="chapter-header">
  <div class="chapter-num">Part 2 &bull; Chapter 8</div>
  <h1>Spatial audio in the browser</h1>
</div>

<p>
  Level audio is spatialized using the Web Audio API with <code>AudioContext</code> and
  <code>PannerNode</code> (HRTF model).
</p>

<h2>Looping voice deduplication</h2>
<p>
  Levels often define multiple shoreline polylines that reference the same audio file, such as
  <code>Water_waves.wav</code>.
</p>

<div class="callout warstory">
  <div class="callout-title">Audio rule: Looping voice deduplication</div>
  When multiple polylines each play an independent audio stream, small differences in decoding time
  cause streams to play out of phase. Playing identical audio streams 100 milliseconds apart through
  HRTF panners causes acoustic comb filtering and phase cancellation. The viewer resolves this by
  running one looping audio voice per unique WAV file, updating its coordinates to the point on any
  active polyline nearest to the camera.
</div>

<h2>Custom distance attenuation curves</h2>
<p>
  The Web Audio <code>PannerNode</code> applies an inverse distance model by default.
</p>

<div class="callout gotcha">
  <div class="callout-title">Audio rule: Distance attenuation curves</div>
  Combining default Web Audio distance attenuation with the linear volume curves from <code>.ssc</code>
  scripts attenuates sound twice, cutting off shoreline audio near the water boundary. Calling
  <code>panner.setRolloffFactor(0)</code> disables Web Audio automatic dropoff, allowing the game's
  authored <code>minDistance</code> and <code>maxDistance</code> thresholds to govern attenuation
  directly.
</div>

<!-- Part 3: Reference specifications and triage -->
<div class="chapter-header">
  <div class="chapter-num">Part 3 &bull; Chapter 9</div>
  <h1>Reference specifications</h1>
</div>

<h2>File formats and magic bytes</h2>
<table>
  <tr>
    <th>Extension</th>
    <th>Domain</th>
    <th>Identifier or format</th>
    <th>Parsing rule</th>
  </tr>
  <tr>
    <td><code>.rfa</code></td>
    <td>Archive</td>
    <td><code>Refractor2 FlatArchive 1.1  </code></td>
    <td>Index table at EOF; LZO1X segment decompression.</td>
  </tr>
  <tr>
    <td><code>.sm</code></td>
    <td>Geometry</td>
    <td>Version 9 or 10</td>
    <td>Descriptors precede buffers; unsigned 16-bit indices.</td>
  </tr>
  <tr>
    <td><code>.rs</code></td>
    <td>Shader</td>
    <td>ASCII script</td>
    <td>Maps material slot names to texture paths.</td>
  </tr>
  <tr>
    <td><code>.ske</code></td>
    <td>Skeleton</td>
    <td>Version 1</td>
    <td>3x4 rest matrices; conjugate with S = diag(1, 1, -1).</td>
  </tr>
  <tr>
    <td><code>.skn</code></td>
    <td>Skin</td>
    <td>Version 1</td>
    <td>Vertex positions, bone indices, and local offsets.</td>
  </tr>
  <tr>
    <td><code>.baf</code></td>
    <td>Animation</td>
    <td>Version 3</td>
    <td>7-channel RLE; conjugate quaternions; yaw root 180°.</td>
  </tr>
  <tr>
    <td><code>.con</code></td>
    <td>Script</td>
    <td>ASCII script</td>
    <td><code>setPosition</code> applies to preceding child template.</td>
  </tr>
  <tr>
    <td><code>.ssc</code></td>
    <td>Audio</td>
    <td>ASCII script</td>
    <td>Distance thresholds, loop flags, and sample links.</td>
  </tr>
</table>

<h2>Coordinate transformation reference</h2>
<table>
  <tr>
    <th>Coordinate space</th>
    <th>Handedness</th>
    <th>Axis orientation</th>
    <th>Conversion to WebGL glTF</th>
  </tr>
  <tr>
    <td>Refractor engine</td>
    <td>Left-handed</td>
    <td>+X Right, +Y Up, +Z Forward</td>
    <td>Invert Z axis; reverse triangle winding order.</td>
  </tr>
  <tr>
    <td>glTF 2.0 / WebGL</td>
    <td>Right-handed</td>
    <td>+X Right, +Y Up, -Z Forward</td>
    <td>Target coordinate system.</td>
  </tr>
  <tr>
    <td>Refractor skeleton (.ske)</td>
    <td>Mirrored left</td>
    <td>+X Right, +Y Up, -Z Forward</td>
    <td>Conjugate: R' = S*R*S, t' = S*t with S = diag(1, 1, -1).</td>
  </tr>
  <tr>
    <td>Refractor animation (.baf)</td>
    <td>Yawed left</td>
    <td>+X Left, +Y Up, -Z Backward</td>
    <td>Conjugate quaternion: (-x, -y, -z, w); yaw root joint 180°.</td>
  </tr>
</table>

<h2>Defect triage checklist</h2>
<table>
  <tr>
    <th>Visual symptom</th>
    <th>Root cause</th>
    <th>Resolution</th>
  </tr>
  <tr>
    <td>Child part missing or positioned at origin</td>
    <td><code>setPosition</code> applied to parent template</td>
    <td>Assign transform to the preceding child instance.</td>
  </tr>
  <tr>
    <td>Tank suspension rotates around hull</td>
    <td>Chassis lean treated as continuous angular rate</td>
    <td>Apply 360-degree threshold to distinguish accumulators from poses.</td>
  </tr>
  <tr>
    <td>Stretched polygons on large meshes</td>
    <td>Index buffer unpacked as signed 16-bit integers</td>
    <td>Unpack index buffer using unsigned short format (&lt;H).</td>
  </tr>
  <tr>
    <td>Weapon parts positioned behind weapon body</td>
    <td>Skeleton rest matrix read without Z reflection</td>
    <td>Conjugate rotation and translation matrices with S = diag(1, 1, -1).</td>
  </tr>
  <tr>
    <td>Inverted soldier joint rotations</td>
    <td>Animation quaternion read without conjugation</td>
    <td>Conjugate quaternion: (-x, -y, -z, w).</td>
  </tr>
  <tr>
    <td>Terrain renders too dark</td>
    <td>Modulate-2x detail texture decoded in linear space</td>
    <td>Set NoColorSpace on detail map and compute in sRGB space.</td>
  </tr>
  <tr>
    <td>Roof shadows appear on interior floors</td>
    <td>Lightmap texture sampled with inverted V axis</td>
    <td>Set lightmap.flipY = false.</td>
  </tr>
  <tr>
    <td>Rocket renders as faint line</td>
    <td>Rocket projectile missing geometry definition</td>
    <td>Export projectile mesh and simulate flight acceleration.</td>
  </tr>
  <tr>
    <td>Comb filtering on shoreline audio</td>
    <td>Duplicate out-of-phase audio loops playing on polylines</td>
    <td>Use one looping voice per unique WAV file across polylines.</td>
  </tr>
  <tr>
    <td>Shoreline audio cuts off abruptly</td>
    <td>Web Audio inverse attenuation applied in addition to script ramp</td>
    <td>Set panner.setRolloffFactor(0).</td>
  </tr>
</table>

<div style="margin-top: 6mm; border-top: 1px solid #666; padding-top: 6px; font-family: 'Courier New', Courier, monospace; font-size: 7.5pt; color: #555; display: flex; justify-content: space-between;">
  <span>Dissecting Refractor reference documentation</span>
  <span>Compiled for WebGL rendering</span>
</div>

</body>
</html>
"""

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Writing HTML source to {OUT_HTML}...")
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(HTML_CONTENT)

    print(f"Compiling PDF via Chromium headless to {OUT_PDF}...")
    cmd = [
        "chromium",
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={OUT_PDF}",
        str(OUT_HTML)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("Chromium error:", res.stderr, file=sys.stderr)
        sys.exit(res.returncode)
    print("Chromium output:", res.stderr.strip())

    # Verify with pdfinfo
    pdfinfo = subprocess.run(["pdfinfo", str(OUT_PDF)], capture_output=True, text=True)
    print("\n--- PDF INFO ---")
    print(pdfinfo.stdout)

    size = OUT_PDF.stat().st_size
    print(f"PDF successfully generated! Size: {size:,} bytes")

    # Copy to parent directory to keep in sync
    if PARENT_PDF.parent.exists():
        shutil.copyfile(OUT_PDF, PARENT_PDF)
        print(f"Synchronized PDF copy to {PARENT_PDF}")

if __name__ == "__main__":
    main()
