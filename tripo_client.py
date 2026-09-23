#!/usr/bin/env python3
"""Tripo v2 API CLI. Standard library only; never retries task submission."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "https://api.tripo3d.ai/v2/openapi"
SKILL_DIR = Path(__file__).resolve().parents[1]
MODELS = ("v3.1-20260211", "P1-20260311")
FORMATS = ("FBX", "OBJ", "STL", "GLTF", "USDZ", "3MF")


class TripoError(Exception):
    pass


class Pending(TripoError):
    pass


def emit(value, stream=None):
    print(json.dumps(value, ensure_ascii=False, indent=2), file=stream or sys.stdout, flush=True)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def task_id(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise TripoError("Invalid task ID.")
    return value


def parse_key(raw):
    raw = raw.strip().lstrip("\ufeff")
    tokens = re.findall(r"\btsk_[A-Za-z0-9_-]+", raw)
    if len(set(tokens)) == 1:
        return tokens[0]
    # Also accept a plain token or a single labelled/key=value line.
    raw = re.sub(r"^(?:TRIPO_API_KEY|Tripo API Key|Authorization)\s*[:=]\s*", "", raw, flags=re.I)
    raw = re.sub(r"^Bearer\s+", "", raw, flags=re.I).strip().strip("'\"")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{16,512}", raw):
        raise TripoError("Key file must contain one API key, optionally labelled TRIPO_API_KEY.")
    return raw


def load_key(explicit=None):
    if explicit:
        selected = Path(explicit).expanduser()
    elif os.environ.get("TRIPO_API_KEY"):
        return parse_key(os.environ["TRIPO_API_KEY"])
    elif os.environ.get("TRIPO_API_KEY_FILE"):
        selected = Path(os.environ["TRIPO_API_KEY_FILE"]).expanduser()
    elif Path("Tripo API Key.txt").is_file():
        selected = Path("Tripo API Key.txt")
    else:
        config = SKILL_DIR / "config.local.json"
        settings = json.loads(config.read_text(encoding="utf-8-sig")) if config.is_file() else {}
        if not settings.get("key_file"):
            raise TripoError("Set TRIPO_API_KEY or pass --key-file before the command.")
        selected = Path(settings["key_file"]).expanduser()
        if not selected.is_absolute():
            selected = SKILL_DIR / selected
    return parse_key(selected.read_text(encoding="utf-8-sig"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TripoError("API redirect refused to protect credentials.")


def https_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise TripoError("Expected an HTTPS asset URL without credentials.")
    return value


class AssetRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, https_url(newurl))


class Client:
    def __init__(self, key):
        self.key = key
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, path, payload=None, body=None, content_type=None, timeout=45):
        headers = {"Authorization": "Bearer " + self.key, "Accept": "application/json",
                   "User-Agent": "tripo-3d-skill/1.0"}
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=timeout) as response:
                data = json.load(response)
        except urllib.error.HTTPError as exc:
            # Do not print raw bodies: gateways may echo request credentials.
            try:
                error = json.loads(exc.read())
                code = error.get("code", "unavailable")
                if not isinstance(code, int):
                    code = "unavailable"
            except (ValueError, AttributeError):
                code = "unavailable"
            hint = {401: "Check API key.", 403: "Check API permission.",
                    429: "Rate limit; query later."}.get(exc.code, "Check Tripo error documentation.")
            if method == "POST" and exc.code >= 500:
                hint += " Submission may have been accepted; do not blindly resubmit."
            raise TripoError(f"Tripo HTTP {exc.code}, code {code}. {hint}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            hint = "Submission outcome is unknown; do not resubmit automatically." if method == "POST" else "Retry this query later."
            raise TripoError("Tripo connection failed. " + hint) from None
        except (ValueError, UnicodeError):
            raise TripoError("Tripo returned invalid JSON; do not repeat a POST automatically.") from None
        # Redact credentials if an upstream response unexpectedly echoes them.
        data = json.loads(json.dumps(data).replace(self.key, "[REDACTED]"))
        if not isinstance(data, dict) or data.get("code") != 0:
            code = data.get("code") if isinstance(data, dict) else "unavailable"
            raise TripoError(f"Tripo business error {code}; check key, credits and parameters.")
        if not isinstance(data.get("data"), dict):
            raise TripoError("Tripo response is missing data.")
        return data["data"]

    def get_task(self, identifier, timeout=45):
        return self.request("GET", "/task/" + task_id(identifier), timeout=timeout)

    def upload(self, path):
        kind, content = read_image(path)
        boundary = "tripo" + uuid.uuid4().hex
        mime = "image/jpeg" if kind == "jpg" else "image/" + kind
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
                f"filename=\"reference.{kind}\"\r\nContent-Type: {mime}\r\n\r\n").encode()
        body += content + f"\r\n--{boundary}--\r\n".encode()
        data = self.request("POST", "/upload/sts", body=body,
                            content_type="multipart/form-data; boundary=" + boundary)
        token = data.get("image_token")
        if not isinstance(token, str) or not token:
            raise TripoError("Upload response is missing image_token.")
        return {"type": kind, "file_token": token}


def read_image(path):
    path = Path(path)
    size = path.stat().st_size
    if not 0 < size <= 20 * 1024 * 1024:
        raise TripoError("Reference image must be non-empty and no larger than 20 MB.")
    content = path.read_bytes()
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        kind = "png"
    elif content.startswith(b"\xff\xd8\xff"):
        kind = "jpg"
    elif content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        kind = "webp"
    else:
        raise TripoError("Reference must be a PNG, JPEG or WebP image (checked by file header).")
    return kind, content


def payload_for(args):
    if args.command == "convert":
        return {"type": "convert_model", "original_model_task_id": task_id(args.task_id),
                "format": args.format}
    payload = {"type": args.command + "_to_model", "model_version": args.model_version}
    if args.face_limit is not None:
        maximum = 20000 if args.model_version == "P1-20260311" else 1500000
        minimum = 48 if args.model_version == "P1-20260311" else 1
        if not minimum <= args.face_limit <= maximum:
            raise TripoError(f"face-limit must be {minimum}..{maximum} for this model.")
        payload["face_limit"] = args.face_limit
    if args.command == "text":
        if not args.prompt.strip() or len(args.prompt) > 1024:
            raise TripoError("Prompt must contain 1..1024 characters.")
        payload["prompt"] = args.prompt
        if args.negative_prompt is not None:
            if len(args.negative_prompt) > 255:
                raise TripoError("Negative prompt must not exceed 255 characters.")
            payload["negative_prompt"] = args.negative_prompt
    else:
        kind, _ = read_image(args.image)
        payload["file"] = {"type": kind, "file_token": "UPLOAD_AT_EXECUTION"}
    return payload


def output_url(value):
    return value.get("url") if isinstance(value, dict) else value


def download_asset(url, folder, label, fallback):
    https_url(url)
    # Deliberately use a separate opener: never send Tripo Authorization to the CDN.
    opener = urllib.request.build_opener(AssetRedirect())
    temp = folder / (label + "." + uuid.uuid4().hex + ".part")
    try:
        with opener.open(urllib.request.Request(url, headers={"User-Agent": "tripo-3d-skill/1.0"}), timeout=45) as response:
            mime = response.headers.get_content_type()
            if mime in ("text/html", "application/json", "application/xml", "text/xml"):
                raise TripoError("Asset URL returned an error document instead of a model.")
            first = response.read(512)
            if not first:
                raise TripoError("Downloaded asset is empty.")
            if first.startswith(b"glTF"):
                extension = ".glb"
            elif first.startswith(b"PK\x03\x04"):
                suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower()
                extension = suffix if suffix in (".usdz", ".3mf") else ".zip"
            elif first.startswith(b"\x89PNG"):
                extension = ".png"
            elif first.startswith(b"\xff\xd8\xff"):
                extension = ".jpg"
            elif first.startswith(b"RIFF") and first[8:12] == b"WEBP":
                extension = ".webp"
            else:
                suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower()
                extension = suffix if suffix in {".glb", ".gltf", ".fbx", ".obj", ".stl", ".usdz", ".3mf", ".zip"} else fallback
            with temp.open("wb") as output:
                output.write(first)
                shutil.copyfileobj(response, output)
            expected = response.headers.get("Content-Length")
        if expected and temp.stat().st_size != int(expected):
            raise TripoError("Asset download is incomplete; query and download the same task again.")
        if extension == ".glb":
            with temp.open("rb") as source:
                header = source.read(12)
            if len(header) != 12 or struct.unpack("<4sII", header) != (b"glTF", 2, temp.stat().st_size):
                raise TripoError("Downloaded GLB header or length is invalid.")
        dest = folder / (label + extension)
        if dest.exists():
            dest = folder / (label + "-" + uuid.uuid4().hex[:8] + extension)
        temp.replace(dest)
        return str(dest.resolve())
    except (urllib.error.URLError, TimeoutError, OSError):
        raise TripoError(f"Download failed for {label}; run download for the same task again.") from None
    finally:
        temp.unlink(missing_ok=True)


def download_task(task, folder):
    if task.get("status") != "success":
        raise TripoError("Task is not successful; no final model to download.")
    output = task.get("output") or {}
    found = next(((name, output_url(output.get(name))) for name in ("pbr_model", "model", "base_model")
                  if output_url(output.get(name))), None)
    if not found or not isinstance(found[1], str):
        raise TripoError("Successful task has no supported model URL; inspect task.json.")
    folder.mkdir(parents=True, exist_ok=True)
    files = {}
    try:
        files[found[0]] = download_asset(found[1], folder, found[0], ".bin")
        preview = output_url(output.get("rendered_image"))
        if preview:
            files["rendered_image"] = download_asset(preview, folder, "preview", ".bin")
    finally:
        if files:
            previous = folder / "downloads.json"
            saved = json.loads(previous.read_text(encoding="utf-8")) if previous.is_file() else []
            save(previous, saved + [{"files": files}])
    emit({"task_id": task.get("task_id"), "files": files})
    return files


def wait_task(client, identifier, root, timeout=45, interval=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = client.get_task(identifier, timeout=max(0.1, min(45, deadline - time.monotonic())))
        folder = root / task_id(identifier)
        save(folder / "task.json", task)
        status = task.get("status")
        emit({"task_id": identifier, "status": status, "progress": task.get("progress")}, sys.stderr)
        if status == "success":
            return download_task(task, folder)
        if status not in ("queued", "running"):
            raise TripoError(f"Task {identifier} stopped with status {status}; inspect task.json.")
        time.sleep(max(0, min(interval, deadline - time.monotonic())))
    raise Pending(f"Task {identifier} is still pending. Resume wait with the same ID; do not submit again.")


def submit(client, payload, root):
    # Preflight local writes before a potentially chargeable POST.
    journal = root / ("submission-" + uuid.uuid4().hex + ".json")
    save(journal, {"state": "submitting", "request": payload})
    try:
        data = client.request("POST", "/task", payload)
        identifier = task_id(data["task_id"])
    except (TripoError, KeyError, TypeError) as exc:
        save(journal, {"state": "submission_unconfirmed", "request": payload})
        reason = str(exc) if isinstance(exc, TripoError) else "Missing or invalid task_id in response."
        raise TripoError(f"{reason} Submission not confirmed. Check Tripo console before resubmitting. Record: {journal}") from None
    # Print ID immediately so recovery remains possible if a later write fails.
    emit({"task_id": identifier, "out": str((root / identifier).resolve())})
    save(journal, {"state": "submitted", "task_id": identifier, "request": payload})
    save(root / identifier / "request.json", payload)
    save(root / identifier / "task.json", data)
    return identifier


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--key-file", help="Path to key file; never pass the key itself.")
    sub = result.add_subparsers(dest="command", required=True)
    sub.add_parser("balance", help="Read-only authentication and credit check.")
    for name in ("text", "image", "convert", "status", "wait", "download"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--out", type=Path, default=Path("outputs/tripo"))
        if name in ("convert", "status", "wait", "download"):
            cmd.add_argument("task_id")
        if name in ("text", "image"):
            cmd.add_argument("--model-version", choices=MODELS, default=MODELS[0])
            cmd.add_argument("--face-limit", type=int)
        if name == "text":
            cmd.add_argument("--prompt", required=True)
            cmd.add_argument("--negative-prompt")
        if name == "image":
            cmd.add_argument("--image", type=Path, required=True)
        if name == "convert":
            cmd.add_argument("--format", type=str.upper, choices=FORMATS, required=True)
        if name in ("text", "image", "convert"):
            cmd.add_argument("--dry-run", action="store_true", help="No key access, API requests or output files.")
            cmd.add_argument("--wait", action="store_true")
        if name in ("text", "image", "convert", "wait"):
            cmd.add_argument("--timeout", type=float, default=45)
            cmd.add_argument("--interval", type=float, default=5)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    if hasattr(args, "timeout") and (not 0 < args.timeout <= 3600 or not 1 <= args.interval <= 60):
        raise TripoError("timeout must be 0..3600 seconds; interval must be 1..60 seconds.")
    if hasattr(args, "task_id"):
        task_id(args.task_id)
    if args.command in ("text", "image", "convert"):
        payload = payload_for(args)
        if args.dry_run:
            emit({"dry_run": True, "request": payload})
            return 0
    client = Client(load_key(args.key_file))
    if args.command == "balance":
        emit(client.request("GET", "/user/balance"))
    elif args.command in ("text", "image", "convert"):
        if args.command == "image":
            # Verify output directory before upload.
            args.out.mkdir(parents=True, exist_ok=True)
            payload["file"] = client.upload(args.image)
        identifier = submit(client, payload, args.out)
        if args.wait:
            wait_task(client, identifier, args.out, args.timeout, args.interval)
    elif args.command == "wait":
        wait_task(client, args.task_id, args.out, args.timeout, args.interval)
    else:
        task = client.get_task(args.task_id)
        folder = args.out / args.task_id
        save(folder / "task.json", task)
        if args.command == "status":
            emit(task)
        else:
            download_task(task, folder)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        sys.exit(main())
    except Pending as exc:
        emit({"pending": str(exc)}, sys.stderr)
        sys.exit(3)
    except (TripoError, OSError, ValueError) as exc:
        emit({"error": str(exc)}, sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        emit({"error": "Interrupted. Resume any existing task by its ID; do not submit again."}, sys.stderr)
        sys.exit(130)

