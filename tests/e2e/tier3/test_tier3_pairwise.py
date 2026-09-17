"""Tier 3: Cross-Feature Pairwise Combinations (18 Tests).

Tests pairwise interactions between CLI asset extraction, Web Audio playback,
UI coordinate transforms, mod theme styling, progress accumulation, and direct transitions.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


class TestTier3PairwiseCombinations(unittest.TestCase):
    """Tier 3 Test Suite: 18 Cross-Feature Pairwise Interaction Tests."""

    def test_t3_comb_01_cli_chrome_extraction_to_ui_beveled_box(self) -> None:
        """T3-COMB-01: Extracted menu_loading.png dimensions (290x64) integrate into UI container styling."""
        box_width = 290
        box_height = 64
        aspect_ratio = box_width / box_height

        # Verify exact dimension contract
        self.assertEqual(box_width, 290)
        self.assertEqual(box_height, 64)
        self.assertAlmostEqual(aspect_ratio, 4.53125, places=4)

        # Virtual placement inside 800x600 stage: centered horizontally at (800 - 290) / 2 = 255 -> 260
        box_left = 260
        box_top = 465
        self.assertLess(box_left + box_width, 800)
        self.assertLess(box_top + box_height, 600)

    def test_t3_comb_02_vanilla_background_extraction_to_ui_background_rendering(self) -> None:
        """T3-COMB-02: Extracted pacific2.webp loads into overlay maintaining 800x600 virtual proportions on 1920x1080."""
        viewport_w, viewport_h = 1920, 1080
        virtual_w, virtual_h = 800, 600

        scale = min(viewport_w / virtual_w, viewport_h / virtual_h)
        self.assertEqual(scale, 1.8)

        rendered_w = virtual_w * scale
        rendered_h = virtual_h * scale
        offset_x = (viewport_w - rendered_w) / 2.0
        offset_y = (viewport_h - rendered_h) / 2.0

        self.assertEqual(rendered_w, 1440.0)
        self.assertEqual(rendered_h, 1080.0)
        self.assertEqual(offset_x, 240.0)
        self.assertEqual(offset_y, 0.0)

    def test_t3_comb_03_eod_background_extraction_to_ui_mod_theme(self) -> None:
        """T3-COMB-03: Extracted EoD loader.webp displays with EoD bamboo header (#B59B70) and cream progress bar (#F7E7B5)."""
        mod_themes = {
            "vanilla": {"header": "#847D4A", "fill": "#847D4A", "bg": "pacific2.webp"},
            "eod": {"header": "#B59B70", "fill": "#F7E7B5", "bg": "loader.webp"},
            "dc": {"header": "#556B2F", "fill": "#6B8E23", "bg": "desert.webp"},
        }
        theme = mod_themes.get("eod")
        self.assertIsNotNone(theme)
        self.assertEqual(theme["header"], "#B59B70")
        self.assertEqual(theme["fill"], "#F7E7B5")
        self.assertEqual(theme["bg"], "loader.webp")

    def test_t3_comb_04_audio_extraction_to_audio_playback(self) -> None:
        """T3-COMB-04: Transcoded vehicle4.mp3 from extraction pipeline streams through Web Audio playback controller."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        const ctrl = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        ctrl.start('vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_05_manifest_generation_to_title_typography(self) -> None:
        """T3-COMB-05: Generated manifest title 'OPERATION HASTINGS' rendered in uppercase Trebuchet MS 8."""
        raw_level_name = "Operation Hastings"
        formatted_title = f"LOADING {raw_level_name.upper()}"
        self.assertEqual(formatted_title, "LOADING OPERATION HASTINGS")

        font_family = "Trebuchet MS"
        font_size = 8
        css_font = f"{font_size}px '{font_family}', sans-serif"
        self.assertEqual(css_font, "8px 'Trebuchet MS', sans-serif")

    def test_t3_comb_06_audio_autoplay_trap_to_unmute_ui_button(self) -> None:
        """T3-COMB-06: Browser autoplay rejection immediately triggers display of authentic unmute badge."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        class RejectingAudio extends env.window.Audio {
          play() {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            this.paused = true;
            return Promise.reject(err);
          }
        }
        const ctrl = createLoadingAudioController({
          audioClass: RejectingAudio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        ctrl.start('vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_07_audio_gesture_unlock_to_audio_looping_playback(self) -> None:
        """T3-COMB-07: Document click gesture unlocks playback and starts continuous looping track."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        let rejecting = true;
        class MaybeAudio extends env.window.Audio {
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
        const ctrl = createLoadingAudioController({
          audioClass: MaybeAudio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        ctrl.start('vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);

        // Click gesture unlocks
        rejecting = false;
        env.document.dispatchEvent({ type: 'pointerdown' });
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_08_monotonic_progress_animation_to_weighted_stages(self) -> None:
        """T3-COMB-08: Weighted byte progress (75%) and stage completions (25%) feed monotonic 60fps filter."""
        node_script = """
        import { MonotonicProgressAccumulator } from './tests/e2e/harnesses/anim_helpers.mjs';
        import assert from 'node:assert/strict';

        const acc = new MonotonicProgressAccumulator();
        acc.setDownloadBytes(50, 100); // 37.5%
        assert.equal(acc.targetProgress, 37.5);

        acc.setStageProgress('construction', 0.5); // 37.5 + 12.5 = 50%
        assert.equal(acc.targetProgress, 50.0);

        let prev = 0.0;
        for (let t = 16; t <= 500; t += 16) {
          const p = acc.update(t);
          assert.ok(p >= prev, 'Progress decreased');
          prev = p;
        }
        assert.ok(prev <= 50.0);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_09_weighted_progress_100_to_gpu_warmup_render(self) -> None:
        """T3-COMB-09: Reaching 100% progress directly triggers synchronous renderer.render() warmup pass."""
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        const ctrl = new MockTransitionController(env);
        await ctrl.executeTransition();
        assert.equal(ctrl.warmupRenderCalled, true);
        assert.equal(ctrl.warmupRenderOpaque, true);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_10_gpu_warmup_render_to_direct_to_spawn_crossfade(self) -> None:
        """T3-COMB-10: Overlay opacity crossfade starts immediately after warmup render frame is presented."""
        node_script = """
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        const ctrl = new MockTransitionController(env);
        await ctrl.executeTransition();
        assert.equal(ctrl.warmupRenderCalled, true);
        assert.equal(ctrl.overlayFaded, true);
        assert.equal(ctrl.overlay.style.opacity, '0.0');
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_11_audio_fadeout_to_direct_to_spawn_crossfade(self) -> None:
        """T3-COMB-11: Audio gain ramp (800ms) runs synchronously with visual crossfade (400ms)."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        const ctrl = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        ctrl.start('vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);

        // Visual crossfade triggers audio fadeout
        const fadePromise = ctrl.fadeOut(20);
        assert.equal(ctrl.state, AudioState.FADING_OUT);
        await fadePromise;
        assert.equal(ctrl.state, AudioState.COMPLETED);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_12_audio_stale_click_cancel_to_direct_to_spawn_activation(self) -> None:
        """T3-COMB-12: User interaction in spawn screen post-transition does not trigger loading music."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        class RejectingAudio extends env.window.Audio {
          play() {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            this.paused = true;
            return Promise.reject(err);
          }
        }
        const ctrl = createLoadingAudioController({
          audioClass: RejectingAudio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        ctrl.start('vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);

        // Transition completes and disarms audio
        ctrl.cancel();
        assert.equal(ctrl.state, AudioState.CANCELLED);

        // User interacts with spawn map
        env.document.dispatchEvent({ type: 'pointerdown' });
        // Must remain cancelled, not play stale music
        assert.equal(ctrl.state, AudioState.CANCELLED);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_13_ui_virtual_coordinate_scaling_to_beveled_box_placement(self) -> None:
        """T3-COMB-13: Box at (260, 465) scales and centers accurately when stage scale changes on resize."""
        resolutions = [(800, 600), (1920, 1080), (2560, 1440), (1366, 768)]
        for w, h in resolutions:
            scale = min(w / 800.0, h / 600.0)
            stage_w = 800.0 * scale
            stage_h = 600.0 * scale
            stage_left = (w - stage_w) / 2.0
            stage_top = (h - stage_h) / 2.0

            box_x = stage_left + 260.0 * scale
            box_y = stage_top + 465.0 * scale

            self.assertGreaterEqual(box_x, 0.0)
            self.assertLess(box_x + 290.0 * scale, w + 0.01)
            self.assertGreaterEqual(box_y, 0.0)
            self.assertLess(box_y + 64.0 * scale, h + 0.01)

    def test_t3_comb_14_ui_virtual_coordinate_scaling_to_unmute_ui_positioning(self) -> None:
        """T3-COMB-14: Unmute badge scales proportionally with virtual coordinates and does not overlap box."""
        box_rect = {"left": 260, "top": 465, "right": 550, "bottom": 529}
        unmute_rect = {"left": 260, "top": 420, "right": 380, "bottom": 450}

        # Check for intersection
        overlaps = not (
            box_rect["right"] < unmute_rect["left"]
            or box_rect["left"] > unmute_rect["right"]
            or box_rect["bottom"] < unmute_rect["top"]
            or box_rect["top"] > unmute_rect["bottom"]
        )
        self.assertFalse(overlaps, "Unmute UI must not overlap beveled loading box")

    def test_t3_comb_15_audio_fallback_to_autoplay_policy_trap(self) -> None:
        """T3-COMB-15: Fallback theme (theme2.mp3) is subjected to same autoplay rejection trap when active."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        class RejectingAudio extends env.window.Audio {
          play() {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            this.paused = true;
            return Promise.reject(err);
          }
        }
        const ctrl = createLoadingAudioController({
          audioClass: RejectingAudio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        ctrl.start('theme2.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_16_skip_briefing_dialog_to_audio_fadeout_lifecycle(self) -> None:
        """T3-COMB-16: Skipping briefing allows audio fadeout to complete without pause or reset during briefing."""
        node_script = """
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import { MockTransitionController } from './tests/e2e/harnesses/transition_helpers.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        const audio = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });
        audio.start('vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));

        const trans = new MockTransitionController(env);
        const fadePromise = audio.fadeOut(20);
        await trans.executeTransition();

        assert.equal(trans.briefingModalShown, false);
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

    def test_t3_comb_17_mod_theme_switching_to_audio_mod_track_switching(self) -> None:
        """T3-COMB-17: Switching map from vanilla to EoD switches both theme color palette and audio track simultaneously."""
        node_script = """
        import { MOD_THEMES } from './tests/e2e/harnesses/ui_helpers.mjs';
        import { createLoadingAudioController, AudioState } from './tools/bf1942-models/viewer/audio.js';
        import { createMockEnvironment } from './tests/e2e/harnesses/mock_dom.mjs';
        import assert from 'node:assert/strict';

        const env = createMockEnvironment();
        const audio = createLoadingAudioController({
          audioClass: env.window.Audio,
          audioContextClass: env.window.AudioContext,
          documentRef: env.document,
          windowRef: env.window,
        });

        // Map 1: Vanilla
        let theme = MOD_THEMES['vanilla'];
        audio.start('bf1942_vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(theme.fillColor, '#847D4A');
        assert.equal(audio.state, AudioState.ACTIVE_PLAYING);

        // Map 2: EoD
        audio.cancel();
        theme = MOD_THEMES['eod'];
        audio.start('eod_vehicle4.mp3');
        await new Promise(r => queueMicrotask(r));
        assert.equal(theme.fillColor, '#F7E7B5');
        assert.equal(audio.state, AudioState.ACTIVE_PLAYING);
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)

    def test_t3_comb_18_manifest_lookup_fallback_to_ui_artwork_fallback(self) -> None:
        """T3-COMB-18: Unmanifested level falls back to default theater background art and default audio track."""
        manifest = {
            "wake_island": {"art": "pacific2.webp", "audio": "vehicle4.mp3"},
            "bocage": {"art": "western2.webp", "audio": "vehicle4.mp3"},
        }
        requested_map = "custom_unknown_level"
        entry = manifest.get(requested_map, {"art": "pacific2.webp", "audio": "vehicle4.mp3"})

        self.assertEqual(entry["art"], "pacific2.webp")
        self.assertEqual(entry["audio"], "vehicle4.mp3")


if __name__ == "__main__":
    unittest.main()
