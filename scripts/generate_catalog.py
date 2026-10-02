#!/usr/bin/env python3
"""从 catalog.json 生成运行时能力表、Bob 菜单和 README；--check 只检查差异。"""
import argparse
import copy
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
START = "// BEGIN GENERATED MODEL CATALOG"
END = "// END GENERATED MODEL CATALOG"


def load_catalog(root=ROOT):
    catalog = json.loads((pathlib.Path(root) / "catalog.json").read_text(encoding="utf-8"))
    families = catalog["families"]
    seen = set()
    option_ids = set()
    for family in families.values():
        formats = family["formats"]
        if not formats or family["defaultFormat"] not in formats:
            raise ValueError("默认音频格式必须属于支持的格式")
        option = family["voiceOption"]
        if option:
            if option["identifier"] in option_ids:
                raise ValueError("音色配置项 identifier 重复")
            option_ids.add(option["identifier"])
            values = [voice["value"] for voice in option["menuValues"]]
            if len(values) != len(set(values)) or option["defaultValue"] not in values:
                raise ValueError(f"{option['identifier']} 的音色或默认值无效")
        elif not family["optionalVoice"]:
            raise ValueError("必须指定音色的家族缺少菜单")
    for model in catalog["models"]:
        if not isinstance(model["id"], str) or not model["id"] or model["id"] in seen:
            raise ValueError("模型 ID 为空或重复")
        if model["family"] not in families:
            raise ValueError(f"{model['id']} 使用了未知家族")
        seen.add(model["id"])
    return catalog


def runtime_block(catalog):
    families = copy.deepcopy(catalog["families"])
    for family in families.values():
        option = family["voiceOption"]
        family["voiceOption"] = option["identifier"] if option else ""
        family["defaultVoice"] = option["defaultValue"] if option else ""
    models = {model["id"]: {key: value for key, value in model.items() if key not in ("id", "title")} for model in catalog["models"]}
    runtime = {"families": families, "models": models}
    return f"{START}\n// 编辑 catalog.json 后运行 python3 scripts/generate_catalog.py。\nvar MODEL_CATALOG = {json.dumps(runtime, ensure_ascii=False, indent=4)};\nvar VOICE_OPTION_BY_FAMILY = {{}};\nvar DEFAULT_VOICE_BY_FAMILY = {{}};\nvar PCM_SAMPLE_RATE_BY_FAMILY = {{}};\nObject.keys(MODEL_CATALOG.families).forEach(function(family) {{\n    var profile = MODEL_CATALOG.families[family];\n    VOICE_OPTION_BY_FAMILY[family] = profile.voiceOption || undefined;\n    DEFAULT_VOICE_BY_FAMILY[family] = profile.defaultVoice;\n    PCM_SAMPLE_RATE_BY_FAMILY[family] = profile.pcmSampleRate;\n}});\n{END}"


def replace_section(text, start, end, body):
    if start in text:
        pattern = re.escape(start) + r"[\s\S]*?" + re.escape(end)
        return re.sub(pattern, lambda _: start + "\n" + body + "\n" + end, text, count=1)
    raise ValueError(f"缺少生成标记 {start}")


def generated_files(root=ROOT):
    root = pathlib.Path(root)
    catalog = load_catalog(root)
    main = (root / "main.js").read_text(encoding="utf-8")
    if START not in main:
        start = main.index("// minimax 与 custom")
        end = main.index("var AUDIO_CACHE")
        main = main[:start] + runtime_block(catalog) + "\n" + main[end:]
    else:
        main = replace_section(main, START, END, runtime_block(catalog).split("\n", 1)[1].rsplit("\n", 1)[0])
    info = json.loads((root / "info.json").read_text(encoding="utf-8"))
    options = [option for option in info["options"] if not option["identifier"].startswith("voice")]
    by_id = {option["identifier"]: option for option in options}
    by_id["model"]["menuValues"] = [{"title": model["title"], "value": model["id"]} for model in catalog["models"]] + [{"title": "Custom Model ID", "value": "custom"}]
    by_id["model"]["desc"] = "选择模型及对应的 Voice 菜单。Custom Voice 非空时覆盖菜单；Fish Audio 和 Seed 可使用默认音色。"
    position = next(i for i, option in enumerate(options) if option["identifier"] == "customVoice")
    voices = [copy.deepcopy(family["voiceOption"]) for family in catalog["families"].values() if family["voiceOption"]]
    options[position:position] = voices
    by_id["customVoice"]["desc"] = "非空时覆盖当前模型的菜单音色，清空后恢复菜单。Fish Audio 可填写 reference ID，Seed 可填写 speaker ID 或留空；未知模型需要填写音色 ID。"
    by_id["responseFormat"]["defaultValue"] = "auto"
    by_id["responseFormat"]["desc"] = "Auto 按模型选择格式（Voxtral / Seed 为 MP3，其余为 PCM）。OpenRouter 支持 MP3 / PCM；WAV / Opus / FLAC 供支持这些格式的自定义接口使用。"
    by_id["responseFormat"]["menuValues"] = [
        {"title": "Auto (按模型)", "value": "auto"},
        {"title": "PCM (wrap to WAV)", "value": "pcm"},
        {"title": "MP3", "value": "mp3"},
        {"title": "WAV (custom API)", "value": "wav"},
        {"title": "Opus (custom API)", "value": "opus"},
        {"title": "FLAC (custom API)", "value": "flac"},
    ]
    by_id["pcmSampleRate"]["desc"] = "Auto 优先采用响应 Content-Type 中的 rate；缺失时按模型家族回退（Fish Audio 44.1kHz、其他 24kHz）。手动选项覆盖响应采样率；声道数采用响应 channels（缺失时 mono）。"
    by_id["speed"]["desc"] = "0.5x ~ 2.0x；仅非 1.0x 时发送。验证按钮使用相同语速；提供方可能忽略或拒绝不支持的参数。"
    by_id["instructions"]["desc"] = "可选。Gemini 3.8 单独传递风格提示；其他模型作为文本前缀。验证按钮使用相同配置。"
    info["options"] = options
    readme = (root / "README.md").read_text(encoding="utf-8")
    if "<!-- BEGIN GENERATED MODELS -->" not in readme:
        readme = re.sub(r"## 支持的模型[\s\S]*?(?=## 配置)", "## 支持的模型\n\n<!-- BEGIN GENERATED MODELS -->\n<!-- END GENERATED MODELS -->\n\n", readme, count=1)
    rows = ["每个模型使用对应的 Voice 菜单；Custom Voice 可覆盖菜单。所有菜单会在 Bob 设置中同时显示。", "", "| 模型 | OpenRouter ID | Voice 菜单 | 音色数 | Auto 格式 |", "| --- | --- | --- | --- | --- |"]
    for model in catalog["models"]:
        family = catalog["families"][model["family"]]
        option = family["voiceOption"]
        menu = option["title"] if option else "Custom Voice（可留空）"
        count = str(len(option["menuValues"])) if option else "默认 / speaker ID"
        if model["family"] == "fishaudio":
            count = "2 + 默认"
        rows.append(f"| {model['title']} | `{model['id']}` | {menu} | {count} | {family['defaultFormat']} |")
    rows += ["", f"目录于 {catalog['verifiedAt']} 与 [OpenRouter speech 模型 API]({catalog['source']}) 核对，共 {len(catalog['models'])} 个模型。模型可用性会变化；发布前运行 `python3 scripts/check_catalog.py` 检查目录漂移。", "", "MiniMax 接受菜单之外的音色 ID。Fish Audio 的菜单是社区 reference ID，不属于官方固定音色列表。Seed 根据输入描述生成音频，Custom Voice 可留空；单次输入最多 3000 字符。Microsoft MAI 2、2.1 和 2.1 Flash 使用不同的 Voice 菜单。"]
    readme = replace_section(readme, "<!-- BEGIN GENERATED MODELS -->", "<!-- END GENERATED MODELS -->", "\n".join(rows))
    if "<!-- BEGIN GENERATED VOICE RULES -->" not in readme:
        readme = re.sub(r"## Voice 选择规则[\s\S]*?(?=## OpenRouter 配置示例)", "## Voice 选择规则\n\n<!-- BEGIN GENERATED VOICE RULES -->\n<!-- END GENERATED VOICE RULES -->\n\n", readme, count=1)
    rules = ["先按完整模型 ID 查目录，再按家族匹配。Custom Voice 非空时始终优先；清空后恢复对应菜单。", "", "| 家族 | 使用的配置项 | 默认 PCM 采样率 |", "| --- | --- | --- |"]
    for name, family in catalog["families"].items():
        option = family["voiceOption"]
        rules.append(f"| {name} | {option['title'] if option else 'Custom Voice（可留空）'} | {family['pcmSampleRate']} Hz |")
    rules += ["", "未知家族的自定义模型使用 Custom Voice；已知模型的能力、默认值和音色菜单都来自 `catalog.json`。"]
    readme = replace_section(readme, "<!-- BEGIN GENERATED VOICE RULES -->", "<!-- END GENERATED VOICE RULES -->", "\n".join(rules))
    return {"main.js": main, "info.json": json.dumps(info, ensure_ascii=False, indent=2) + "\n", "README.md": readme}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        files = generated_files()
        changed = [name for name, content in files.items() if (ROOT / name).read_text(encoding="utf-8") != content]
        if args.check:
            if changed:
                print("生成文件已过期：" + ", ".join(changed), file=sys.stderr)
                return 1
        else:
            for name in changed:
                (ROOT / name).write_text(files[name], encoding="utf-8")
        print("目录生成校验通过" if args.check else "已生成：" + (", ".join(changed) or "无需修改"))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"目录生成失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
