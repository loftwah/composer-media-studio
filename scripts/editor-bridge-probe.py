#!/usr/bin/env python3
"""Bounded local CompositionV1 -> FFmpeg/editable timeline experiment.

No provider calls, servers or product state changes. This does not constitute
native-editor, artistic-quality or Studio UI acceptance. Python 3.10+, FFmpeg
with libx264/AAC and ffprobe are required; OpenTimelineIO is optional.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from fractions import Fraction

try:
    import resource
except ImportError:
    resource = None

FPS = 30
MAX_INPUT = 128 * 1024 * 1024
MAX_OUTPUT = 64 * 1024 * 1024
PROFILES = {"landscape": (1280, 720), "portrait": (720, 1280)}
TOOLS = {}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def dump(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(args, timeout=180):
    proc = subprocess.run([str(x) for x in args], stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=False)
    if proc.returncode:
        raise RuntimeError(f"{Path(str(args[0])).name} failed ({proc.returncode}): "
                           + proc.stderr.decode("utf-8", errors="replace")[-4000:])
    return proc.stdout.decode("utf-8", errors="strict")


def ffmpeg(*args):
    return run([TOOLS["ffmpeg"], "-hide_banner", "-loglevel", "error", "-nostdin",
                "-threads", "2", "-filter_threads", "1", *args])


def inspect(path, count=False):
    args = [TOOLS["ffprobe"], "-v", "error", "-protocol_whitelist", "file,pipe"]
    if count:
        args.append("-count_frames")
    return json.loads(run(args + ["-show_streams", "-show_format", "-of", "json", path]))


def stream(info, kind):
    found = [s for s in info["streams"] if s.get("codec_type") == kind]
    require(len(found) == 1, f"Exactly one {kind} stream is required")
    return found[0]


def duration_ms(info, kind):
    s = stream(info, kind)
    duration = s.get("duration", info.get("format", {}).get("duration"))
    require(duration not in (None, "N/A"), "Source duration is unknown")
    exact = Fraction(str(duration)) * 1000
    value = round(exact)
    require(abs(exact - value) <= Fraction(1, 10), "Source duration is not integer milliseconds")
    return value


def frames(milliseconds):
    require(type(milliseconds) is int and milliseconds >= 0, "Times must be non-negative integer milliseconds")
    require(milliseconds * FPS % 1000 == 0, f"Time {milliseconds}ms is not exactly aligned to {FPS}fps")
    return milliseconds * FPS // 1000


def doctor():
    for name in ("ffmpeg", "ffprobe"):
        TOOLS[name] = shutil.which(name)
        require(TOOLS[name], f"Install {name} first; no software is installed by this probe")
    versions = {name: run([path, "-version"]).splitlines()[0] for name, path in TOOLS.items()}
    encoders = run([TOOLS["ffmpeg"], "-hide_banner", "-encoders"])
    require("libx264" in encoders and " aac " in encoders, "This FFmpeg needs libx264 and AAC encoders")
    try:
        import opentimelineio as otio
        otio_version = otio.__version__
    except ImportError:
        otio_version = None
    return {"python": platform.python_version(), "platform": platform.platform(),
            "versions": versions, "opentimelineio": otio_version,
            "fps": FPS, "encoder_threads": 2,
            "native_editor": "not_probed", "network_or_provider_calls": 0}


def load_inputs(composition_path, asset_map_path):
    require(Path(composition_path).stat().st_size <= 1500000 and Path(asset_map_path).stat().st_size <= 1500000, "Input JSON exceeds the 1.5MB metadata bound")
    composition = json.loads(Path(composition_path).read_text(encoding="utf-8"))
    mapping = json.loads(Path(asset_map_path).read_text(encoding="utf-8"))
    require(isinstance(composition, dict) and isinstance(mapping, dict), "Inputs must be JSON objects")
    allowed = {"id", "projectId", "title", "shots", "totalMs", "audioAssetId", "audioTracks", "createdAt", "updatedAt", "slateAssetId", "originSongPlan"}
    require(not (set(composition) - allowed), "Unsupported composition fields: " + ", ".join(sorted(set(composition) - allowed)))
    require(isinstance(composition.get("id"), str) and composition["id"], "CompositionV1 id is required")
    require(not composition.get("slateAssetId"), "Slates are not supported by this probe")
    shots = composition.get("shots")
    require(isinstance(shots, list) and 2 <= len(shots) <= 6, "Use two to six hard-cut video shots")
    require(composition.get("audioAssetId"), "Provide the existing premixed audioAssetId; this probe does not mix stems")
    require(isinstance(composition.get("audioTracks", []), list), "audioTracks must be an array")
    needed = [s.get("assetId") for s in shots if isinstance(s, dict)] + [composition["audioAssetId"]]
    require(len(needed) == len(shots) + 1 and all(isinstance(x, str) and x for x in needed), "Invalid asset IDs")
    assets = {}
    for asset_id in dict.fromkeys(needed):
        item = mapping.get(asset_id)
        expected = item.get("sha256") if isinstance(item, dict) else None
        raw_path = item.get("path") if isinstance(item, dict) else item
        require(isinstance(raw_path, str) and raw_path and "://" not in raw_path, f"Explicit local path required for {asset_id}")
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = Path(asset_map_path).resolve().parent / path
        path = path.resolve(strict=True)
        require(path.is_file(), "Media input must be a regular local file")
        size = path.stat().st_size
        require(0 < size <= MAX_INPUT, "A source is empty or exceeds 128 MiB")
        digest = sha(path)
        require(not expected or digest == expected, f"SHA-256 mismatch for {asset_id}")
        info = inspect(path)
        kind = "audio" if asset_id == composition["audioAssetId"] else "video"
        ms = duration_ms(info, kind)
        require(ms > 0, "Media duration must be positive")
        if kind == "video":
            video = stream(info, "video")
            require(ms <= 16000, "Each source clip must be at most 16 seconds, matching Studio's bounded local renderer")
            require(0 < video["width"] <= 4096 and 0 < video["height"] <= 4096 and video["width"] * video["height"] <= 8294400, "Input exceeds the local 4K envelope")
        else:
            require(info["format"].get("format_name") == "wav" and size <= 16 * 1024 * 1024, "Use the existing premixed WAV under 16 MiB")
        assets[asset_id] = {"path": path, "sha256": digest, "bytes": size, "durationMs": ms, "kind": kind}
    require(sum(x["bytes"] for x in assets.values()) <= MAX_INPUT, "Selected media exceeds 128 MiB")
    ranges = []
    for shot in shots:
        require(not (set(shot) - {"assetId", "trimStartMs", "trimEndMs", "durationMs"}), "Unsupported shot field (effects/retiming are not silently dropped)")
        require(("trimStartMs" in shot) == ("trimEndMs" in shot), "Both trim boundaries must be supplied together")
        asset = assets[shot["assetId"]]
        start, end = shot.get("trimStartMs", 0), shot.get("trimEndMs", asset["durationMs"])
        require(type(start) is int and type(end) is int and 0 <= start < end <= asset["durationMs"], "Invalid source trim")
        require("durationMs" not in shot or shot["durationMs"] == end - start, "durationMs must equal trim length; speed changes are unsupported")
        frames(start); frames(end)
        ranges.append((start, end))
    total = sum(end - start for start, end in ranges)
    require(2000 <= total <= 60000 and composition.get("totalMs") == total, "totalMs must equal shots and be between 2 and 60 seconds")
    require(abs(assets[composition["audioAssetId"]]["durationMs"] - total) <= 100, "Premixed audio duration must match totalMs within 100ms")
    return composition, assets, ranges


def export_timelines(destination, composition, segments, sound, width, height):
    """Cuts are editable; these are normalised derivatives, not original handles."""
    total_frames = frames(composition["totalMs"])
    fcpx = ET.Element("fcpxml", version="1.10")
    resources = ET.SubElement(fcpx, "resources")
    ET.SubElement(resources, "format", id="r1", name=f"FFVideoFormat{height}p{FPS}", frameDuration=f"1/{FPS}s", width=str(width), height=str(height), colorSpace="1-1-1 (Rec. 709)")
    for i, item in enumerate(segments):
        asset = ET.SubElement(resources, "asset", id=f"r{i + 2}", name=f"Shot {i + 1}", start="0s", duration=f"{item['frames']}/{FPS}s", hasVideo="1", hasAudio="0", format="r1")
        ET.SubElement(asset, "media-rep", kind="original-media", src=item["relative_path"])
    audio_ref = f"r{len(segments) + 2}"
    asset = ET.SubElement(resources, "asset", id=audio_ref, name="Premixed soundtrack", start="0s", duration=f"{total_frames}/{FPS}s", hasAudio="1", audioSources="1", audioChannels="2", audioRate="48000")
    ET.SubElement(asset, "media-rep", kind="original-media", src=sound)
    library = ET.SubElement(fcpx, "library")
    event = ET.SubElement(library, "event", name="Editor bridge probe")
    project = ET.SubElement(event, "project", name=composition.get("title", composition["id"]))
    sequence = ET.SubElement(project, "sequence", format="r1", duration=f"{total_frames}/{FPS}s", tcStart="0s", tcFormat="NDF", audioLayout="stereo", audioRate="48k")
    spine = ET.SubElement(sequence, "spine")
    cursor = 0
    for i, item in enumerate(segments):
        clip = ET.SubElement(spine, "asset-clip", name=f"Shot {i + 1}", ref=f"r{i + 2}", offset=f"{cursor}/{FPS}s", start="0s", duration=f"{item['frames']}/{FPS}s")
        if i == 0:
            ET.SubElement(clip, "asset-clip", name="Premixed soundtrack", ref=audio_ref, lane="-1", offset="0s", start="0s", duration=f"{total_frames}/{FPS}s", audioRole="music")
        cursor += item["frames"]
    ET.indent(fcpx)
    ET.ElementTree(fcpx).write(destination / "timeline.fcpxml", encoding="utf-8", xml_declaration=True)
    ET.parse(destination / "timeline.fcpxml")
    result = {"fcpxml": "well_formed_xml_only; native_import_not_run", "native_import": "not_run", "otio": "sdk_not_installed"}
    try:
        import opentimelineio as otio
    except ImportError:
        return result
    rt = otio.opentime.RationalTime
    tr = otio.opentime.TimeRange
    timeline = otio.schema.Timeline(name=composition.get("title", composition["id"]))
    video = otio.schema.Track(name="Video", kind=otio.schema.TrackKind.Video)
    for i, item in enumerate(segments):
        source_range = tr(rt(0, FPS), rt(item["frames"], FPS))
        ref = otio.schema.ExternalReference(target_url=item["relative_path"], available_range=source_range)
        video.append(otio.schema.Clip(name=f"Shot {i + 1}", media_reference=ref, source_range=source_range))
    audio = otio.schema.Track(name="Premixed soundtrack", kind=otio.schema.TrackKind.Audio)
    audio_range = tr(rt(0, FPS), rt(total_frames, FPS))
    audio.append(otio.schema.Clip(name="Soundtrack", media_reference=otio.schema.ExternalReference(target_url=sound, available_range=audio_range), source_range=audio_range))
    timeline.tracks.extend([video, audio])
    timeline.metadata["app_composer"] = {"composition_id": composition["id"], "normalised_derivatives": True, "original_contract": "../composition.json"}
    otio.adapters.write_to_file(timeline, str(destination / "timeline.otio"))
    reopened = otio.adapters.read_from_file(str(destination / "timeline.otio"))
    require(len(reopened.tracks[0]) == len(segments) and reopened.duration().rescaled_to(FPS).value == total_frames, "OTIO SDK roundtrip differs")
    result["otio"] = f"sdk_roundtrip_pass:{otio.__version__}; native_import_not_run"
    return result


def verify_master(path, expected_frames, width, height):
    info = inspect(path, count=True)
    video, audio = stream(info, "video"), stream(info, "audio")
    require(video.get("codec_name") == "h264" and audio.get("codec_name") == "aac", "Unexpected output codecs")
    require(video["width"] == width and video["height"] == height and int(video["nb_read_frames"]) == expected_frames, "Wrong output size or frame count")
    require(Fraction(video["avg_frame_rate"]) == FPS, "Wrong output frame rate")
    vd, ad = float(video["duration"]), float(audio["duration"])
    require(abs(vd - expected_frames / FPS) < 1 / FPS and abs(vd - ad) <= 0.1, "Unexpected A/V duration difference")
    require(0 < path.stat().st_size <= MAX_OUTPUT, "Output exceeds 64 MiB")
    ffmpeg("-xerror", "-protocol_whitelist", "file,pipe", "-i", path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-")
    return {"full_decode": "pass", "frames": expected_frames, "fps": FPS, "width": width, "height": height, "video_seconds": vd, "audio_seconds": ad, "bytes": path.stat().st_size, "sha256": sha(path)}


def render(composition_path, asset_map_path, output, cache, profiles, env):
    started = time.monotonic()
    before = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None
    composition, assets, ranges = load_inputs(composition_path, asset_map_path)
    output, cache = Path(output).resolve(), Path(cache).resolve()
    require(not output.exists(), "Output already exists; use a fresh revision directory")
    require(output != cache and output not in cache.parents, "Cache must be outside the new output directory")
    output.mkdir(parents=True, mode=0o700)
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    dump(output / "composition.json", composition)
    source_receipt = {k: {**v, "path": str(v["path"])} for k, v in assets.items()}
    dump(output / "source-assets.json", source_receipt)
    outputs = {}
    try:
        for profile in profiles:
            width, height = PROFILES[profile]
            destination = output / profile
            media = destination / "media"
            media.mkdir(parents=True)
            segments = []
            for index, (shot, (start, end)) in enumerate(zip(composition["shots"], ranges)):
                asset = assets[shot["assetId"]]
                key_data = {"probe_cache_format": 1, "source": asset["sha256"], "start_ms": start, "end_ms": end, "width": width, "height": height, "fps": FPS, "fit": "centre_crop", "codec": "libx264_crf23_veryfast", "ffmpeg": env["versions"]["ffmpeg"]}
                key = hashlib.sha256(json.dumps(key_data, sort_keys=True).encode()).hexdigest()
                cached, metadata = cache / f"{key}.mp4", cache / f"{key}.json"
                hit = cached.is_file() and metadata.is_file()
                if hit:
                    hit = json.loads(metadata.read_text())["sha256"] == sha(cached)
                if not hit:
                    temporary = cache / f"{key}.{uuid.uuid4().hex}.tmp.mp4"
                    try:
                        filters = f"setpts=PTS-STARTPTS,trim=start={start / 1000}:end={end / 1000},setpts=PTS-STARTPTS,fps={FPS},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,format=yuv420p"
                        ffmpeg("-protocol_whitelist", "file,pipe", "-i", asset["path"], "-vf", filters, "-an", "-frames:v", frames(end - start), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-threads", "2", "-movflags", "+faststart", temporary)
                        info = inspect(temporary, count=True)
                        require(int(stream(info, "video")["nb_read_frames"]) == frames(end - start), "Source ended before requested frame count")
                        require(temporary.stat().st_size <= MAX_OUTPUT, "A normalised segment exceeds the output limit")
                        temporary.replace(cached)
                        dump(metadata, {"sha256": sha(cached), "input": key_data})
                    finally:
                        temporary.unlink(missing_ok=True)
                relative = f"media/shot-{index + 1}-{key[:12]}.mp4"
                shutil.copyfile(cached, destination / relative)
                segments.append({"assetId": shot["assetId"], "frames": frames(end - start), "cache_key": key, "cache_hit": hit, "sha256": sha(cached), "relative_path": relative})
            sound = assets[composition["audioAssetId"]]
            # Normalise the already mixed track once; do not replay its stem
            # recipe or apply originSongPlan's source offset a second time.
            ffmpeg("-protocol_whitelist", "file,pipe", "-i", sound["path"], "-map", "0:a:0", "-af", "apad", "-t", composition["totalMs"] / 1000, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", media / "soundtrack.wav")
            concat = destination / "concat.txt"
            concat.write_text("".join(f"file '{x['relative_path']}'\n" for x in segments), encoding="utf-8")
            master = destination / "master.mp4"
            ffmpeg("-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", concat, "-protocol_whitelist", "file,pipe", "-i", media / "soundtrack.wav", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-af", "apad", "-t", composition["totalMs"] / 1000, "-movflags", "+faststart", master)
            outputs[profile] = {"master": verify_master(master, frames(composition["totalMs"]), width, height), "shots": segments, "timelines": export_timelines(destination, composition, segments, "media/soundtrack.wav", width, height)}
        for asset in assets.values():
            require(sha(asset["path"]) == asset["sha256"], "An original changed during this run")
        after = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None
        measured = {"wall_seconds": round(time.monotonic() - started, 3)}
        if after:
            measured["child_cpu_seconds"] = round(after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime, 3)
            measured["peak_single_child_rss_mib_process_lifetime"] = round(after.ru_maxrss / (1048576 if sys.platform == "darwin" else 1024), 2)
            measured["rss_scope"] = "Largest individual child process so far; not combined system memory, not isolated to this render"
        receipt = {"experiment": "CompositionV1 external editor bridge", "status": "technical_pass", "environment": env, "composition_id": composition["id"], "source_contract_preserved": True, "original_hashes_unchanged": True, "measurement": measured, "outputs": outputs, "cost": {"media_generation_calls": 0, "incremental_provider_charges": 0, "agent_inference_cost": "unknown", "electricity_cost": "not_measured"}, "limitations": ["Technical output only; human creative review not evaluated", "Native editor import/control/export not run", "Centre crops are mechanical, not art-directed vertical framing", "Timeline uses normalised derivatives: trims, crop and frame-rate conversion are baked; original handles retained only in source manifest", "Premixed audio starts at zero; originSongPlan/audioTracks retained as provenance, not re-applied", "No caption/slate/effect/retiming rendering", "No Studio UI, Prints bridge or cloud execution exercised"]}
        dump(output / "receipt.json", receipt)
        return receipt
    except Exception as error:
        dump(output / "failure.json", {"status": "failed", "message": str(error), "wall_seconds": round(time.monotonic() - started, 3)})
        raise


def video_frame_hashes(path):
    text = ffmpeg("-protocol_whitelist", "file,pipe", "-i", path, "-map", "0:v:0", "-f", "framemd5", "-")
    return [line.rsplit(",", 1)[1].strip() for line in text.splitlines() if line and not line.startswith("#")]


def audio_hash(path):
    return ffmpeg("-protocol_whitelist", "file,pipe", "-i", path, "-map", "0:a:0", "-f", "hash", "-hash", "sha256", "-").strip()


def demo(output, env):
    output = Path(output).resolve()
    require(not output.exists(), "Demo output already exists; choose a fresh folder")
    output.mkdir(parents=True, mode=0o700)
    fixture = output / "synthetic-fixture"
    fixture.mkdir()
    lengths = [8, 7, 9, 6]
    mapping = {}
    for index, seconds in enumerate(lengths):
        path = fixture / f"synthetic-{index + 1}.mp4"
        ffmpeg("-f", "lavfi", "-i", f"testsrc2=size=640x360:rate={FPS}:duration={seconds}", "-vf", f"hue=h={index * 60}", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-threads", "2", path)
        mapping[f"synthetic_{index + 1}"] = {"path": path.name, "sha256": sha(path)}
    audio = fixture / "synthetic-tone.wav"
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=30", "-af", "volume=0.15", "-ac", "2", "-c:a", "pcm_s16le", audio)
    mapping["synthetic_audio"] = {"path": audio.name, "sha256": sha(audio)}
    composition = {"id": "fictional_editor_probe_v1", "title": "SYNTHETIC TECHNICAL PROBE — not a finished music film", "shots": [{"assetId": f"synthetic_{i + 1}", "durationMs": n * 1000} for i, n in enumerate(lengths)], "totalMs": 30000, "audioAssetId": "synthetic_audio", "createdAt": 0}
    dump(fixture / "composition-v1.json", composition)
    dump(fixture / "assets-v1.json", mapping)
    first = render(fixture / "composition-v1.json", fixture / "assets-v1.json", output / "v1", output / "cache", list(PROFILES), env)
    first_hashes = {p: sha(output / "v1" / p / "master.mp4") for p in PROFILES}
    replacement = fixture / "synthetic-2-revised.mp4"
    ffmpeg("-protocol_whitelist", "file,pipe", "-i", fixture / "synthetic-2.mp4", "-vf", "hue=h=110", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-threads", "2", replacement)
    revised_mapping = copy.deepcopy(mapping)
    revised_mapping["synthetic_2_revised"] = {"path": replacement.name, "sha256": sha(replacement)}
    revised = copy.deepcopy(composition)
    revised["updatedAt"] = 1
    revised["shots"][1]["assetId"] = "synthetic_2_revised"
    dump(fixture / "composition-v2.json", revised)
    dump(fixture / "assets-v2.json", revised_mapping)
    second = render(fixture / "composition-v2.json", fixture / "assets-v2.json", output / "v2", output / "cache", ["landscape"], env)
    a, b = video_frame_hashes(output / "v1/landscape/master.mp4"), video_frame_hashes(output / "v2/landscape/master.mp4")
    require(len(a) == len(b) == 900, "Revision frame count differs")
    lo, hi = lengths[0] * FPS, sum(lengths[:2]) * FPS
    require(a[:lo] == b[:lo] and a[hi:] == b[hi:] and a[lo:hi] != b[lo:hi], "Revision modified an unaffected shot or failed to modify shot 2")
    require(all(sha(output / "v1" / p / "master.mp4") == h for p, h in first_hashes.items()), "Earlier master changed")
    require(audio_hash(output / "v1/landscape/master.mp4") == audio_hash(output / "v2/landscape/master.mp4"), "Revision altered decoded audio")
    hits = [x["cache_hit"] for x in second["outputs"]["landscape"]["shots"]]
    require(hits == [True, False, True, True], "Selective cache proof failed")
    result = {"status": "technical_pass", "classification": "synthetic_fixture_only", "seconds": 30, "frames_per_master": 900, "profiles": ["landscape_v1", "portrait_v1", "landscape_v2"], "revision": {"changed_shot": 2, "unchanged_shots_decoded_frame_hashes": "exact_match", "changed_shot_decoded_frame_hashes": "different", "decoded_audio_hash": "exact_match", "previous_masters": "preserved", "cache_hits": 3, "shots_rerendered": 1}, "v1_measurement": first["measurement"], "v2_measurement": second["measurement"], "native_editor": "not_run", "creative_review": "not_evaluated"}
    dump(output / "demo-receipt.json", result)
    return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    demo_parser = sub.add_parser("demo")
    demo_parser.add_argument("--output", required=True)
    render_parser = sub.add_parser("render")
    render_parser.add_argument("--composition", required=True)
    render_parser.add_argument("--assets", required=True)
    render_parser.add_argument("--output", required=True)
    render_parser.add_argument("--cache", required=True)
    render_parser.add_argument("--profile", choices=[*PROFILES, "both"], default="landscape")
    args = parser.parse_args()
    env = doctor()
    if args.command == "doctor":
        result = env
    elif args.command == "demo":
        result = demo(args.output, env)
    else:
        result = render(args.composition, args.assets, args.output, args.cache, list(PROFILES) if args.profile == "both" else [args.profile], env)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        sys.exit(1)
