'use strict';
// A small rotating file log: <dir>/<name>.log rolls to <name>.1.log ...
// <name>.<keep>.log once it passes maxBytes. Also keeps the last lines in
// memory for the log window, and tells listeners about each new line.

const fs = require('node:fs');
const path = require('node:path');

class RotatingLog {
  constructor(dir, name, { maxBytes = 2 * 1024 * 1024, keep = 5, tail = 2000 } = {}) {
    this.dir = dir; this.name = name; this.maxBytes = maxBytes; this.keep = keep; this.tailMax = tail;
    this.file = path.join(dir, `${name}.log`);
    this.listeners = new Set();
    fs.mkdirSync(dir, { recursive: true });
    try { this.size = fs.statSync(this.file).size; } catch { this.size = 0; }
    this.lines = this.readTail();
  }

  /** The end of the file there is, so the log window opens with history. */
  readTail(bytes = 256 * 1024) {
    try {
      const fd = fs.openSync(this.file, 'r');
      try {
        const start = Math.max(0, this.size - bytes);
        const buf = Buffer.alloc(this.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        const lines = buf.toString('utf8').split('\n').filter(Boolean);
        if (start > 0) lines.shift();   // a partial first line
        return lines.slice(-this.tailMax);
      } finally { fs.closeSync(fd); }
    } catch { return []; }
  }

  rotate() {
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = path.join(this.dir, `${this.name}.${i}.log`);
      const to = path.join(this.dir, `${this.name}.${i + 1}.log`);
      try { fs.renameSync(from, to); } catch { /* not there yet */ }
    }
    try { fs.renameSync(this.file, path.join(this.dir, `${this.name}.1.log`)); } catch { /* nothing to roll */ }
    this.size = 0;
  }

  write(text) {
    const stamp = new Date().toISOString();
    for (const raw of String(text).split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const line = `${stamp} ${raw}`;
      this.lines.push(line);
      if (this.lines.length > this.tailMax) this.lines.splice(0, this.lines.length - this.tailMax);
      const bytes = Buffer.byteLength(line) + 1;
      if (this.size + bytes > this.maxBytes) this.rotate();
      try { fs.appendFileSync(this.file, line + '\n'); this.size += bytes; } catch { /* a full disk must not stop the app */ }
      for (const fn of this.listeners) { try { fn(line); } catch { /* a closed window */ } }
    }
  }

  onLine(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

module.exports = { RotatingLog };
