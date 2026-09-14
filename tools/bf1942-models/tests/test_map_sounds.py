from __future__ import annotations

import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402


def pcm_wav(seconds: float = 0.05, rate: int = 44100) -> bytes:
    """A real, minimal 16-bit mono PCM wav — ffmpeg has to accept it."""
    frames = int(rate * seconds)
    data = b"".join(struct.pack("<h", (i * 137) % 4096 - 2048)
                    for i in range(frames))
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)) + data)


ffmpeg_available = extract_map.ffmpeg_available


class SharedSoundWriteTests(unittest.TestCase):
    """`extract_sounds`'s inner `write`, reached through the public function.

    The level has no ambient, areas or vehicles, so the report comes back empty
    — these drive `write` via the ambient path with a stub resolver instead,
    which is the only part of the pipeline these tests care about.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.out_dir = self.root / "maps" / "a_shau"
        self.out_dir.mkdir(parents=True)
        self.shared = self.root / "maps" / "_shared" / "sounds"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_paths_are_measured_from_where_the_level_will_live(self) -> None:
        """The staging-depth regression.

        `extract_maps_all.py` writes each level to `<staging>/<level>/<level>`
        and moves it into the tree afterwards. Measuring the sound path from
        the write location produced `../../../_shared/sounds/x.mp3` for a path
        that has to be `../_shared/sounds/x.mp3` — every sample 404ing once
        published, while resolving fine on the extracting machine.
        """
        staging = self.root / "staging" / "a_shau" / "a_shau"
        staging.mkdir(parents=True)
        final = self.root / "maps" / "a_shau"

        info = mock.Mock()
        info.sounds.ambient.file = "Sound/wind.wav"
        info.sounds.ambient.volume = 0.6
        info.sounds.areas = []
        with mock.patch.object(extract_map, "resolve_sound",
                               return_value=("wind.wav", pcm_wav())):
            report = extract_map.extract_sounds(
                info, mock.Mock(), mock.Mock(), staging,
                shared_dir=self.shared, audio_format="wav", final_dir=final)

        self.assertEqual(report["ambient"]["file"], "../_shared/sounds/wind.wav")

    def _write(self, audio_format: str = "wav"):
        """Return the `write` closure with everything else stubbed out."""
        captured = {}

        def fake_extract(info, level_files, sounds, out_dir, **kw):
            real = extract_map.extract_sounds
            return real(info, level_files, sounds, out_dir, **kw)

        # Drive the real function with a level that resolves one ambient file.
        info = mock.Mock()
        info.sounds.ambient.file = "Sound/wind.wav"
        info.sounds.ambient.volume = 0.6
        info.sounds.areas = []
        with mock.patch.object(extract_map, "resolve_sound",
                               return_value=("wind.wav", pcm_wav())):
            report = extract_map.extract_sounds(
                info, mock.Mock(), mock.Mock(), self.out_dir,
                shared_dir=self.shared, audio_format=audio_format)
        captured["report"] = report
        return report

    def test_wav_lands_in_the_shared_dir_not_the_level(self) -> None:
        report = self._write("wav")
        self.assertTrue((self.shared / "wind.wav").is_file())
        self.assertFalse((self.out_dir / "sounds").exists())
        self.assertEqual(report["ambient"]["file"], "../_shared/sounds/wind.wav")

    def test_the_path_is_relative_so_the_viewer_resolves_it_as_a_url(self) -> None:
        # The viewer builds `${MAPS_BASE}/${dir}/${relPath}`; a leading `../`
        # is what lifts the sample out of the level directory and into the
        # mod's shared one. An absolute path here would 404.
        report = self._write("wav")
        rel = report["ambient"]["file"]
        self.assertFalse(rel.startswith("/"))
        self.assertTrue(rel.startswith("../"))
        self.assertNotIn("\\", rel)

    def test_an_existing_sample_is_not_rewritten(self) -> None:
        # The shared directory is written by every level in the mod, in
        # parallel. A second writer must leave the first one's bytes alone.
        self.shared.mkdir(parents=True)
        (self.shared / "wind.wav").write_bytes(b"already here")
        self._write("wav")
        self.assertEqual((self.shared / "wind.wav").read_bytes(), b"already here")

    def test_no_partial_files_are_left_behind(self) -> None:
        self._write("wav")
        leftovers = [p.name for p in self.shared.iterdir()
                     if ".part" in p.name or p.name.endswith(".wav.wav")]
        self.assertEqual(leftovers, [])

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_mp3_transcode_rewrites_the_extension_and_shrinks_the_file(self) -> None:
        report = self._write("mp3")
        self.assertEqual(report["ambient"]["file"], "../_shared/sounds/wind.mp3")
        self.assertTrue((self.shared / "wind.mp3").is_file())
        self.assertFalse((self.shared / "wind.wav").is_file())

    def test_a_transcode_failure_fails_the_level_rather_than_shipping_wav(self) -> None:
        # Deliberately no fallback. Writing the wav instead would silently
        # reintroduce the 3.2 GB the shared directory exists to remove, and a
        # sample ffmpeg cannot read is a corrupt source whose wav is equally
        # corrupt. Failing the level is a handled outcome in the batch driver.
        with mock.patch.object(extract_map, "transcode_to_mp3",
                               side_effect=extract_map.TranscodeError("boom")):
            with self.assertRaises(extract_map.TranscodeError):
                self._write("mp3")
        self.assertFalse((self.shared / "wind.wav").exists())


class TranscodeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_it_produces_a_real_mp3(self) -> None:
        dest = self.root / "x.mp3"
        extract_map.transcode_to_mp3(pcm_wav(0.5), dest)
        head = dest.read_bytes()[:4]
        # LAME writes an ID3v2 tag or a bare frame sync; either is a real MP3,
        # and the Xing/LAME gapless header rides inside the first frame.
        self.assertTrue(head.startswith(b"ID3") or head[0] == 0xFF, head)

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_it_leaves_no_temp_files_on_success(self) -> None:
        extract_map.transcode_to_mp3(pcm_wav(), self.root / "x.mp3")
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["x.mp3"])

    def test_a_missing_ffmpeg_raises(self) -> None:
        with mock.patch.object(subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaises(extract_map.TranscodeError):
                extract_map.transcode_to_mp3(pcm_wav(), self.root / "x.mp3")

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_garbage_input_raises_and_leaves_nothing(self) -> None:
        dest = self.root / "x.mp3"
        with self.assertRaises(extract_map.TranscodeError):
            extract_map.transcode_to_mp3(b"not a wav", dest)
        self.assertFalse(dest.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_ffmpeg_availability_is_detectable_for_the_preflight(self) -> None:
        with mock.patch.object(subprocess, "run", side_effect=FileNotFoundError):
            self.assertFalse(extract_map.ffmpeg_available())


if __name__ == "__main__":
    unittest.main()
