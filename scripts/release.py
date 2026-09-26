#!/usr/bin/env python3
"""从已提交的版本源码确定性打包 .bobplugin，并更新 appcast.json。

发布流程（配合 .github/workflows/release.yml）：
    1. 把版本号写进 info.json，在 README「Changelog」加一行 `- **1.4.0** — ...`，
       提交并推送到 main
    2. git tag v1.4.0 && git push origin v1.4.0
    3. Actions 从 tag 检出源码：跑测试 → 本脚本打包并生成 Release 说明 →
       创建 Release 上传安装包 → 把 appcast.json 提交回 main

本地只打包、不改 appcast：python3 scripts/release.py --version 1.4.0 --no-appcast
只依赖标准库。
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import time
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
INFO = ROOT / "info.json"
BUNDLE_PREFIX = "openrouter-tts"
BUNDLE_FILES = ("info.json", "main.js")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
CHANGELOG_LINE_RE = r"^\s*[-*]\s*\*\*{version}\*\*\s*(?:—|–|-|:|：)\s*(.+?)\s*$"
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
APPCAST_INDENT = 2


def read_json(path):
    with pathlib.Path(path).open(encoding="utf-8") as fp:
        return json.load(fp)


def write_json_atomic(path, data, indent=APPCAST_INDENT):
    """在目标同目录写完并 fsync，再原子替换。"""
    path = pathlib.Path(path)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as fp:
            temp_name = fp.name
            json.dump(data, fp, indent=indent, ensure_ascii=False)
            fp.write("\n")
            fp.flush()
            os.fsync(fp.fileno())
        if path.exists():
            os.chmod(temp_name, path.stat().st_mode & 0o777)
        else:
            os.chmod(temp_name, 0o644)
        os.replace(temp_name, path)
    except BaseException:
        if temp_name:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
        raise


def normalize_version(raw):
    if not isinstance(raw, str):
        raise ValueError(f"版本号必须是字符串，收到 {raw!r}")
    version = raw[1:] if raw.startswith("v") else raw
    if not VERSION_RE.fullmatch(version):
        raise ValueError(f"版本号必须形如 1.4.0，收到 {raw!r}")
    return version


def version_key(version):
    normalized = normalize_version(version)
    return tuple(int(part) for part in normalized.split("."))


def bundle_name(version):
    return f"{BUNDLE_PREFIX}-{version}.bobplugin"


def build_bundle(version, root=ROOT):
    """确定性地把 info.json + main.js 压成 .bobplugin，并原子替换目标文件。

    固定条目顺序、时间戳和权限位，所以同一份源码在任何机器上都得到同一个 sha256。
    """
    root = pathlib.Path(root)
    dist = root / "dist"
    dist.mkdir(exist_ok=True)
    bundle = dist / bundle_name(version)

    fd, temp_name = tempfile.mkstemp(dir=dist, prefix=f".{bundle.name}.", suffix=".tmp")
    os.close(fd)
    try:
        with zipfile.ZipFile(
            temp_name,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as archive:
            for name in BUNDLE_FILES:
                path = root / name
                if not path.is_file():
                    raise ValueError(f"缺少 {name}，无法打包")
                member = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
                member.create_system = 3
                member.external_attr = 0o100644 << 16
                archive.writestr(
                    member,
                    path.read_bytes(),
                    compress_type=zipfile.ZIP_DEFLATED,
                    compresslevel=9,
                )
        os.chmod(temp_name, 0o644)
        os.replace(temp_name, bundle)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise
    return bundle


def sha256_of(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open("rb") as fp:
        for chunk in iter(lambda: fp.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upsert_version(versions, entry):
    """同版本替换、不同版本按语义版本降序；不依赖 workflow 调度顺序。"""
    if not isinstance(versions, list):
        raise ValueError("appcast.versions 必须是数组")
    if not isinstance(entry, dict) or "version" not in entry:
        raise ValueError("新版本记录缺少 version")
    for item in versions:
        if not isinstance(item, dict) or not isinstance(item.get("version"), str):
            raise ValueError("appcast.versions 含有缺少合法 version 的记录")
    version = entry["version"]
    result = [item for item in versions if item.get("version") != version]
    result.append(entry)
    return sorted(result, key=lambda item: version_key(item["version"]), reverse=True)


def changelog_notes(version, readme_path):
    """从 README「Changelog」取 `- **x.y.z** — 说明` 那一行的说明（Markdown 原文）。"""
    readme_path = pathlib.Path(readme_path)
    if not readme_path.is_file():
        return ""
    pattern = re.compile(CHANGELOG_LINE_RE.format(version=re.escape(version)))
    for line in readme_path.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if match:
            return match.group(1)
    return ""


def plain_desc(markdown):
    """appcast 的 desc 在 Bob 里按纯文本展示：去掉反引号和多余空白，不留句末句号。"""
    text = re.sub(r"\s+", " ", markdown.replace("`", "")).strip()
    return text.rstrip("。 ")


def write_release_notes(dist, version, notes_markdown, checksum):
    """生成 GitHub Release 正文：更新说明 + 安装包 sha256。"""
    body = notes_markdown or f"版本 {version}"
    notes_path = pathlib.Path(dist) / "release-notes.md"
    notes_path.write_text(f"{body}\n\nsha256: `{checksum}`\n", encoding="utf-8")
    return notes_path


def prepare_version(version, info_path=INFO):
    version = normalize_version(version)
    info = read_json(info_path)
    if not isinstance(info, dict):
        raise ValueError("info.json 顶层必须是对象")
    if info.get("version") == version:
        print(f"info.json 已是 {version}，无需修改")
        return False
    info["version"] = version
    write_json_atomic(info_path, info)
    print(f"已把 info.json 更新为 {version}；请提交并推送后再打 tag")
    return True


def release(
    version,
    notes,
    repo,
    timestamp,
    metadata_root=ROOT,
    root=ROOT,
    update_appcast=True,
):
    version = normalize_version(version)
    root = pathlib.Path(root).resolve()
    info = read_json(root / "info.json")
    if not isinstance(info, dict) or not isinstance(info.get("identifier"), str):
        raise ValueError("info.json 缺少合法 identifier")
    source_version = str(info.get("version", ""))
    if source_version != version:
        raise ValueError(
            f"tag 源码里的 info.json 版本是 {source_version!r}，"
            f"但准备发布 {version!r}。请先用 --prepare-version 更新、提交，再打 tag"
        )

    notes_markdown = (notes or changelog_notes(version, root / "README.md")).strip()
    desc = plain_desc(notes_markdown) or f"版本 {version}"

    appcast_path = None
    appcast = None
    existing_versions = []
    if update_appcast:
        metadata_root = pathlib.Path(metadata_root).resolve()
        appcast_path = metadata_root / "appcast.json"
        appcast = read_json(appcast_path) if appcast_path.exists() else {}
        if not isinstance(appcast, dict):
            raise ValueError("appcast.json 顶层必须是对象")
        identifier = appcast.get("identifier")
        if identifier and identifier != info["identifier"]:
            raise ValueError(
                f"appcast identifier {identifier!r} 与插件 {info['identifier']!r} 不一致"
            )
        # 先验证所有元数据，再完成包构建；任一步失败都不会改写 appcast。
        existing_versions = appcast.get("versions", [])
        upsert_version(existing_versions, {"version": version})

    bundle = build_bundle(version, root)
    checksum = sha256_of(bundle)
    notes_path = write_release_notes(bundle.parent, version, notes_markdown, checksum)
    entry = {
        "version": version,
        "desc": desc,
        "sha256": checksum,
        "url": (
            f"https://github.com/{repo}/releases/download/"
            f"v{version}/{bundle.name}"
        ),
        "minBobVersion": info.get("minBobVersion", "1.8.0"),
        "timestamp": timestamp if timestamp is not None else int(time.time() * 1000),
    }

    if update_appcast:
        appcast["identifier"] = info["identifier"]
        appcast["versions"] = upsert_version(existing_versions, entry)
        write_json_atomic(appcast_path, appcast)

    print(f"bundle : {bundle.relative_to(root)}")
    print(f"sha256 : {checksum}")
    print(f"url    : {entry['url']}")
    print(f"desc   : {desc}")
    print(f"notes  : {notes_path.relative_to(root)}")
    if update_appcast:
        print(f"appcast: {appcast_path}")
    return bundle, entry


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--prepare-version",
        help="只原子更新 info.json 的版本号；提交并推送后再打同版本 tag",
    )
    mode.add_argument(
        "--version",
        help="从已包含该版本号的源码构建发布包、生成 Release 说明并更新 appcast",
    )
    parser.add_argument(
        "--notes",
        default="",
        help="更新说明（Markdown）；留空则取 README Changelog 里该版本那一行",
    )
    parser.add_argument(
        "--repo",
        default="poyih/bob-plugin-openrouter-tts",
        help="GitHub owner/repo，用于拼下载地址",
    )
    parser.add_argument(
        "--timestamp",
        type=int,
        default=None,
        help="毫秒时间戳，默认取当前时间",
    )
    parser.add_argument(
        "--metadata-root",
        default=str(ROOT),
        help="appcast.json 所在仓库根目录；CI 传默认分支的独立 checkout",
    )
    parser.add_argument(
        "--no-appcast",
        action="store_true",
        help="只打包并生成 Release 说明，不改写 appcast.json",
    )
    args = parser.parse_args(argv)

    try:
        if args.prepare_version is not None:
            prepare_version(normalize_version(args.prepare_version))
            return 0
        release(
            normalize_version(args.version),
            args.notes,
            args.repo,
            args.timestamp,
            args.metadata_root,
            update_appcast=not args.no_appcast,
        )
        return 0
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as err:
        print(f"发布失败：{err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
