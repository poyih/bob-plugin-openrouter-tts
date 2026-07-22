# Bob Plugin - OpenRouter TTS

[Bob](https://bobtranslate.com/) 的 OpenRouter TTS 语音合成插件，默认使用 `google/gemini-3.1-flash-tts-preview`，并内置 OpenRouter 上**全部 speech-output 模型**与各自的音色列表。

## 安装

1. 下载最新版本的 `openrouter-tts.bobplugin`
2. 双击文件即可安装到 Bob

## 支持的模型

每个模型都有一组独立的音色，选中模型后请在对应的 Voice 菜单里挑选音色（Bob 的设置项是静态显示的，所有 Voice 菜单会同时出现，请只调整与当前模型匹配的那一组）。如需传入菜单之外的音色，可填写 `Custom Voice` 全局覆盖当前菜单；清空后恢复菜单音色。

| 模型 | OpenRouter ID | 对应 Voice 菜单 | 音色数 |
| --- | --- | --- | --- |
| Gemini 3.1 Flash TTS Preview | `google/gemini-3.1-flash-tts-preview` | Voice · Gemini | 30 |
| MAI-Voice-2 | `microsoft/mai-voice-2` | Voice · Microsoft MAI | 4 |
| Grok Voice TTS 1.0 | `x-ai/grok-voice-tts-1.0` | Voice · Grok | 5 |
| Zonos v0.1 Transformer | `zyphra/zonos-v0.1-transformer` | Voice · Zyphra Zonos | 5 |
| Zonos v0.1 Hybrid | `zyphra/zonos-v0.1-hybrid` | Voice · Zyphra Zonos | 5 |
| CSM 1B | `sesame/csm-1b` | Voice · Sesame CSM | 7 |
| Orpheus 3B | `canopylabs/orpheus-3b-0.1-ft` | Voice · Orpheus | 7 |
| Kokoro 82M | `hexgrad/kokoro-82m` | Voice · Kokoro | 54 |
| Voxtral Mini TTS | `mistralai/voxtral-mini-tts-2603` | Voice · Voxtral | 30 |
| Aura-2 | `deepgram/aura-2` | Voice · Deepgram Aura-2 | 90 |
| Speech 2.8 HD | `minimax/speech-2.8-hd` | Custom Voice | — |
| Speech 2.8 Turbo | `minimax/speech-2.8-turbo` | Custom Voice | — |
| 自定义模型 | `Custom Model ID` 填写 | Custom Voice | — |

> 模型列表对应 OpenRouter [output_modalities=speech](https://openrouter.ai/models?output_modalities=speech) 的全部 12 个模型（2026-07-22 核对）。OpenAI `gpt-4o-mini-tts` 已从 OpenRouter 下架，故移除。MiniMax 两个模型接受任意音色 ID，请在 `Custom Voice` 中填写。新增模型可直接在 `Custom Model ID` 中填写 ID，并在 `Custom Voice` 里填对应音色。

## 配置

在 Bob 的插件设置中填写以下信息：

| 选项 | 说明 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key，例如 `sk-or-v1-...` |
| **API URL** | OpenRouter TTS 接口地址，默认 `https://openrouter.ai/api/v1/audio/speech`；远程地址必须使用 HTTPS，本机 loopback 调试可使用 HTTP |
| **Model** | TTS 模型，默认 `google/gemini-3.1-flash-tts-preview` |
| **Custom Model ID** | 可选。填写完整模型 ID 时，会覆盖上方预设 |
| **Voice · 各家族** | 各模型家族的音色菜单，详见上表 |
| **Custom Voice** | 可用于任意模型；非空时优先并覆盖对应的 Voice 菜单，清空后恢复菜单音色；MiniMax / 无法识别家族的自定义模型必须填写 |
| **Audio Format** | 默认 `pcm`，插件会包装成 WAV 给 Bob 播放；也可选 `wav` / `mp3` / `opus` / `flac`（需 provider 支持） |
| **PCM Sample Rate** | 返回内容按裸 PCM 包装成 WAV 时生效（通常 Audio Format 为 `pcm`），默认 `24 kHz`；若 provider 返回其他采样率的 PCM 导致播放变速，可在此调整 |
| **Speed** | 语速：0.5x ~ 2.0x，仅在非 1.0x 时发送，部分 provider 可能会忽略 |
| **Instructions / Audio Tags** | 可选。会作为前缀拼到文本前，适合填写 Gemini audio tags 或简短风格提示 |

## Voice 选择规则

`Custom Voice` 非空时具有最高优先级，可覆盖任何模型家族的菜单音色；清空后，插件会根据当前模型 ID 自动选择对应的 Voice 菜单：

| 家族 | 匹配规则 | 使用的配置项 |
| --- | --- | --- |
| Gemini | 含 `gemini` | Voice · Gemini |
| Microsoft | `microsoft/` 开头、含 `mai-voice` | Voice · Microsoft MAI |
| xAI Grok | `x-ai/` 开头、含 `grok-voice` | Voice · Grok |
| Zyphra | `zyphra/` 开头、含 `zonos` | Voice · Zyphra Zonos |
| Sesame | `sesame/` 开头、含 `csm-1b` | Voice · Sesame CSM |
| Canopy Orpheus | `canopylabs/` 开头、含 `orpheus` | Voice · Orpheus |
| Kokoro | `hexgrad/` 开头、含 `kokoro` | Voice · Kokoro |
| Voxtral | `mistralai/` 开头、含 `voxtral` | Voice · Voxtral |
| Deepgram | `deepgram/` 开头、含 `aura-2` | Voice · Deepgram Aura-2 |
| MiniMax | `minimax/` 开头、含 `speech-2.8` | Custom Voice（无预设菜单，需手动填写音色 ID） |
| 其他自定义 | 未匹配到上述任一家族 | Custom Voice（无预设菜单，需手动填写音色 ID） |

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

### Deepgram Aura-2（多语言、低延迟）

| 选项 | 值 |
| --- | --- |
| **Model** | `deepgram/aura-2` |
| **Voice · Deepgram Aura-2** | `aura-2-thalia-en`、`aura-2-zeus-en`、`aura-2-ama-ja`（日语）等 |
| **Audio Format** | `mp3` 或 `pcm` |

### MiniMax Speech 2.8（自定义音色）

| 选项 | 值 |
| --- | --- |
| **Model** | `minimax/speech-2.8-hd` 或 `minimax/speech-2.8-turbo` |
| **Custom Voice** | 填写 MiniMax 音色 ID（模型接受任意音色 ID，无预设菜单） |
| **Audio Format** | `mp3` 或 `pcm` |

`API URL` 也支持填写：

- `https://openrouter.ai`
- `https://openrouter.ai/api`
- `https://openrouter.ai/api/v1`
- `https://openrouter.ai/api/v1/audio/speech`
- `https://openrouter.ai/api/v1/tts`（legacy/custom endpoint）

远程地址必须使用 HTTPS，以免 API Key 与待合成文本明文传输。仅本机 loopback 地址（`localhost`、`127.0.0.0/8`、`[::1]`，可带端口）允许 HTTP。自动补全接口路径时会保留原有 query，并确保路径位于 query / fragment 之前。

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
- 插件优先根据 inline audio / HTTP `Content-Type` 判断响应，明确拒绝 JSON、文本及其他非音频 MIME。明确请求或声明为 PCM 时，MP3 嗅探不会覆盖 PCM 判定；其他响应再用严格校验的 magic bytes 识别 WAV / MP3 / Ogg / FLAC。按裸 PCM 处理的内容会被包装成 16-bit、mono WAV，采样率默认 24kHz，可在 PCM Sample Rate 选项中调整。
- 如果选择 `mp3` / `wav` 等格式但当前 provider 不支持，OpenRouter 可能会返回错误或退回到默认格式。
- `Speed` 仅在非 1.0x 时随请求发送，以兼容不支持该参数的模型。
- 单次响应上限为 64 MiB；插件使用 Bob 1.8+ 的流式接口累计接收，超过上限会立即取消并报错。若安全流式接口不可用，插件会要求升级 Bob，不会退回到先完整缓冲的请求方式。
- 裸 PCM 直接以 Bob 原生二进制数据拼接 44-byte WAV 头，最后只做一次原生 base64 转换，避免旧转换链同时保留多份大音频副本。
- 内存缓存最多保留 10 条、TTL 为 30 分钟；单条 base64 输出超过 3 MiB 时不缓存。缓存键包含 API Key 作用域、接口、模型、音色、格式、语速、PCM 采样率、语言与文本等参数，但仅保留 SHA-256 摘要，不保留这些字段的明文；切换采样率或凭据不会复用旧结果，空闲条目也会由计时器主动过期。

## 支持的语言

自动、中文（简/繁）、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、葡萄牙语（巴西）、俄语、阿拉伯语、泰语、越南语、印尼语、马来语、土耳其语、波兰语、荷兰语、瑞典语、丹麦语、挪威语、芬兰语、希腊语、捷克语、罗马尼亚语、匈牙利语、斯洛伐克语、乌克兰语、保加利亚语、克罗地亚语、印地语、孟加拉语、泰米尔语、泰卢固语、马拉雅拉姆语、希伯来语、菲律宾语。

> 各模型实际支持的语言不同（例如 Kokoro / MAI-Voice-2 / Voxtral / Deepgram Aura-2 为多语言，Zonos / Orpheus 主要为英语），请按所选模型挑选合适的音色。

## 开发

插件由两个核心文件组成：

- `info.json` — 插件元信息与配置项定义
- `main.js` — TTS 调用逻辑

构建 `.bobplugin` 文件：

```bash
zip -j openrouter-tts.bobplugin info.json main.js
```

运行回归测试：

```bash
npm test
```

## Changelog

- **1.2.2** — 修正 JSON / rawData / MIME 音频判别；PCM 采样率与 API Key 作用域纳入 SHA-256 缓存键，并主动清理过期缓存；Custom Voice 可覆盖所有模型家族；远程自定义接口强制 HTTPS（loopback 调试除外）；API URL 补路径时正确保留 query / fragment；修正 Bob 巴西葡萄牙语代码为 `pt-br`；以流式累计实现 64 MiB 响应上限，移除不安全的完整缓冲回退，并用 Bob 原生二进制数据低内存包装 WAV；MP3 裸帧需连续有效帧才判定，且明确 PCM 时不采用 MP3 嗅探，避免误报。
- **1.2.1** — 深度代码检查修复：custom/MiniMax 家族未填音色时明确报错（不再静默回退 Gemini 音色 Kore）；`pcmToWav` 采样率可配置（新增 PCM Sample Rate 选项，默认 24kHz）；`pluginValidate` 使用用户配置的格式而非硬编码 pcm；RIFF 嗅探额外校验 WAVE 标识；音频缓存增加 30 分钟 TTL；收紧 `csm` 子串匹配避免误判；`instructions` 计入 4096 字符长度限制；超时缓冲从 5s 放宽到 15s；处理异常不再把原始报错回传给用户；移除 customVoice 的无效顶层字段。
- **1.2.0** — 同步 OpenRouter speech 模型目录（2026-07-22）：移除已下架的 OpenAI `gpt-4o-mini-tts`；新增 Deepgram Aura-2（90 音色）、MiniMax Speech 2.8 HD / Turbo（自定义音色）。
- **1.1.0** — 接入 OpenRouter 全部 speech-output 模型，每个模型独立音色菜单；按返回音频 magic bytes 自动识别格式。
- **1.0.1** — 区分 Gemini TTS 与 OpenAI TTS 的 voice 选择，增加自定义 voice。

## License

MIT
