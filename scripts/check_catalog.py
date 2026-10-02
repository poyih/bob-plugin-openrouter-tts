#!/usr/bin/env python3
"""发布前比对 OpenRouter 公开 speech 目录；--snapshot 可使用本地 API JSON。"""
import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request

from generate_catalog import load_catalog

API_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech"
MAX_CATALOG_BYTES = 4 * 1024 * 1024


def compare_catalog(catalog, response):
    data = response.get("data") if isinstance(response, dict) else None
    if not isinstance(data, list) or not data:
        raise ValueError("远端目录必须包含非空 data 数组")
    remote = {}
    for model in data:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str) or not model["id"]:
            raise ValueError("远端目录包含无效模型 ID")
        if model["id"] in remote:
            raise ValueError("远端目录包含重复模型 ID")
        voices = model.get("supported_voices")
        if voices is not None and (not isinstance(voices, list) or not all(isinstance(voice, str) for voice in voices)):
            raise ValueError(f"{model['id']} 的 supported_voices 无效")
        remote[model["id"]] = model
    local = {model["id"]: model for model in catalog["models"]}
    issues = [f"缺少模型：{model}" for model in sorted(remote.keys() - local.keys())]
    issues += [f"目录中已不存在：{model}" for model in sorted(local.keys() - remote.keys())]
    for model_id in sorted(local.keys() & remote.keys()):
        voices = remote[model_id].get("supported_voices")
        if not voices:
            continue  # 没有官方固定列表的模型允许社区 reference ID 或自定义 speaker ID。
        option = catalog["families"][local[model_id]["family"]]["voiceOption"]
        local_voices = {voice["value"] for voice in option["menuValues"]} if option else set()
        added = set(voices) - local_voices
        removed = local_voices - set(voices)
        if added:
            issues.append(f"{model_id} 缺少音色：" + ", ".join(sorted(added)))
        if removed:
            issues.append(f"{model_id} 已移除音色：" + ", ".join(sorted(removed)))
    return issues


def fetch_catalog():
    request = urllib.request.Request(API_URL, headers={"Accept": "application/json", "User-Agent": "bob-plugin-openrouter-tts-catalog-check"})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(MAX_CATALOG_BYTES + 1)
    if len(data) > MAX_CATALOG_BYTES:
        raise ValueError("模型目录响应超过 4 MiB")
    return json.loads(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=pathlib.Path)
    args = parser.parse_args(argv)
    try:
        response = json.loads(args.snapshot.read_text(encoding="utf-8")) if args.snapshot else fetch_catalog()
        catalog = load_catalog()
        issues = compare_catalog(catalog, response)
        if issues:
            print("\n".join(issues), file=sys.stderr)
            print("请更新 catalog.json 并重新运行 generate_catalog.py。", file=sys.stderr)
            return 1
        print(f"目录核对通过：{len(catalog['models'])} 个模型及官方固定音色一致")
        return 0
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as error:
        print(f"目录核对失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
