# Bob Plugin - OpenRouter TTS

[Bob](https://bobtranslate.com/) 的 OpenRouter TTS 语音合成插件，默认使用 `google/gemini-3.1-flash-tts-preview`，同时支持 Gemini TTS 与 OpenAI TTS 两套 voice 配置。

## 安装

1. 下载最新版本的 `openrouter-tts.bobplugin`
2. 双击文件即可安装到 Bob

## 配置

在 Bob 的插件设置中填写以下信息：

| 选项 | 说明 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key，例如 `sk-or-v1-...` |
| **API URL** | OpenRouter TTS 接口地址，默认 `https://openrouter.ai/api/v1/audio/speech` |
| **Model** | TTS 模型预设，默认 `google/gemini-3.1-flash-tts-preview` |
| **Custom Model ID** | 可选。填写完整模型 ID 时，会覆盖上方预设 |
| **Voice (Gemini TTS)** | Gemini TTS 音色，适用于 `google/gemini-*` 模型，默认 `Kore` |
| **Voice (OpenAI TTS)** | OpenAI TTS 音色，适用于 `openai/*`、`gpt-4o-mini-tts`、`tts-1` 等模型，默认 `marin` |
| **Custom Voice** | 可选。用于无法自动识别为 Gemini 或 OpenAI 的自定义模型 |
| **Audio Format** | 默认 `pcm`，插件会包装成 WAV 给 Bob 播放；也可选 `mp3` |
| **Speed** | 语速：0.5x ~ 2.0x，部分 provider 可能会忽略该参数 |
| **Instructions / Audio Tags** | 可选。会作为前缀拼到文本前，适合填写 Gemini audio tags 或简短风格提示 |

## Voice 选择规则

Bob 的插件设置项是静态显示的，因此插件会同时展示几组 voice。实际请求时会根据模型 ID 自动选择：

| 模型类型 | 匹配规则 | 使用的配置项 |
| --- | --- | --- |
| Gemini TTS | `google/gemini-*` 或 `gemini-*` | `Voice (Gemini TTS)` |
| OpenAI TTS | `openai/*`、包含 `gpt-4o-mini-tts`、`tts-1`、`tts-1-hd` | `Voice (OpenAI TTS)` |
| 其他自定义模型 | 未匹配到 Gemini / OpenAI | `Custom Voice`，为空时回退到 Gemini voice |

## OpenRouter 配置示例

### Gemini TTS

| 选项 | 值 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key |
| **API URL** | `https://openrouter.ai/api/v1/audio/speech` |
| **Model** | `google/gemini-3.1-flash-tts-preview` |
| **Voice (Gemini TTS)** | `Kore` |
| **Audio Format** | `pcm` |

### OpenAI TTS

| 选项 | 值 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key |
| **API URL** | `https://openrouter.ai/api/v1/audio/speech` |
| **Model** | `openai/gpt-4o-mini-tts` 或 `Custom Model ID` 中填写具体 OpenRouter 模型 ID |
| **Voice (OpenAI TTS)** | `marin`、`cedar`、`alloy` 等 |
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
- Gemini/OpenRouter 的 PCM 音频会被插件转换为 24kHz、16-bit、mono WAV，供 Bob 播放。
- 如果选择 `mp3` 但当前模型或 provider 不支持，OpenRouter 会返回错误。
- 插件会对最近 10 条成功合成结果做内存缓存。

## 支持的语言

自动、中文（简/繁）、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、俄语、阿拉伯语、泰语、越南语、印尼语、马来语、土耳其语、波兰语、荷兰语、瑞典语、丹麦语、挪威语、芬兰语、希腊语、捷克语、罗马尼亚语、匈牙利语、斯洛伐克语、乌克兰语、保加利亚语、克罗地亚语、印地语、孟加拉语、泰米尔语、泰卢固语、马拉雅拉姆语、希伯来语、菲律宾语。

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
