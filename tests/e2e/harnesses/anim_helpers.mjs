// tests/e2e/harnesses/anim_helpers.mjs
/**
 * Shared animation progress accumulator for testing monotonic 60fps smoothing and weighted stages.
 */

export class MonotonicProgressAccumulator {
  constructor(options = {}) {
    this.lerpFactor = options.lerpFactor || 0.1;
    this.maxSpeedPerSec = options.maxSpeedPerSec || 120.0; // max % per second
    this.displayProgress = 0.0;
    this.targetProgress = 0.0;
    this.lastUpdateTime = null;
    this.downloadWeight = options.downloadWeight || 0.75;
    this.constructionWeight = options.constructionWeight || 0.25;
    this.downloadFraction = 0.0;
    this.constructionFraction = 0.0;
  }

  setDownloadBytes(loaded, total) {
    if (total > 0) {
      this.downloadFraction = Math.min(1.0, Math.max(0.0, loaded / total));
    }
    this._recomputeTarget();
  }

  setStageProgress(stageName, fraction) {
    if (stageName === 'construction' || stageName === 'scene') {
      this.constructionFraction = Math.min(1.0, Math.max(0.0, fraction));
    }
    this._recomputeTarget();
  }

  _recomputeTarget() {
    const rawTarget =
      this.downloadFraction * (this.downloadWeight * 100) +
      this.constructionFraction * (this.constructionWeight * 100);
    // Enforce non-decreasing target
    if (rawTarget > this.targetProgress) {
      this.targetProgress = rawTarget;
    }
  }

  finish() {
    this.downloadFraction = 1.0;
    this.constructionFraction = 1.0;
    this.targetProgress = 100.0;
  }

  update(currentTimeMs) {
    if (this.lastUpdateTime === null) {
      this.lastUpdateTime = currentTimeMs;
      return this.displayProgress;
    }

    const dt = Math.max(0.001, (currentTimeMs - this.lastUpdateTime) / 1000.0);
    this.lastUpdateTime = currentTimeMs;

    const diff = Math.max(0.0, this.targetProgress - this.displayProgress);
    const maxDelta = this.maxSpeedPerSec * dt;
    const step = Math.min(diff * this.lerpFactor + (this.maxSpeedPerSec * 0.1 * dt), maxDelta);

    const prev = this.displayProgress;
    this.displayProgress = Math.min(100.0, Math.min(this.targetProgress, this.displayProgress + step));

    // Monotonic invariant guarantee
    if (this.displayProgress < prev) {
      this.displayProgress = prev;
    }

    return this.displayProgress;
  }
}
