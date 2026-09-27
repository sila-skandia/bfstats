// The round's intensity along the replay's timeline (features/round-replay-
// highlights): how hard the fighting was at each moment, as a heat strip
// behind the chapter marks -- the "most replayed" graph over a video's
// scrubber, drawn from the fighting instead of the views -- with the
// round's top plays as gold pips along its top edge. It sits inside the
// timeline (replay-timeline.js) and takes none of its pointer.

/** The strip's smoothing, in buckets either side. */
const SMOOTH = 2;

export class ReplayHeat {
  constructor(highlights) {
    this.hl = highlights;
    this.timeline = highlights.ui.timeline;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rp-hl-heat';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.timeline.el.prepend(this.canvas);
    this.values = this.smooth(highlights.model.intensity.total);
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.timeline.el);
    this.drawnFor = '';
  }

  smooth(raw) {
    const out = new Float32Array(raw.length);
    let max = 0;
    for (let i = 0; i < raw.length; i++) {
      let sum = 0;
      let w = 0;
      for (let j = -SMOOTH; j <= SMOOTH; j++) {
        const v = raw[i + j];
        if (v === undefined) continue;
        const k = 1 - Math.abs(j) / (SMOOTH + 1);
        sum += v * k;
        w += k;
      }
      out[i] = w ? sum / w : 0;
      max = Math.max(max, out[i]);
    }
    // A square root keeps a quiet stretch visible beside the round's peak.
    for (let i = 0; i < out.length; i++) out[i] = max > 0 ? Math.sqrt(out[i] / max) : 0;
    return out;
  }

  draw() {
    const width = this.timeline.el.clientWidth;
    const height = 19;
    if (!width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${width}x${dpr}`;
    if (key === this.drawnFor) return;
    this.drawnFor = key;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const g = this.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const { bucket } = this.hl.model.intensity;
    const duration = Math.max(0.001, this.hl.player.rec.duration);
    const values = this.values;
    const x = i => ((i + 0.5) * bucket / duration) * width;
    // The area, rising from the track.
    const grad = g.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(240, 120, 50, .55)');
    grad.addColorStop(0.6, 'rgba(232, 170, 80, .28)');
    grad.addColorStop(1, 'rgba(232, 195, 90, .04)');
    g.beginPath();
    g.moveTo(0, height);
    for (let i = 0; i < values.length; i++) g.lineTo(x(i), height - 1 - values[i] * (height - 5));
    g.lineTo(width, height);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.beginPath();
    for (let i = 0; i < values.length; i++) {
      const y = height - 1 - values[i] * (height - 5);
      if (i === 0) g.moveTo(x(i), y);
      else g.lineTo(x(i), y);
    }
    g.strokeStyle = 'rgba(245, 160, 80, .55)';
    g.lineWidth = 1;
    g.stroke();
    // The top plays, a pip each.
    g.fillStyle = '#e8c35a';
    for (const play of this.hl.model.plays) {
      const px = (play.t / duration) * width;
      g.beginPath();
      g.moveTo(px, 0.5);
      g.lineTo(px + 3, 3.5);
      g.lineTo(px, 6.5);
      g.lineTo(px - 3, 3.5);
      g.closePath();
      g.fill();
    }
  }

  update() {
    if (!this.drawnFor) this.draw();
  }

  dispose() {
    this.resize.disconnect();
    this.canvas.remove();
  }
}
