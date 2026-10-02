# Bob Plugin - OpenRouter TTS

[Bob](https://bobtranslate.com/) 的 OpenRouter TTS 语音合成插件，默认使用 `google/gemini-3.1-flash-tts-preview`，并内置 OpenRouter 上**全部 speech-output 模型**与各自的音色列表。

## 安装

1. 从 [GitHub Releases](https://github.com/poyih/bob-plugin-openrouter-tts/releases/latest) 下载最新的 `openrouter-tts-版本号.bobplugin`
2. 双击文件即可安装到 Bob

## 支持的模型

<!-- BEGIN GENERATED MODELS -->
每个模型使用对应的 Voice 菜单；Custom Voice 可覆盖菜单。所有菜单会在 Bob 设置中同时显示。

| 模型 | OpenRouter ID | Voice 菜单 | 音色数 | Auto 格式 |
| --- | --- | --- | --- | --- |
| Gemini 3.1 Flash TTS Preview (Google) | `google/gemini-3.1-flash-tts-preview` | Voice · Gemini | 30 | pcm |
| Gemini 3.8 Flash TTS (Google) | `google/gemini-3.8-flash-tts` | Voice · Gemini | 30 | pcm |
| Gemini 3.8 Flash Lite TTS (Google) | `google/gemini-3.8-flash-lite-tts` | Voice · Gemini | 30 | pcm |
| MAI-Voice-2 (Microsoft) | `microsoft/mai-voice-2` | Voice · Microsoft MAI | 4 | pcm |
| MAI-Voice-2-Flash (Microsoft) | `microsoft/mai-voice-2-flash` | Voice · Microsoft MAI | 4 | pcm |
| MAI-Voice-2.1 (Microsoft) | `microsoft/mai-voice-2.1` | Voice · Microsoft MAI 2.1 | 97 | pcm |
| MAI-Voice-2.1-Flash (Microsoft) | `microsoft/mai-voice-2.1-flash` | Voice · Microsoft MAI 2.1 Flash | 97 | pcm |
| Grok Voice TTS 1.0 (xAI) | `x-ai/grok-voice-tts-1.0` | Voice · Grok | 5 | pcm |
| CSM 1B (Sesame) | `sesame/csm-1b` | Voice · Sesame CSM | 7 | pcm |
| Orpheus 3B (Canopy Labs) | `canopylabs/orpheus-3b-0.1-ft` | Voice · Orpheus | 7 | pcm |
| Kokoro 82M (hexgrad) | `hexgrad/kokoro-82m` | Voice · Kokoro | 54 | pcm |
| Voxtral Mini TTS (Mistral) | `mistralai/voxtral-mini-tts-2603` | Voice · Voxtral | 30 | mp3 |
| Aura-2 (Deepgram) | `deepgram/aura-2` | Voice · Deepgram Aura-2 | 90 | pcm |
| Flux TTS (Deepgram·免费) | `deepgram/flux-tts:free` | Voice · Deepgram Flux | 36 | pcm |
| Speech 2.8 HD (MiniMax) | `minimax/speech-2.8-hd` | Voice · MiniMax | 45 | pcm |
| Speech 2.8 Turbo (MiniMax) | `minimax/speech-2.8-turbo` | Voice · MiniMax | 45 | pcm |
| S1 (Fish Audio) | `fish-audio/s1` | Voice · Fish Audio | 2 + 默认 | pcm |
| S2 Pro (Fish Audio) | `fish-audio/s2-pro` | Voice · Fish Audio | 2 + 默认 | pcm |
| S2.1 Pro (Fish Audio) | `fish-audio/s2.1-pro` | Voice · Fish Audio | 2 + 默认 | pcm |
| S2.1 Pro Free (Fish Audio·免费) | `fish-audio/s2.1-pro-free:free` | Voice · Fish Audio | 2 + 默认 | pcm |
| Qwen-Audio-3.0-TTS Flash (Qwen) | `qwen/qwen-audio-3.0-tts-flash` | Voice · Qwen Flash | 2 | pcm |
| Qwen-Audio-3.0-TTS Plus (Qwen) | `qwen/qwen-audio-3.0-tts-plus` | Voice · Qwen Plus | 2 | pcm |
| Seed Audio 1.0 (ByteDance) | `bytedance-seed/seed-audio-1-0` | Custom Voice（可留空） | 默认 / speaker ID | mp3 |

目录于 2026-10-02 与 [OpenRouter speech 模型 API](https://openrouter.ai/api/v1/models?output_modalities=speech) 核对，共 23 个模型。模型可用性会变化；发布前运行 `python3 scripts/check_catalog.py` 检查目录漂移。

MiniMax 接受菜单之外的音色 ID。Fish Audio 的菜单是社区 reference ID，不属于官方固定音色列表。Seed 根据输入描述生成音频，Custom Voice 可留空；单次输入最多 3000 字符。Microsoft MAI 2、2.1 和 2.1 Flash 使用不同的 Voice 菜单。
<!-- END GENERATED MODELS -->

## 配置

在 Bob 的插件设置中填写以下信息：

| 选项 | 说明 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key，例如 `sk-or-v1-...` |
| **API URL** | OpenRouter TTS 接口地址，默认 `https://openrouter.ai/api/v1/audio/speech`；远程地址必须使用 HTTPS，本机 loopback 调试可使用 HTTP |
| **Model** | TTS 模型，默认 `google/gemini-3.1-flash-tts-preview` |
| **Custom Model ID** | 可选。填写完整模型 ID 时，会覆盖上方预设 |
| **Voice · 各家族** | 各模型家族的音色菜单，详见上表 |
| **Custom Voice** | 非空时覆盖菜单，清空后恢复默认音色；未知家族的自定义模型需要填写。Fish Audio 可填 reference ID，Seed 可填 speaker ID 或留空 |
| **Audio Format** | 默认 `Auto`：Voxtral / Seed 使用 `mp3`，其余使用 `pcm` 并包装为 WAV。已保存的显式 `pcm` 设置不会自动改成 Auto；Voxtral 请手动选 Auto / MP3。`wav` / `opus` / `flac` 供支持这些格式的自定义接口使用 |
| **PCM Sample Rate** | 默认 `Auto` 优先读取响应的 `rate`；缺失时按模型家族回退（Fish Audio 44.1 kHz、其他 24 kHz）。手动值覆盖响应采样率，声道数按响应 `channels`（缺失时 1）包装 |
| **Speed** | 语速：0.5x ~ 2.0x，仅在非 1.0x 时发送，部分 provider 可能会忽略 |
| **Instructions / Audio Tags** | 可选。Gemini 3.8 单独传递风格提示；其他模型作为文本前缀。验证按钮使用同一配置 |

## Voice 选择规则

<!-- BEGIN GENERATED VOICE RULES -->
先按完整模型 ID 查目录，再按家族匹配。Custom Voice 非空时始终优先；清空后恢复对应菜单。

| 家族 | 使用的配置项 | 默认 PCM 采样率 |
| --- | --- | --- |
| gemini | Voice · Gemini | 24000 Hz |
| microsoft21flash | Voice · Microsoft MAI 2.1 Flash | 24000 Hz |
| microsoft21 | Voice · Microsoft MAI 2.1 | 24000 Hz |
| microsoft | Voice · Microsoft MAI | 24000 Hz |
| grok | Voice · Grok | 24000 Hz |
| sesame | Voice · Sesame CSM | 24000 Hz |
| orpheus | Voice · Orpheus | 24000 Hz |
| kokoro | Voice · Kokoro | 24000 Hz |
| voxtral | Voice · Voxtral | 24000 Hz |
| deepgramflux | Voice · Deepgram Flux | 24000 Hz |
| deepgram | Voice · Deepgram Aura-2 | 24000 Hz |
| minimax | Voice · MiniMax | 24000 Hz |
| fishaudio | Voice · Fish Audio | 44100 Hz |
| qwenplus | Voice · Qwen Plus | 24000 Hz |
| qwenflash | Voice · Qwen Flash | 24000 Hz |
| seed | Custom Voice（可留空） | 24000 Hz |

未知家族的自定义模型使用 Custom Voice；已知模型的能力、默认值和音色菜单都来自 `catalog.json`。
<!-- END GENERATED VOICE RULES -->

## OpenRouter 配置示例

### Gemini TTS（默认）

| 选项 | 值 |
| --- | --- |
| **API URL** | `https://openrouter.ai/api/v1/audio/speech` |
| **Model** | `google/gemini-3.1-flash-tts-preview`（也可选 `google/gemini-3.8-flash-tts` / `google/gemini-3.8-flash-lite-tts`，音色相同） |
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

### Deepgram Flux TTS（免费、仅英语）

| 选项 | 值 |
| --- | --- |
| **Model** | `deepgram/flux-tts:free` |
| **Voice · Deepgram Flux** | `flux-haley-en`（美式）、`flux-jack-en`（英式）、`flux-priya-en`（印度）等 |
| **Audio Format** | `pcm` 或 `mp3` |

### MiniMax Speech 2.8

| 选项 | 值 |
| --- | --- |
| **Model** | `minimax/speech-2.8-hd` 或 `minimax/speech-2.8-turbo` |
| **Voice · MiniMax** | 从 45 个预置音色中选择；可通过 Custom Voice 填写其他 MiniMax 音色 ID |
| **Audio Format** | `mp3` 或 `pcm` |

### Fish Audio S2.1 Pro（免费档可选）

| 选项 | 值 |
| --- | --- |
| **Model** | `fish-audio/s2.1-pro`（或免费的 `fish-audio/s2.1-pro-free:free`） |
| **Voice · Fish Audio** | 菜单选择，或选「默认音色」 |
| **Custom Voice** | 可选。填写任意 [fish.audio](https://fish.audio) 音色页 URL 中的 reference ID，覆盖菜单 |
| **Audio Format** | `mp3` 或 `pcm` |

`API URL` 也支持填写：

- `https://openrouter.ai`
- `https://openrouter.ai/api`
- `https://openrouter.ai/api/v1`
- `https://openrouter.ai/api/v1/audio/speech`
- `https://openrouter.ai/api/v1/tts`（legacy/custom endpoint）

远程地址必须使用 HTTPS，以免 API Key 与待合成文本明文传输。仅本机 loopback 地址（`localhost`、`127.0.0.0/8`、`[::1]`，可带端口）允许 HTTP。自动补全接口路径时会保留原有 query，并确保路径位于 query / fragment 之前。

## Audio Tags

Gemini 3.8 使用 OpenRouter 的独立风格参数，提示不会拼进需要朗读的文本；例如填写 `warm and friendly`。其他模型的 `Instructions / Audio Tags` 会作为前缀拼到待合成文本前，例如：

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

- 单次合成文本长度不能超过 4096 个字符；Seed 为 3000。文本前缀计入限制，Gemini 3.8 的独立风格提示单独限制为 4096 字符。
- 插件优先根据 inline audio / HTTP `Content-Type` 判断响应，明确拒绝 JSON、文本及其他非音频 MIME。明确请求或声明为 PCM 时，MP3 嗅探不会覆盖 PCM 判定；其他响应再用严格校验的 magic bytes 识别 WAV / MP3 / Ogg / FLAC。按裸 PCM 处理的内容会被包装成 16-bit WAV。Auto 优先读取响应 MIME 的 rate / channels；缺失时使用家族采样率和单声道，手动采样率覆盖 rate。无效元数据和不完整的多声道采样帧会报错。
- OpenRouter 标准 speech 接口支持 MP3 / PCM；Voxtral 仅支持 MP3。已知不兼容的格式会在请求前报错；自定义接口仍可使用其支持的 WAV / Opus / FLAC。
- `Speed` 仅在非 1.0x 时随请求发送；提供方可能忽略或拒绝不支持的值。验证按钮使用相同语速、格式和 Instructions，能检查这些配置错误。
- 单次响应上限为 64 MiB；插件使用 Bob 1.8+ 的流式接口累计接收，超过上限会立即取消并报错。若安全流式接口不可用，插件会要求升级 Bob，不会退回到先完整缓冲的请求方式。
- 裸 PCM 直接以 Bob 原生二进制数据拼接 44-byte WAV 头，最后只做一次原生 base64 转换，避免旧转换链同时保留多份大音频副本。
- 同一凭据代际及相同配置的并发合成请求会合并，所有调用者分别收到结果；失败后清理在途条目，下一次调用可重新请求。
- 内存缓存最多保留 10 条、TTL 为 30 分钟；单条 base64 输出超过 3 MiB 时不缓存。缓存键包含 API Key 作用域、接口、模型、音色、格式、语速、PCM 采样率、语言与文本等参数，但仅保留 SHA-256 摘要，不保留这些字段的明文；切换采样率或凭据不会复用旧结果，空闲条目也会由计时器主动过期。

## 支持的语言

自动、中文（简/繁）、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、葡萄牙语（巴西）、俄语、阿拉伯语、泰语、越南语、印尼语、马来语、土耳其语、波兰语、荷兰语、瑞典语、丹麦语、挪威语、芬兰语、希腊语、捷克语、罗马尼亚语、匈牙利语、斯洛伐克语、乌克兰语、保加利亚语、克罗地亚语、印地语、孟加拉语、泰米尔语、泰卢固语、马拉雅拉姆语、希伯来语、菲律宾语。

> 各模型实际支持的语言不同（例如 Kokoro / MAI-Voice-2 / Voxtral / Deepgram Aura-2 为多语言，Orpheus 主要为英语，Deepgram Flux 仅英语），请按所选模型挑选合适的音色。

## 开发

插件分发包仍只包含 `info.json` 和 `main.js`。模型能力、音色菜单和文档表格由 `catalog.json` 统一维护，编辑目录后运行生成器：

```bash
python3 scripts/generate_catalog.py
python3 scripts/generate_catalog.py --check
```

运行测试（Node.js 22+、Python 3.10+；无第三方依赖）：

```bash
npm test
npm run test:python
```

JavaScript 测试包含音频元数据、格式限制、缓存、异步请求合并和流式取消；Python 测试使用临时 Git 仓库验证打包、版本排序、主分支推进时的 appcast 重试，以及用户工作区的保留。

核对 OpenRouter 实时模型目录和官方固定音色列表：

```bash
python3 scripts/check_catalog.py
# 也可以读取已保存的 API JSON，在离线环境中核对
python3 scripts/check_catalog.py --snapshot /path/to/models.json
```

这项检查只访问公开目录，不调用合成接口。普通提交 / PR 的 CI 离线检查生成文件并运行全部测试；tag 发布额外检查实时目录。CI 固定 Node.js 24 和 Python 3.12。

本地构建 `.bobplugin` 文件（固定 ZIP 条目顺序、时间戳和权限，输出到 `dist/`）：

```bash
python3 scripts/release.py --version 1.5.0 --no-appcast
```

除了安装包和 Release 说明，构建还会生成 `dist/appcast-entry.json`，其中的 checksum、下载地址和时间戳在发布重试时保持不变。

## 发布

1. 更新 `info.json` 版本号（或使用 `--prepare-version`），在 Changelog 加入版本说明；生成目录并运行测试，提交并推送到 `main`。
2. 给该提交打 tag，例如 `git tag v1.5.0 && git push origin v1.5.0`。
3. Actions 从 tag 检出源码，检查生成文件和实时目录、运行全部测试，再构建安装包和固定的版本记录。
4. 安装包上传成功后，`publish_appcast.py` 从最新默认分支创建临时 worktree，合并版本记录并提交。若分支在推送前又有更新，最多重新获取并合并三次；包不会被重新构建，已有版本记录会保留。

发布任务使用 `queue: max` 顺序等待，最多保留 100 个等待任务，连续打多个 tag 时不会替换已有的等待任务。发布脚本不会切换或重置调用目录中的分支和未提交文件；失败会清理临时 worktree，并让 Actions 明确报错。

## Changelog

- **1.5.0** — 修复 PCM 响应采样率 / 声道数与空白前缀误判；新增 Auto 格式、同配置并发请求合并及真实配置验证；统一模型目录并补齐 23 个 speech 模型和 MiniMax / Microsoft 2.1 音色；新增普通提交 / PR CI、实时目录检查和保留版本记录的 appcast 发布重试。
- **1.4.0** — 同步 OpenRouter speech 模型目录（2026-09-25）：新增 Google Gemini 3.8 Flash TTS / Flash Lite TTS（复用 `Voice · Gemini` 菜单，Voice Design / Replication 的 `voice_...` ID 可填 Custom Voice）、Deepgram Flux TTS 免费档（新增 `Voice · Deepgram Flux` 菜单，36 个英语音色，默认 `flux-haley-en`）；移除已下架的 Zyphra Zonos v0.1 Transformer / Hybrid 预设及 `Voice · Zyphra Zonos` 菜单（OpenRouter 已无可用 endpoint）；共 20 个模型（2026-09-25 以实时 API 复核）。
- **1.3.2** — PCM Sample Rate 新增 `Auto` 默认档：按模型家族选择包装采样率（Fish Audio 44.1kHz、其他 24kHz），修复 Fish Audio 模型在 `pcm` 格式下声音低沉拖沓（44.1kHz PCM 被按 24kHz 包装导致慢放）；显式选择采样率的行为不变。
- **1.3.1** — 新增 `Voice · Fish Audio` 菜单：收录常用 fish.audio 社区音色 reference ID（AD学姐、女大学生），并提供「默认音色」选项（不发送 voice）；Custom Voice 仍可填任意 reference ID 覆盖。
- **1.3.0** — 同步 OpenRouter speech 模型目录（2026-08-01）：新增 Fish Audio S1 / S2 Pro / S2.1 Pro / S2.1 Pro Free（无预设音色，`Custom Voice` 留空时不发送 voice、使用 provider 默认音色，也可填 reference ID）、Microsoft MAI-Voice-2-Flash（复用 MAI 音色菜单）、Qwen-Audio-3.0-TTS Flash / Plus（各自独立音色菜单）。
- **1.2.4** — 修复 Bob 1.20 的流式 `$data` 对象不暴露 `length` / `byteLength` 时正常音频被误判为长度无效；以单次分块 base64 计算字节数，并在后续 JSON 识别、格式嗅探和 WAV 包装中复用已知长度。
- **1.2.3** — 兼容 JavaScriptCore 将 `$data.length` 以原生桥接数值而非普通 JavaScript `number` 暴露的情况。
- **1.2.2** — 修正 JSON / rawData / MIME 音频判别；PCM 采样率与 API Key 作用域纳入 SHA-256 缓存键，并主动清理过期缓存；Custom Voice 可覆盖所有模型家族；远程自定义接口强制 HTTPS（loopback 调试除外）；API URL 补路径时正确保留 query / fragment；修正 Bob 巴西葡萄牙语代码为 `pt-br`；以流式累计实现 64 MiB 响应上限，移除不安全的完整缓冲回退，并用 Bob 原生二进制数据低内存包装 WAV；MP3 裸帧需连续有效帧才判定，且明确 PCM 时不采用 MP3 嗅探，避免误报。
- **1.2.1** — 深度代码检查修复：custom/MiniMax 家族未填音色时明确报错（不再静默回退 Gemini 音色 Kore）；`pcmToWav` 采样率可配置（新增 PCM Sample Rate 选项，默认 24kHz）；`pluginValidate` 使用用户配置的格式而非硬编码 pcm；RIFF 嗅探额外校验 WAVE 标识；音频缓存增加 30 分钟 TTL；收紧 `csm` 子串匹配避免误判；`instructions` 计入 4096 字符长度限制；超时缓冲从 5s 放宽到 15s；处理异常不再把原始报错回传给用户；移除 customVoice 的无效顶层字段。
- **1.2.0** — 同步 OpenRouter speech 模型目录（2026-07-22）：移除已下架的 OpenAI `gpt-4o-mini-tts`；新增 Deepgram Aura-2（90 音色）、MiniMax Speech 2.8 HD / Turbo（自定义音色）。
- **1.1.0** — 接入 OpenRouter 全部 speech-output 模型，每个模型独立音色菜单；按返回音频 magic bytes 自动识别格式。
- **1.0.1** — 区分 Gemini TTS 与 OpenAI TTS 的 voice 选择，增加自定义 voice。

## License

MIT
