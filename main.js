var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var LOG_PREFIX = '[bob-plugin-openrouter-tts]';
var REQUEST_COUNTER = 0;
var PLUGIN_TIMEOUT_INTERVAL = 120;
var TTS_REQUEST_TIMEOUT_INTERVAL = 115;
var VALIDATION_TIMEOUT_INTERVAL = 30;
var MAX_TEXT_LENGTH = 4096;
var CACHE_MAX_ENTRIES = 10;
var CACHE_MAX_VALUE_CHARS = 3 * 1024 * 1024;
var DEFAULT_API_URL = 'https://openrouter.ai/api/v1/audio/speech';
var DEFAULT_MODEL = 'google/gemini-3.1-flash-tts-preview';
var VOICE_OPTION_BY_FAMILY = {
    gemini: 'voiceGemini',
    openai: 'voiceOpenAI',
    microsoft: 'voiceMicrosoft',
    grok: 'voiceGrok',
    zyphra: 'voiceZyphra',
    sesame: 'voiceSesame',
    orpheus: 'voiceOrpheus',
    kokoro: 'voiceKokoro',
    voxtral: 'voiceVoxtral'
};
var DEFAULT_VOICE_BY_FAMILY = {
    gemini: 'Kore',
    openai: 'marin',
    microsoft: 'en-US-Harper:MAI-Voice-2',
    grok: 'eve',
    zyphra: 'american_female',
    sesame: 'conversational_a',
    orpheus: 'tara',
    kokoro: 'af_heart',
    voxtral: 'en_paul_neutral'
};
var AUDIO_CACHE = {};
var AUDIO_CACHE_ORDER = [];

function nowMs() {
    return new Date().getTime();
}

function nextRequestId() {
    REQUEST_COUNTER += 1;
    return REQUEST_COUNTER;
}

function sanitizeLogValue(value) {
    var str = value == null ? '' : String(value);
    str = str.replace(/\s+/g, ' ').trim();
    if (str.length > 200) {
        return str.substring(0, 197) + '...';
    }
    return str;
}

function logInfo(message) {
    $log.info(LOG_PREFIX + ' ' + message);
}

function logError(message) {
    $log.error(LOG_PREFIX + ' ' + message);
}

function logTtsInfo(requestId, stage, message) {
    logInfo('[tts#' + requestId + '] ' + stage + ' ' + message);
}

function logTtsError(requestId, stage, message) {
    logError('[tts#' + requestId + '] ' + stage + ' ' + message);
}

function supportLanguages() {
    return [
        'auto', 'zh-Hans', 'zh-Hant', 'en', 'ja', 'ko',
        'fr', 'de', 'es', 'it', 'pt', 'pt-BR', 'ru',
        'ar', 'th', 'vi', 'id', 'ms', 'tr', 'pl',
        'nl', 'sv', 'da', 'nb', 'fi', 'el', 'cs',
        'ro', 'hu', 'sk', 'uk', 'bg', 'hr', 'hi',
        'bn', 'ta', 'te', 'ml', 'he', 'fil'
    ];
}

function pluginTimeoutInterval() {
    return PLUGIN_TIMEOUT_INTERVAL;
}

function readOption(name) {
    var value = $option[name];
    return value == null ? '' : String(value).trim();
}

function getModel() {
    var customModel = readOption('customModel');
    if (customModel) {
        return customModel;
    }

    var preset = readOption('model') || DEFAULT_MODEL;
    return preset === 'custom' ? '' : preset;
}

function getModelFamily(model) {
    var value = String(model || '').toLowerCase();

    if (value.indexOf('gemini') !== -1) {
        return 'gemini';
    }
    if (value.indexOf('openai/') === 0 ||
        value.indexOf('gpt-4o-mini-tts') !== -1 ||
        value.indexOf('tts-1') === 0) {
        return 'openai';
    }
    if (value.indexOf('microsoft/') === 0 || value.indexOf('mai-voice') !== -1) {
        return 'microsoft';
    }
    if (value.indexOf('x-ai/') === 0 || value.indexOf('grok-voice') !== -1) {
        return 'grok';
    }
    if (value.indexOf('zyphra/') === 0 || value.indexOf('zonos') !== -1) {
        return 'zyphra';
    }
    if (value.indexOf('sesame/') === 0 || value.indexOf('csm') !== -1) {
        return 'sesame';
    }
    if (value.indexOf('canopylabs/') === 0 || value.indexOf('orpheus') !== -1) {
        return 'orpheus';
    }
    if (value.indexOf('hexgrad/') === 0 || value.indexOf('kokoro') !== -1) {
        return 'kokoro';
    }
    if (value.indexOf('mistralai/') === 0 || value.indexOf('voxtral') !== -1) {
        return 'voxtral';
    }

    return 'custom';
}

function getVoice() {
    var family = getModelFamily(getModel());
    var customVoice = readOption('customVoice');

    if (family === 'custom') {
        return customVoice || readOption('voiceGemini') || DEFAULT_VOICE_BY_FAMILY.gemini;
    }

    return readOption(VOICE_OPTION_BY_FAMILY[family]) || customVoice || DEFAULT_VOICE_BY_FAMILY[family];
}

function getResponseFormat() {
    return readOption('responseFormat') || 'pcm';
}

function getSpeed() {
    var speed = parseFloat(readOption('speed'));
    return isNaN(speed) ? 1.0 : speed;
}

function isOpenRouterBaseUrl(base) {
    return /^https?:\/\/(?:[^\/]+\.)?openrouter\.ai(?:\/|$)/i.test(base);
}

function getApiUrl() {
    var base = readOption('apiUrl') || DEFAULT_API_URL;
    base = base.replace(/\/+$/, '');

    if (/\/audio\/speech$/i.test(base) || /\/tts$/i.test(base)) {
        return base;
    }
    if (/\/api\/v1$/i.test(base)) {
        return base + '/audio/speech';
    }
    if (/\/api$/i.test(base)) {
        return base + '/v1/audio/speech';
    }
    if (/\/v1$/i.test(base)) {
        return base + '/audio/speech';
    }
    if (isOpenRouterBaseUrl(base)) {
        return base + '/api/v1/audio/speech';
    }
    return base + '/api/v1/audio/speech';
}

function validateOptions() {
    if (!readOption('apiKey')) {
        return { type: 'param', message: '请先在插件设置中填写 OpenRouter API Key。' };
    }
    if (!getModel()) {
        return { type: 'param', message: '请先填写 OpenRouter TTS 模型 ID。' };
    }
    if (!getVoice()) {
        return { type: 'param', message: '请先在插件设置中选择音色。' };
    }
    return null;
}

function makeCacheKey(text, lang, apiUrl, model, voice, instructions, format, speed) {
    return [
        apiUrl,
        model,
        voice,
        instructions,
        format,
        String(speed),
        lang || '',
        text || ''
    ].join('');
}

function touchCacheKey(key) {
    var index = AUDIO_CACHE_ORDER.indexOf(key);
    if (index !== -1) {
        AUDIO_CACHE_ORDER.splice(index, 1);
    }
    AUDIO_CACHE_ORDER.push(key);
}

function deleteCacheKey(key) {
    delete AUDIO_CACHE[key];
    var index = AUDIO_CACHE_ORDER.indexOf(key);
    if (index !== -1) {
        AUDIO_CACHE_ORDER.splice(index, 1);
    }
}

function trimAudioCache() {
    while (AUDIO_CACHE_ORDER.length > CACHE_MAX_ENTRIES) {
        deleteCacheKey(AUDIO_CACHE_ORDER[0]);
    }
}

function getCachedAudioResult(key) {
    var entry = AUDIO_CACHE[key];
    if (!entry) {
        return null;
    }
    touchCacheKey(key);
    return entry;
}

function setCachedAudioResult(key, result) {
    if (!result || !result.value || result.value.length > CACHE_MAX_VALUE_CHARS) {
        return false;
    }

    AUDIO_CACHE[key] = {
        result: result,
        storedAt: nowMs()
    };
    touchCacheKey(key);
    trimAudioCache();
    return true;
}

function createTtsResult(audioBase64, model, voice, outputFormat, sourceFormat, cacheStatus) {
    return {
        type: 'base64',
        value: audioBase64,
        raw: {
            model: model,
            voice: voice,
            format: outputFormat,
            sourceFormat: sourceFormat,
            cache: cacheStatus
        }
    };
}

function base64Decode(base64) {
    var str = String(base64 || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '').replace(/=+$/, '');
    var len = str.length;
    var byteLen = (len * 3) >> 2;
    var bytes = new Uint8Array(byteLen);
    var p = 0;

    for (var i = 0; i < len; i += 4) {
        var a = BASE64_CHARS.indexOf(str.charAt(i));
        var b = BASE64_CHARS.indexOf(str.charAt(i + 1));
        var c = BASE64_CHARS.indexOf(str.charAt(i + 2));
        var d = BASE64_CHARS.indexOf(str.charAt(i + 3));

        bytes[p++] = (a << 2) | (b >> 4);
        if (c !== -1) bytes[p++] = ((b & 0x0f) << 4) | (c >> 2);
        if (d !== -1) bytes[p++] = ((c & 0x03) << 6) | d;
    }

    return bytes;
}

function base64Encode(bytes) {
    var len = bytes.length;
    var result = '';

    for (var i = 0; i < len; i += 3) {
        var a = bytes[i];
        var b = i + 1 < len ? bytes[i + 1] : 0;
        var c = i + 2 < len ? bytes[i + 2] : 0;

        result += BASE64_CHARS.charAt(a >> 2);
        result += BASE64_CHARS.charAt(((a & 0x03) << 4) | (b >> 4));
        result += i + 1 < len ? BASE64_CHARS.charAt(((b & 0x0f) << 2) | (c >> 6)) : '=';
        result += i + 2 < len ? BASE64_CHARS.charAt(c & 0x3f) : '=';
    }

    return result;
}

function writeString(view, offset, str) {
    for (var i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

function pcmToWav(pcmBase64) {
    var pcmData = base64Decode(pcmBase64);
    var pcmLen = pcmData.length;
    var sampleRate = 24000;
    var numChannels = 1;
    var bitsPerSample = 16;
    var byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    var blockAlign = numChannels * (bitsPerSample / 8);
    var wavLen = 44 + pcmLen;
    var buffer = new ArrayBuffer(wavLen);
    var view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, wavLen - 8, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcmLen, true);

    var wavBytes = new Uint8Array(buffer);
    wavBytes.set(pcmData, 44);

    return base64Encode(wavBytes);
}

function buildInputText(text, instructions) {
    return instructions ? instructions + ' ' + text : text;
}

function buildSpeechRequestBody(inputText, model, voice, format, speed) {
    var body = {
        model: model,
        input: inputText,
        voice: voice,
        response_format: format
    };
    if (typeof speed === 'number' && !isNaN(speed) && speed !== 1.0) {
        body.speed = speed;
    }
    return body;
}

function getApiErrorMessage(resp) {
    var data = resp && resp.data;
    if (data && data.error) {
        if (data.error.message) {
            return data.error.message;
        }
        return JSON.stringify(data.error);
    }
    if (typeof data === 'string') {
        return data;
    }
    return '';
}

function parseHttpError(resp) {
    var statusCode = resp.response ? resp.response.statusCode : 0;
    var message = getApiErrorMessage(resp);

    if (statusCode === 400) {
        return { type: 'api', message: message || '请求参数错误', addition: '状态码: 400' };
    }
    if (statusCode === 401 || statusCode === 403) {
        return { type: 'api', message: 'OpenRouter API Key 无效或无权限', addition: message || '状态码: ' + statusCode };
    }
    if (statusCode === 402) {
        return { type: 'api', message: 'OpenRouter 余额不足或需要付费', addition: message || '状态码: 402' };
    }
    if (statusCode === 404) {
        return { type: 'api', message: 'OpenRouter TTS 接口或模型不存在', addition: message || '状态码: 404' };
    }
    if (statusCode === 429) {
        return { type: 'api', message: '请求过于频繁，请稍后再试', addition: message || '状态码: 429' };
    }
    if (statusCode >= 500) {
        return { type: 'api', message: 'OpenRouter 或模型提供方暂时不可用，请稍后再试', addition: message || '状态码: ' + statusCode };
    }
    if (message) {
        return { type: 'api', message: message, addition: '状态码: ' + statusCode };
    }

    return { type: 'api', message: '请求失败，状态码: ' + statusCode };
}

function toServiceError(error) {
    var message = '网络请求异常';
    if (error) {
        if (typeof error === 'string') {
            message = error;
        } else if (error.localizedDescription) {
            message = error.localizedDescription;
        } else if (error.message) {
            message = error.message;
        }
    }
    return { type: 'network', message: message };
}

function getInlineAudioData(resp) {
    var data = resp && resp.data;
    var candidates = data && data.candidates;
    if (!candidates || !candidates.length) {
        return null;
    }

    for (var i = 0; i < candidates.length; i++) {
        var content = candidates[i] && candidates[i].content;
        var parts = content && content.parts;
        if (!parts || !parts.length) {
            continue;
        }
        for (var j = 0; j < parts.length; j++) {
            var inlineData = parts[j] && parts[j].inlineData;
            if (inlineData && inlineData.data) {
                return {
                    data: inlineData.data,
                    mimeType: inlineData.mimeType || ''
                };
            }
        }
    }

    return null;
}

function responseHasAudio(resp) {
    return !!(resp && (resp.rawData || getInlineAudioData(resp)));
}

function decodeBase64Prefix(base64, byteCount) {
    var clean = String(base64 || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
    var charsNeeded = Math.ceil((byteCount + 2) / 3) * 4;
    return base64Decode(clean.substring(0, charsNeeded));
}

function sniffAudioContainer(bytes) {
    if (!bytes || bytes.length < 4) {
        return '';
    }
    var b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];

    if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
        return 'wav';
    }
    if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
        return 'ogg';
    }
    if (b0 === 0x66 && b1 === 0x4C && b2 === 0x61 && b3 === 0x43) {
        return 'flac';
    }
    if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) {
        return 'mp3';
    }
    if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) {
        return 'mp3';
    }

    return '';
}

function mimeTypeToContainer(mimeType) {
    var lower = String(mimeType || '').toLowerCase();
    if (lower.indexOf('wav') !== -1) {
        return 'wav';
    }
    if (lower.indexOf('mpeg') !== -1 || lower.indexOf('mp3') !== -1) {
        return 'mp3';
    }
    if (lower.indexOf('ogg') !== -1 || lower.indexOf('opus') !== -1) {
        return 'ogg';
    }
    if (lower.indexOf('flac') !== -1) {
        return 'flac';
    }
    if (lower.indexOf('aac') !== -1) {
        return 'aac';
    }
    return '';
}

function processAudioBase64(audioBase64, format, mimeType) {
    var lowerMimeType = String(mimeType || '').toLowerCase();

    var declaredContainer = mimeTypeToContainer(lowerMimeType);
    if (declaredContainer) {
        return { value: audioBase64, outputFormat: declaredContainer };
    }

    var sniffedContainer = sniffAudioContainer(decodeBase64Prefix(audioBase64, 4));
    if (sniffedContainer) {
        return { value: audioBase64, outputFormat: sniffedContainer };
    }

    if (String(format || '').toLowerCase() === 'pcm' ||
        lowerMimeType.indexOf('pcm') !== -1 ||
        lowerMimeType.indexOf('l16') !== -1) {
        return { value: pcmToWav(audioBase64), outputFormat: 'wav' };
    }

    return { value: audioBase64, outputFormat: format || 'audio' };
}

function pluginValidate(completion) {
    var error = validateOptions();
    if (error) {
        completion({ error: error });
        return;
    }

    var apiKey = readOption('apiKey');
    var model = getModel();
    var voice = getVoice();
    var apiUrl = getApiUrl();

    $http.request({
        method: 'POST',
        url: apiUrl,
        header: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: buildSpeechRequestBody('Hi', model, voice, 'pcm', 1.0),
        timeout: VALIDATION_TIMEOUT_INTERVAL,
        handler: function(resp) {
            if (resp.error) {
                completion({ error: toServiceError(resp.error) });
                return;
            }

            var statusCode = resp.response ? resp.response.statusCode : 0;
            if (statusCode && (statusCode < 200 || statusCode >= 300)) {
                completion({ error: parseHttpError(resp) });
                return;
            }

            if (!responseHasAudio(resp)) {
                completion({ error: { type: 'api', message: 'OpenRouter TTS 服务没有返回音频数据。' } });
                return;
            }

            completion({ result: true });
        }
    });
}

function tts(query, completion) {
    var validationError = validateOptions();
    if (validationError) {
        completion({ error: validationError });
        return;
    }

    if (!query || !query.text || !String(query.text).trim()) {
        completion({ error: { type: 'param', message: '待合成文本不能为空。' } });
        return;
    }

    var text = String(query.text).trim();
    if (text.length > MAX_TEXT_LENGTH) {
        completion({
            error: {
                type: 'param',
                message: '文本超出 ' + MAX_TEXT_LENGTH + ' 字符限制（当前 ' + text.length + ' 字符）。'
            }
        });
        return;
    }

    var apiKey = readOption('apiKey');
    var model = getModel();
    var voice = getVoice();
    var format = getResponseFormat();
    var speed = getSpeed();
    var instructions = readOption('instructions');
    var inputText = buildInputText(text, instructions);
    var apiUrl = getApiUrl();
    var requestId = nextRequestId();
    var requestStartedAt = nowMs();
    var cacheKey = makeCacheKey(text, query.lang, apiUrl, model, voice, instructions, format, speed);
    var cachedEntry = getCachedAudioResult(cacheKey);

    if (cachedEntry) {
        var cachedResult = createTtsResult(
            cachedEntry.result.value,
            model,
            voice,
            cachedEntry.result.raw.format,
            cachedEntry.result.raw.sourceFormat,
            'hit'
        );
        logTtsInfo(
            requestId,
            'cache_hit',
            'total_ms=' + (nowMs() - requestStartedAt) +
            ' age_ms=' + (nowMs() - cachedEntry.storedAt) +
            ' audio_base64_chars=' + cachedEntry.result.value.length
        );
        completion({ result: cachedResult });
        return;
    }

    logTtsInfo(
        requestId,
        'start',
        'chars=' + text.length +
        ' payload_chars=' + inputText.length +
        ' instructions=' + (instructions ? 'on' : 'off') +
        ' model=' + model +
        ' voice=' + voice +
        ' format=' + format
    );

    $http.request({
        method: 'POST',
        url: apiUrl,
        header: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: buildSpeechRequestBody(inputText, model, voice, format, speed),
        timeout: TTS_REQUEST_TIMEOUT_INTERVAL,
        handler: function(resp) {
            var requestElapsedMs = nowMs() - requestStartedAt;

            if (resp.error) {
                logTtsError(requestId, 'network_error', 'request_ms=' + requestElapsedMs + ' message=' + sanitizeLogValue(resp.error.message || resp.error));
                completion({ error: toServiceError(resp.error) });
                return;
            }

            var statusCode = resp.response ? resp.response.statusCode : 0;
            if (statusCode && (statusCode < 200 || statusCode >= 300)) {
                var httpError = parseHttpError(resp);
                logTtsError(requestId, 'http_error', 'request_ms=' + requestElapsedMs + ' status=' + statusCode + ' message=' + sanitizeLogValue(httpError.message + ' ' + (httpError.addition || '')));
                completion({ error: httpError });
                return;
            }

            try {
                var rawAudioBase64 = '';
                var sourceMimeType = '';
                if (resp.rawData) {
                    rawAudioBase64 = resp.rawData.toBase64();
                } else {
                    var inlineAudio = getInlineAudioData(resp);
                    if (inlineAudio) {
                        rawAudioBase64 = inlineAudio.data;
                        sourceMimeType = inlineAudio.mimeType;
                    }
                }

                if (!rawAudioBase64) {
                    logTtsError(requestId, 'invalid_response', 'request_ms=' + requestElapsedMs + ' reason=missing_audio_data');
                    completion({ error: { type: 'api', message: 'OpenRouter TTS 服务没有返回音频数据。' } });
                    return;
                }

                var convertStartedAt = nowMs();
                var processed = processAudioBase64(rawAudioBase64, format, sourceMimeType);
                var convertElapsedMs = nowMs() - convertStartedAt;
                var totalElapsedMs = nowMs() - requestStartedAt;
                var result = createTtsResult(processed.value, model, voice, processed.outputFormat, format, 'miss');
                var cacheStored = setCachedAudioResult(cacheKey, result);

                logTtsInfo(
                    requestId,
                    'success',
                    'status=' + statusCode +
                    ' request_ms=' + requestElapsedMs +
                    ' convert_ms=' + convertElapsedMs +
                    ' total_ms=' + totalElapsedMs +
                    ' cache_store=' + (cacheStored ? 'yes' : 'no') +
                    ' source_base64_chars=' + rawAudioBase64.length +
                    ' output_base64_chars=' + processed.value.length
                );

                completion({ result: result });
            } catch (e) {
                logTtsError(requestId, 'processing_error', 'request_ms=' + requestElapsedMs + ' total_ms=' + (nowMs() - requestStartedAt) + ' message=' + sanitizeLogValue(e.message || e));
                completion({ error: { type: 'api', message: '音频处理失败', addition: e.message || String(e) } });
            }
        }
    });
}
