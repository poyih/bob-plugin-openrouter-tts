# Bob Plugin - OpenRouter TTS

[Bob](https://bobtranslate.com/) 的 OpenRouter TTS 语音合成插件，默认使用 `google/gemini-3.1-flash-tts-preview`，并内置 OpenRouter 上**全部 speech-output 模型**与各自的音色列表。

## 安装

1. 下载最新版本的 `openrouter-tts.bobplugin`
2. 双击文件即可安装到 Bob

## 支持的模型

每个模型都有一组独立的音色，选中模型后请在对应的 Voice 菜单里挑选音色（Bob 的设置项是静态显示的，所有 Voice 菜单会同时出现，请只调整与当前模型匹配的那一组）。

| 模型 | OpenRouter ID | 对应 Voice 菜单 | 音色数 |
| --- | --- | --- | --- |
| Gemini 3.1 Flash TTS Preview | `google/gemini-3.1-flash-tts-preview` | Voice · Gemini | 30 |
| GPT-4o Mini TTS | `openai/gpt-4o-mini-tts-2025-12-15` | Voice · OpenAI | 13 |
| MAI-Voice-2 | `microsoft/mai-voice-2` | Voice · Microsoft MAI | 4 |
| Grok Voice TTS 1.0 | `x-ai/grok-voice-tts-1.0` | Voice · Grok | 5 |
| Zonos v0.1 Transformer | `zyphra/zonos-v0.1-transformer` | Voice · Zyphra Zonos | 5 |
| Zonos v0.1 Hybrid | `zyphra/zonos-v0.1-hybrid` | Voice · Zyphra Zonos | 5 |
| CSM 1B | `sesame/csm-1b` | Voice · Sesame CSM | 7 |
| Orpheus 3B | `canopylabs/orpheus-3b-0.1-ft` | Voice · Orpheus | 7 |
| Kokoro 82M | `hexgrad/kokoro-82m` | Voice · Kokoro | 54 |
| Voxtral Mini TTS | `mistralai/voxtral-mini-tts-2603` | Voice · Voxtral | 30 |
| 自定义模型 | `Custom Model ID` 填写 | Custom Voice | — |

> 模型列表对应 OpenRouter [output_modalities=speech](https://openrouter.ai/models?output_modalities=speech) 的全部模型。新增模型可直接在 `Custom Model ID` 中填写 ID，并在 `Custom Voice` 里填对应音色。

## 配置

在 Bob 的插件设置中填写以下信息：

| 选项 | 说明 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key，例如 `sk-or-v1-...` |
| **API URL** | OpenRouter TTS 接口地址，默认 `https://openrouter.ai/api/v1/audio/speech` |
| **Model** | TTS 模型，默认 `google/gemini-3.1-flash-tts-preview` |
| **Custom Model ID** | 可选。填写完整模型 ID 时，会覆盖上方预设 |
| **Voice · 各家族** | 各模型家族的音色菜单，详见上表 |
| **Custom Voice** | 可选。用于无法自动识别音色家族的自定义模型 |
| **Audio Format** | 默认 `pcm`，插件会包装成 WAV 给 Bob 播放；也可选 `wav` / `mp3` / `opus` / `flac`（需 provider 支持） |
| **Speed** | 语速：0.5x ~ 2.0x，仅在非 1.0x 时发送，部分 provider 可能会忽略 |
| **Instructions / Audio Tags** | 可选。会作为前缀拼到文本前，适合填写 Gemini audio tags 或简短风格提示 |

## Voice 选择规则

插件会根据当前模型 ID 自动选择对应的 Voice 菜单：

| 家族 | 匹配规则 | 使用的配置项 |
| --- | --- | --- |
| Gemini | 含 `gemini` | Voice · Gemini |
| OpenAI | `openai/` 开头、含 `gpt-4o-mini-tts`、`tts-1` 开头 | Voice · OpenAI |
| Microsoft | `microsoft/` 开头、含 `mai-voice` | Voice · Microsoft MAI |
| xAI Grok | `x-ai/` 开头、含 `grok-voice` | Voice · Grok |
| Zyphra | `zyphra/` 开头、含 `zonos` | Voice · Zyphra Zonos |
| Sesame | `sesame/` 开头、含 `csm` | Voice · Sesame CSM |
| Canopy Orpheus | `canopylabs/` 开头、含 `orpheus` | Voice · Orpheus |
| Kokoro | `hexgrad/` 开头、含 `kokoro` | Voice · Kokoro |
| Voxtral | `mistralai/` 开头、含 `voxtral` | Voice · Voxtral |
| 其他自定义 | 未匹配到上述任一家族 | Custom Voice，为空时回退到 Gemini 默认音色 |

## OpenRouter 配置示例

### Gemini TTS（默认）

| 选项 | 值 |
| --- | --- |
| **API URL** | `https://openrouter.ai/api/v1/audio/speech` |
| **Model** | `google/gemini-3.1-flash-tts-preview` |
| **Voice · Gemini** | `Kore` |
| **Audio Format** | `pcm` |

### Kokoro 82M（多语言、开源、便宜）

| 选项 | 值 |
| --- | --- |
| **Model** | `hexgrad/kokoro-82m` |
| **Voice · Kokoro** | `af_heart`、`zf_xiaoxiao`（中文）、`jf_alpha`（日语）等 |
| **Audio Format** | `pcm` 或 `mp3` |

### OpenAI GPT-4o Mini TTS

| 选项 | 值 |
| --- | --- |
| **Model** | `openai/gpt-4o-mini-tts-2025-12-15` |
| **Voice · OpenAI** | `marin`、`cedar`、`alloy` 等 |
| **Audio Format** | `mp3` 或 provider 支持的格式 |

`API URL` 也支持填写：

- `https://openrouter.ai`
- `https://openrouter.ai/api`
- `https://openrouter.ai/api/v1`
- `https://openrouter.ai/api/v1/audio/speech`
- `https://openrouter.ai/api/v1/tts`（legacy/custom endpoint）

## Audio Tags

`Instructions / Audio Tags` 会作为前缀拼到待合成文本前，例如：

```text
[excited]
```

合成 `Hello world` 时，实际请求输入会变成：

```text
[excited] Hello world
```

也可以直接在待合成文本里使用标签，例如：

```text
[whispers] This is a secret. [short pause] Please listen carefully.
```

## 注意事项

- 单次合成文本长度不能超过 4096 个字符。
- 插件会按返回音频的实际内容（magic bytes）自动识别格式：真正的 WAV / MP3 / Ogg / FLAC 会原样交给 Bob 播放，只有裸 PCM 才会被包装成 24kHz、16-bit、mono WAV。
- 如果选择 `mp3` / `wav` 等格式但当前 provider 不支持，OpenRouter 可能会返回错误或退回到默认格式。
- `Speed` 仅在非 1.0x 时随请求发送，以兼容不支持该参数的模型。
- 插件会对最近 10 条成功合成结果做内存缓存。

## 支持的语言

自动、中文（简/繁）、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、俄语、阿拉伯语、泰语、越南语、印尼语、马来语、土耳其语、波兰语、荷兰语、瑞典语、丹麦语、挪威语、芬兰语、希腊语、捷克语、罗马尼亚语、匈牙利语、斯洛伐克语、乌克兰语、保加利亚语、克罗地亚语、印地语、孟加拉语、泰米尔语、泰卢固语、马拉雅拉姆语、希伯来语、菲律宾语。

> 各模型实际支持的语言不同（例如 Kokoro / MAI-Voice-2 / Voxtral 为多语言，Zonos / Orpheus 主要为英语），请按所选模型挑选合适的音色。

## 开发

插件由两个核心文件组成：

- `info.json` — 插件元信息与配置项定义
- `main.js` — TTS 调用逻辑

构建 `.bobplugin` 文件：

```bash
zip -j openrouter-tts.bobplugin info.json main.js
```

## License

MIT
