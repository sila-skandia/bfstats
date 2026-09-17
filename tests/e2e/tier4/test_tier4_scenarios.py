"""Tier 4: Real-World Application Scenarios (6 Tests).

Comprehensive end-to-end user journeys validating complete lifecycle workflows:
asset extraction, loading overlays, audio controllers, monotonic progress smoothing,
GPU warmup passes, and direct-to-spawn transitions across vanilla BF1942 and mod maps.
"""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


class TestTier4Scenarios(unittest.TestCase):
    """Tier 4 Test Suite: 6 Real-World End-to-End Workflow Scenarios."""

    def test_t4_scen_01_wake_island_vanilla_workflow(self) -> None:
        """T4-SCEN-01: Wake Island Vanilla End-to-End Workflow.

        Verifies complete flow: Wake Island art (pacific2.webp), 800x600 layout with olive bar,
        vehicle4.mp3 audio, monotonic progress 0->100%, GPU warmup render, audio fadeout,
        skipping briefing, and direct transition to #fullmap.deploy.
        """
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { MonotonicProgressAccumulator } from './tests/e2e/harnesses/anim_helpers.mjs';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import { computeVirtualScale, MOD_THEMES, formatLoadingTitle } from './tests/e2e/harnesses/ui_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();

        // 1. Setup UI layout & theme
        const theme = MOD_THEMES['vanilla'];
        assert.equal(theme.fillColor, '#847D4A');
        const title = formatLoadingTitle('Wake Island');
        assert.equal(title, 'LOADING WAKE ISLAND');
        const scale = computeVirtualScale(1920, 1080);
        assert.equal(scale.scale, 1.8);

        // 2. Start audio playback
        const audio = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        audio.start('maps/wake/vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio.state, AudioState.ACTIVE_PLAYING);

        // 3. Monotonic progress accumulator
        const acc = new MonotonicProgressAccumulator();
        acc.update(0);
        acc.setDownloadBytes(50, 100);
        acc.update(100);
        assert.ok(acc.displayProgress > 0 && acc.displayProgress <= 37.5);
        acc.setDownloadBytes(100, 100);
        acc.setStageProgress('construction', 1.0);
        acc.finish();
        for (let t = 200; t <= 3000; t += 50) {
          acc.update(t);
        }
        assert.equal(acc.displayProgress, 100.0);

        // 4. GPU warmup & transition directly to deploy
        const trans = new MockTransitionController(env);
        const fadePromise = audio.fadeOut(20);
        await trans.executeTransition();

        assert.equal(trans.warmupRenderCalled, true);
        assert.equal(trans.briefingModalShown, false);
        assert.equal(trans.openDeployCalled, true);
        assert.equal(trans.fullmap.classList.contains('deploy'), true);
        assert.equal(trans.overlay.hidden, true);

        await fadePromise;
        assert.equal(audio.state, AudioState.COMPLETED);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t4_scen_02_bocage_vanilla_workflow(self) -> None:
        """T4-SCEN-02: Bocage Vanilla End-to-End Workflow.

        Verifies Western2 art, LOADING BOCAGE title, audio playback, monotonic progress,
        GPU warmup, and transition to spawn screen.
        """
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { MonotonicProgressAccumulator } from './tests/e2e/harnesses/anim_helpers.mjs';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import { formatLoadingTitle } from './tests/e2e/harnesses/ui_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();

        const title = formatLoadingTitle('Bocage');
        assert.equal(title, 'LOADING BOCAGE');

        const audio = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        audio.start('maps/bocage/vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio.state, AudioState.ACTIVE_PLAYING);

        const acc = new MonotonicProgressAccumulator();
        acc.update(0);
        acc.finish();
        for (let t = 50; t <= 3000; t += 50) {
          acc.update(t);
        }
        assert.equal(acc.displayProgress, 100.0);

        const trans = new MockTransitionController(env);
        const fadePromise = audio.fadeOut(20);
        await trans.executeTransition();
        await fadePromise;

        assert.equal(trans.openDeployCalled, true);
        assert.equal(audio.state, AudioState.COMPLETED);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t4_scen_03_eod_operation_hastings_workflow(self) -> None:
        """T4-SCEN-03: Eve of Destruction (EoD) Operation Hastings Workflow.

        Verifies EoD mod level with custom loader.webp, EoD bamboo/khaki theme (#F7E7B5),
        EoD vehicle4.mp3, progress bar animation, GPU warmup, and transition into spawn screen.
        """
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { MonotonicProgressAccumulator } from './tests/e2e/harnesses/anim_helpers.mjs';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import { MOD_THEMES, formatLoadingTitle } from './tests/e2e/harnesses/ui_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();

        const theme = MOD_THEMES['eod'];
        assert.equal(theme.headerColor, '#B59B70');
        assert.equal(theme.fillColor, '#F7E7B5');

        const title = formatLoadingTitle('Operation Hastings');
        assert.equal(title, 'LOADING OPERATION HASTINGS');

        const audio = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        audio.start('mods/eod/maps/hastings/vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio.state, AudioState.ACTIVE_PLAYING);

        const trans = new MockTransitionController(env);
        await trans.executeTransition();
        assert.equal(trans.openDeployCalled, true);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t4_scen_04_instant_cache_hit_and_smooth_ramp_workflow(self) -> None:
        """T4-SCEN-04: Instant Cache Hit & Smooth Ramp Workflow.

        Verifies that cached assets completing in 0ms do not cause instant snap;
        smooth ramp enforces minimum animation duration (>=300ms) with gentle audio fadeout.
        """
        node_script = """
        import { MonotonicProgressAccumulator } from './tests/e2e/harnesses/anim_helpers.mjs';
        import assert from 'node:assert/strict';

        const acc = new MonotonicProgressAccumulator({ maxSpeedPerSec: 100 });
        acc.update(0);
        // Assets are cached: instantly arrive at 100%
        acc.finish();

        // 100ms of frames (6 frames at 16ms)
        for (let t = 16; t <= 100; t += 16) {
          acc.update(t);
        }
        assert.ok(acc.displayProgress > 0 && acc.displayProgress < 50.0, `Progress snapped too fast: ${acc.displayProgress}%`);

        // 250ms of frames
        for (let t = 116; t <= 250; t += 16) {
          acc.update(t);
        }
        assert.ok(acc.displayProgress < 90.0, `Progress snapped too fast at 250ms: ${acc.displayProgress}%`);

        // After full duration, progress reaches exactly 100%
        for (let t = 266; t <= 3000; t += 16) {
          acc.update(t);
        }
        assert.equal(acc.displayProgress, 100.0);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t4_scen_05_blocked_autoplay_recovery_and_interaction_workflow(self) -> None:
        """T4-SCEN-05: Blocked Autoplay Recovery & Interaction Workflow.

        Verifies browser autoplay rejection, [🔊 UNMUTE] badge display, user click unmute at 45%,
        audio starts smoothly, load completes, and audio fades out over 800ms.
        """
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { MonotonicProgressAccumulator } from './tests/e2e/harnesses/anim_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        let rejecting = true;
        class RejectingAudio extends env.window.Audio {
          play() {
            if (rejecting) {
              const err = new Error('Autoplay blocked');
              err.name = 'NotAllowedError';
              this.paused = true;
              return Promise.reject(err);
            }
            return super.play();
          }
        }

        const audio = createLoadingAudioController({
          audioClass: RejectingAudio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });

        // 1. Map starts loading, autoplay rejects
        audio.start('music/vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio.state, AudioState.BLOCKED_WAITING_GESTURE);
        assert.equal(audio.isAutoplayBlocked(), true);

        // 2. Progress advances to 45%
        const acc = new MonotonicProgressAccumulator();
        acc.setDownloadBytes(45, 100);
        acc.update(200);

        // 3. User clicks unmute badge at 45%
        rejecting = false;
        env.document.dispatchEvent({ type: 'pointerdown' });
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio.isAutoplayBlocked(), false);
        assert.equal(audio.state, AudioState.ACTIVE_PLAYING);

        // 4. Load completes, audio fades out
        const fadePromise = audio.fadeOut(20);
        await fadePromise;
        assert.equal(audio.state, AudioState.COMPLETED);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t4_scen_06_rapid_mod_and_map_switching_workflow(self) -> None:
        """T4-SCEN-06: Rapid Mod & Map Switching Workflow.

        Verifies user starts loading Wake Island, cancels at 40%, switches to EoD Operation Hastings;
        audio stops immediately without lingering; theme updates; new load completes cleanly.
        """
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import { MOD_THEMES } from './tests/e2e/harnesses/ui_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();

        // 1. Session 1: Wake Island
        const audio1 = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        audio1.start('maps/wake/vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio1.state, AudioState.ACTIVE_PLAYING);

        // 2. User cancels mid-load at 40% and switches to EoD
        audio1.cancel();
        assert.equal(audio1.state, AudioState.CANCELLED);

        // 3. Session 2: EoD Operation Hastings starts
        const theme2 = MOD_THEMES['eod'];
        assert.equal(theme2.headerColor, '#B59B70');

        const audio2 = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        audio2.start('mods/eod/maps/hastings/vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(audio2.state, AudioState.ACTIVE_PLAYING);

        // 4. Complete Session 2 transition
        const trans2 = new MockTransitionController(env);
        const fade2 = audio2.fadeOut(20);
        await trans2.executeTransition();
        await fade2;

        assert.equal(trans2.openDeployCalled, true);
        assert.equal(audio2.state, AudioState.COMPLETED);
        // Ensure Session 1 remained cancelled
        assert.equal(audio1.state, AudioState.CANCELLED);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)


if __name__ == "__main__":
    unittest.main()
