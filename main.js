var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var LOG_PREFIX = '[bob-plugin-openrouter-tts]';
var REQUEST_COUNTER = 0;
var PLUGIN_TIMEOUT_INTERVAL = 120;
var TTS_REQUEST_TIMEOUT_INTERVAL = 105;
var VALIDATION_TIMEOUT_INTERVAL = 30;
var MAX_TEXT_LENGTH = 4096;
var CACHE_MAX_ENTRIES = 10;
var CACHE_MAX_VALUE_CHARS = 3 * 1024 * 1024;
var CACHE_TTL_MS = 30 * 60 * 1000;
var MAX_AUDIO_BYTES = 64 * 1024 * 1024;
var MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
var DEFAULT_API_URL = 'https://openrouter.ai/api/v1/audio/speech';
var DEFAULT_MODEL = 'google/gemini-3.1-flash-tts-preview';
// minimax 与 custom 家族无预设菜单，必须使用 customVoice；其他家族也可被 customVoice 全局覆盖。
var VOICE_OPTION_BY_FAMILY = {
    gemini: 'voiceGemini',
    microsoft: 'voiceMicrosoft',
    grok: 'voiceGrok',
    zyphra: 'voiceZyphra',
    sesame: 'voiceSesame',
    orpheus: 'voiceOrpheus',
    kokoro: 'voiceKokoro',
    voxtral: 'voiceVoxtral',
    deepgram: 'voiceDeepgram'
};
var DEFAULT_VOICE_BY_FAMILY = {
    gemini: 'Kore',
    microsoft: 'en-US-Harper:MAI-Voice-2',
    grok: 'eve',
    zyphra: 'american_female',
    sesame: 'conversational_a',
    orpheus: 'tara',
    kokoro: 'af_heart',
    voxtral: 'en_paul_neutral',
    deepgram: 'aura-2-thalia-en'
};
var AUDIO_CACHE = {};
var AUDIO_CACHE_ORDER = [];
var CACHE_API_KEY_DIGEST = null;
var CACHE_API_KEY_GENERATION = 0;
var CACHE_ENTRY_COUNTER = 0;

var SHA256_CONSTANTS = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
];

function nowMs() {
    return new Date().getTime();
}

function nextRequestId() {
    REQUEST_COUNTER += 1;
    return REQUEST_COUNTER;
}

function sanitizeLogValue(value) {
    var str = value == null ? '' : String(value);
    if (str.length > 1000) {
        str = str.substring(0, 1000);
    }
    str = str.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
    str = str.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
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
        'fr', 'de', 'es', 'it', 'pt', 'pt-br', 'ru',
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
    if (value.indexOf('microsoft/') === 0 || value.indexOf('mai-voice') !== -1) {
        return 'microsoft';
    }
    if (value.indexOf('x-ai/') === 0 || value.indexOf('grok-voice') !== -1) {
        return 'grok';
    }
    if (value.indexOf('zyphra/') === 0 || value.indexOf('zonos') !== -1) {
        return 'zyphra';
    }
    if (value.indexOf('sesame/') === 0 || value.indexOf('csm-1b') !== -1) {
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
    if (value.indexOf('deepgram/') === 0 || value.indexOf('aura-2') !== -1) {
        return 'deepgram';
    }
    if (value.indexOf('minimax/') === 0 || value.indexOf('speech-2.8') !== -1) {
        return 'minimax';
    }

    return 'custom';
}

function getVoice() {
    var family = getModelFamily(getModel());
    var customVoice = readOption('customVoice');

    if (customVoice) {
        return customVoice;
    }

    if (family === 'minimax' || family === 'custom') {
        return '';
    }

    return readOption(VOICE_OPTION_BY_FAMILY[family]) || DEFAULT_VOICE_BY_FAMILY[family];
}

function getResponseFormat() {
    return readOption('responseFormat') || 'pcm';
}

function getSpeed() {
    var speed = parseFloat(readOption('speed'));
    return isNaN(speed) ? 1.0 : speed;
}

function getSampleRate() {
    var rate = parseInt(readOption('pcmSampleRate'), 10);
    return rate > 0 ? rate : 24000;
}

function isOpenRouterBaseUrl(base) {
    return /^https?:\/\/(?:[^\/]+\.)?openrouter\.ai(?:\/|$)/i.test(base);
}

function splitUrlSuffix(url) {
    var queryIndex = url.indexOf('?');
    var fragmentIndex = url.indexOf('#');
    var suffixIndex = -1;

    if (queryIndex !== -1 && fragmentIndex !== -1) {
        suffixIndex = Math.min(queryIndex, fragmentIndex);
    } else if (queryIndex !== -1) {
        suffixIndex = queryIndex;
    } else if (fragmentIndex !== -1) {
        suffixIndex = fragmentIndex;
    }

    if (suffixIndex === -1) {
        return { path: url, suffix: '' };
    }

    return {
        path: url.substring(0, suffixIndex),
        suffix: url.substring(suffixIndex)
    };
}

function getUrlSchemeAndHost(url) {
    var match = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]+)/i.exec(url);
    if (!match) {
        return null;
    }

    var authority = match[2];
    if (!authority || /[\s\\@]/.test(authority)) {
        return null;
    }

    var host = '';
    if (authority.charAt(0) === '[') {
        var closingBracket = authority.indexOf(']');
        if (closingBracket === -1) {
            return null;
        }
        host = authority.substring(1, closingBracket);
        if (host.indexOf(':') === -1) {
            return null;
        }
        var ipv6Port = authority.substring(closingBracket + 1);
        if (ipv6Port && !/^:\d{1,5}$/.test(ipv6Port)) {
            return null;
        }
        if (ipv6Port && parseInt(ipv6Port.substring(1), 10) > 65535) {
            return null;
        }
    } else {
        var firstColon = authority.indexOf(':');
        var lastColon = authority.lastIndexOf(':');
        if (firstColon !== lastColon) {
            return null;
        }
        if (lastColon !== -1) {
            var port = authority.substring(lastColon + 1);
            if (!/^\d{1,5}$/.test(port) || parseInt(port, 10) > 65535) {
                return null;
            }
            host = authority.substring(0, lastColon);
        } else {
            host = authority;
        }
    }

    host = host.toLowerCase().replace(/\.$/, '');
    if (!host) {
        return null;
    }
    return {
        scheme: match[1].toLowerCase(),
        host: host
    };
}

function isIpv4LoopbackHost(host) {
    var parts = String(host || '').split('.');
    if (parts.length !== 4 || parts[0] !== '127') {
        return false;
    }
    for (var i = 0; i < parts.length; i++) {
        if (!/^\d{1,3}$/.test(parts[i]) || parseInt(parts[i], 10) > 255) {
            return false;
        }
    }
    return true;
}

function isLoopbackHost(host) {
    return host === 'localhost' || host === '::1' || isIpv4LoopbackHost(host);
}

function validateApiUrl() {
    var apiUrl = readOption('apiUrl') || DEFAULT_API_URL;
    var urlInfo = getUrlSchemeAndHost(apiUrl);

    if (!urlInfo) {
        return { type: 'param', message: 'API URL 格式无效，请填写完整的 http(s) 地址。' };
    }
    if (urlInfo.scheme === 'https') {
        return null;
    }
    if (urlInfo.scheme === 'http' && isLoopbackHost(urlInfo.host)) {
        return null;
    }
    if (urlInfo.scheme === 'http') {
        return { type: 'param', message: '为保护 API Key 与合成文本，远程 API URL 必须使用 HTTPS。' };
    }
    return { type: 'param', message: 'API URL 仅支持 HTTPS；本机 loopback 调试可使用 HTTP。' };
}

function getApiUrl() {
    var configuredUrl = readOption('apiUrl') || DEFAULT_API_URL;
    var urlParts = splitUrlSuffix(configuredUrl);
    var base = urlParts.path.replace(/\/+$/, '');
    var suffix = urlParts.suffix;

    if (/\/audio\/speech$/i.test(base) || /\/tts$/i.test(base)) {
        return base + suffix;
    }
    if (/\/api\/v1$/i.test(base)) {
        return base + '/audio/speech' + suffix;
    }
    if (/\/api$/i.test(base)) {
        return base + '/v1/audio/speech' + suffix;
    }
    if (/\/v1$/i.test(base)) {
        return base + '/audio/speech' + suffix;
    }
    if (isOpenRouterBaseUrl(base)) {
        return base + '/api/v1/audio/speech' + suffix;
    }
    return base + '/api/v1/audio/speech' + suffix;
}

function validateOptions() {
    var apiKey = readOption('apiKey');
    getApiKeyCacheScope(apiKey);
    if (!apiKey) {
        return { type: 'param', message: '请先在插件设置中填写 OpenRouter API Key。' };
    }
    if (!getModel()) {
        return { type: 'param', message: '请先填写 OpenRouter TTS 模型 ID。' };
    }
    if (!getVoice()) {
        var family = getModelFamily(getModel());
        if (family === 'custom' || family === 'minimax') {
            return { type: 'param', message: '当前模型无预设音色，请先在 Custom Voice 中填写音色 ID。' };
        }
        return { type: 'param', message: '请先在插件设置中选择音色。' };
    }
    var apiUrlError = validateApiUrl();
    if (apiUrlError) {
        return apiUrlError;
    }
    return null;
}

function stringToUtf8Bytes(value) {
    var str = value == null ? '' : String(value);
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
        var codePoint = str.charCodeAt(i);
        if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
            var lowSurrogate = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
            if (lowSurrogate >= 0xDC00 && lowSurrogate <= 0xDFFF) {
                codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (lowSurrogate - 0xDC00);
                i += 1;
            } else {
                codePoint = 0xFFFD;
            }
        } else if (codePoint >= 0xDC00 && codePoint <= 0xDFFF) {
            codePoint = 0xFFFD;
        }

        if (codePoint < 0x80) {
            bytes.push(codePoint);
        } else if (codePoint < 0x800) {
            bytes.push(0xC0 | (codePoint >> 6));
            bytes.push(0x80 | (codePoint & 0x3F));
        } else if (codePoint < 0x10000) {
            bytes.push(0xE0 | (codePoint >> 12));
            bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
            bytes.push(0x80 | (codePoint & 0x3F));
        } else {
            bytes.push(0xF0 | (codePoint >> 18));
            bytes.push(0x80 | ((codePoint >> 12) & 0x3F));
            bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
            bytes.push(0x80 | (codePoint & 0x3F));
        }
    }
    return bytes;
}

function rotateRight32(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
}

function toEightCharacterHex(value) {
    var hex = (value >>> 0).toString(16);
    while (hex.length < 8) {
        hex = '0' + hex;
    }
    return hex;
}

function sha256Hex(value) {
    var bytes = stringToUtf8Bytes(value);
    var originalLength = bytes.length;
    var bitLengthHigh = Math.floor(originalLength / 0x20000000) >>> 0;
    var bitLengthLow = (originalLength << 3) >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
        bytes.push(0);
    }
    bytes.push((bitLengthHigh >>> 24) & 0xFF);
    bytes.push((bitLengthHigh >>> 16) & 0xFF);
    bytes.push((bitLengthHigh >>> 8) & 0xFF);
    bytes.push(bitLengthHigh & 0xFF);
    bytes.push((bitLengthLow >>> 24) & 0xFF);
    bytes.push((bitLengthLow >>> 16) & 0xFF);
    bytes.push((bitLengthLow >>> 8) & 0xFF);
    bytes.push(bitLengthLow & 0xFF);

    var hash = [
        0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
        0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19
    ];
    var words = new Array(64);

    for (var offset = 0; offset < bytes.length; offset += 64) {
        var i;
        for (i = 0; i < 16; i++) {
            var wordOffset = offset + (i * 4);
            words[i] = ((bytes[wordOffset] << 24) | (bytes[wordOffset + 1] << 16) |
                (bytes[wordOffset + 2] << 8) | bytes[wordOffset + 3]) >>> 0;
        }
        for (i = 16; i < 64; i++) {
            var word15 = words[i - 15];
            var word2 = words[i - 2];
            var sigma0 = rotateRight32(word15, 7) ^ rotateRight32(word15, 18) ^ (word15 >>> 3);
            var sigma1 = rotateRight32(word2, 17) ^ rotateRight32(word2, 19) ^ (word2 >>> 10);
            words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
        }

        var a = hash[0];
        var b = hash[1];
        var c = hash[2];
        var d = hash[3];
        var e = hash[4];
        var f = hash[5];
        var g = hash[6];
        var h = hash[7];

        for (i = 0; i < 64; i++) {
            var sum1 = rotateRight32(e, 6) ^ rotateRight32(e, 11) ^ rotateRight32(e, 25);
            var choice = (e & f) ^ ((~e) & g);
            var temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[i] + words[i]) >>> 0;
            var sum0 = rotateRight32(a, 2) ^ rotateRight32(a, 13) ^ rotateRight32(a, 22);
            var majority = (a & b) ^ (a & c) ^ (b & c);
            var temporary2 = (sum0 + majority) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    var result = '';
    for (var hashIndex = 0; hashIndex < hash.length; hashIndex++) {
        result += toEightCharacterHex(hash[hashIndex]);
    }
    return result;
}

function getApiKeyCacheScope(apiKey) {
    var digest = sha256Hex(String(apiKey || ''));
    if (CACHE_API_KEY_DIGEST !== digest) {
        clearAudioCache();
        CACHE_API_KEY_DIGEST = digest;
        CACHE_API_KEY_GENERATION += 1;
    }
    return digest;
}

function makeCacheKey(text, lang, apiUrl, model, voice, instructions, format, speed, sampleRate, apiKeyScope) {
    return sha256Hex(JSON.stringify([
        apiKeyScope,
        apiUrl,
        model,
        voice,
        instructions,
        format,
        String(speed),
        String(sampleRate),
        lang || '',
        text || ''
    ]));
}

function touchCacheKey(key) {
    var index = AUDIO_CACHE_ORDER.indexOf(key);
    if (index !== -1) {
        AUDIO_CACHE_ORDER.splice(index, 1);
    }
    AUDIO_CACHE_ORDER.push(key);
}

function deleteCacheKey(key) {
    var entry = AUDIO_CACHE[key];
    if (entry && entry.expiryTimerId !== null && typeof entry.expiryTimerId !== 'undefined' &&
        typeof $timer !== 'undefined' && $timer && typeof $timer.invalidate === 'function') {
        try {
            $timer.invalidate(entry.expiryTimerId);
        } catch (e) {
            // 缓存删除不应因计时器状态失败。
        }
    }
    delete AUDIO_CACHE[key];
    var index = AUDIO_CACHE_ORDER.indexOf(key);
    if (index !== -1) {
        AUDIO_CACHE_ORDER.splice(index, 1);
    }
}

function clearAudioCache() {
    while (AUDIO_CACHE_ORDER.length) {
        deleteCacheKey(AUDIO_CACHE_ORDER[0]);
    }
    AUDIO_CACHE = {};
    AUDIO_CACHE_ORDER = [];
}

function trimAudioCache() {
    while (AUDIO_CACHE_ORDER.length > CACHE_MAX_ENTRIES) {
        deleteCacheKey(AUDIO_CACHE_ORDER[0]);
    }
}

function pruneExpiredAudioCache() {
    var currentTime = nowMs();
    for (var i = AUDIO_CACHE_ORDER.length - 1; i >= 0; i--) {
        var key = AUDIO_CACHE_ORDER[i];
        var entry = AUDIO_CACHE[key];
        if (!entry || currentTime - entry.storedAt > CACHE_TTL_MS) {
            deleteCacheKey(key);
        }
    }
}

function getCachedAudioResult(key) {
    pruneExpiredAudioCache();
    var entry = AUDIO_CACHE[key];
    if (!entry) {
        return null;
    }
    touchCacheKey(key);
    return entry;
}

function setCachedAudioResult(key, result) {
    pruneExpiredAudioCache();
    if (!result || !result.value || result.value.length > CACHE_MAX_VALUE_CHARS) {
        return false;
    }

    if (AUDIO_CACHE[key]) {
        deleteCacheKey(key);
    }

    var storedAt = nowMs();
    CACHE_ENTRY_COUNTER += 1;
    var generation = CACHE_ENTRY_COUNTER;
    var entry = {
        result: {
            value: result.value,
            raw: {
                format: result.raw.format,
                sourceFormat: result.raw.sourceFormat
            }
        },
        storedAt: storedAt,
        generation: generation,
        expiryTimerId: null
    };
    AUDIO_CACHE[key] = entry;
    if (typeof $timer !== 'undefined' && $timer && typeof $timer.schedule === 'function') {
        try {
            entry.expiryTimerId = $timer.schedule({
                interval: CACHE_TTL_MS / 1000,
                repeats: false,
                handler: function() {
                    var currentEntry = AUDIO_CACHE[key];
                    if (currentEntry && currentEntry.generation === generation) {
                        currentEntry.expiryTimerId = null;
                        deleteCacheKey(key);
                    }
                }
            });
        } catch (e) {
            entry.expiryTimerId = null;
        }
    }
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

function getBase64PayloadStart(str) {
    if (String(str || '').substring(0, 5).toLowerCase() !== 'data:') {
        return 0;
    }
    var commaIndex = str.indexOf(',');
    return commaIndex === -1 ? 0 : commaIndex + 1;
}

function isBase64Whitespace(character) {
    return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

function base64DecodedByteLength(base64) {
    var str = String(base64 || '');
    var start = getBase64PayloadStart(str);
    var charCount = 0;
    var lastCharacter = '';
    var previousCharacter = '';

    for (var i = start; i < str.length; i++) {
        var character = str.charAt(i);
        if (isBase64Whitespace(character)) {
            continue;
        }
        charCount += 1;
        previousCharacter = lastCharacter;
        lastCharacter = character;
    }

    if (!charCount) {
        return 0;
    }
    var padding = lastCharacter === '=' ? 1 : 0;
    if (previousCharacter === '=') {
        padding += 1;
    }
    return Math.floor(charCount * 3 / 4) - padding;
}

function isValidBase64AudioData(base64) {
    var str = String(base64 || '');
    var start = getBase64PayloadStart(str);
    var dataCharacters = 0;
    var padding = 0;
    var sawPadding = false;

    for (var i = start; i < str.length; i++) {
        var character = str.charAt(i);
        if (isBase64Whitespace(character)) {
            continue;
        }
        if (character === '=') {
            sawPadding = true;
            padding += 1;
            if (padding > 2) {
                return false;
            }
            continue;
        }
        if (sawPadding || BASE64_CHARS.indexOf(character) === -1) {
            return false;
        }
        dataCharacters += 1;
    }

    if (!dataCharacters || dataCharacters % 4 === 1) {
        return false;
    }
    if (!padding) {
        return true;
    }
    return (dataCharacters + padding) % 4 === 0 &&
        ((padding === 1 && dataCharacters % 4 === 3) ||
        (padding === 2 && dataCharacters % 4 === 2));
}

function base64Decode(base64) {
    var str = String(base64 || '');
    var start = getBase64PayloadStart(str);
    var byteLen = base64DecodedByteLength(str);
    var bytes = new Uint8Array(byteLen);
    var p = 0;
    var quartet = [];

    for (var i = start; i < str.length; i++) {
        var character = str.charAt(i);
        if (isBase64Whitespace(character)) {
            continue;
        }
        if (character === '=') {
            break;
        }
        var value = BASE64_CHARS.indexOf(character);
        if (value === -1) {
            throw new Error('无效的 base64 音频数据');
        }
        quartet.push(value);
        if (quartet.length === 4) {
            bytes[p++] = (quartet[0] << 2) | (quartet[1] >> 4);
            bytes[p++] = ((quartet[1] & 0x0F) << 4) | (quartet[2] >> 2);
            bytes[p++] = ((quartet[2] & 0x03) << 6) | quartet[3];
            quartet = [];
        }
    }

    if (quartet.length === 2) {
        bytes[p++] = (quartet[0] << 2) | (quartet[1] >> 4);
    } else if (quartet.length === 3) {
        bytes[p++] = (quartet[0] << 2) | (quartet[1] >> 4);
        bytes[p++] = ((quartet[1] & 0x0F) << 4) | (quartet[2] >> 2);
    } else if (quartet.length === 1) {
        throw new Error('无效的 base64 音频数据');
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

function createWavHeaderBytes(pcmLen, sampleRate) {
    sampleRate = sampleRate || 24000;
    var numChannels = 1;
    var bitsPerSample = 16;
    var byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    var blockAlign = numChannels * (bitsPerSample / 8);
    var wavLen = 44 + pcmLen;
    var buffer = new ArrayBuffer(44);
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

    return new Uint8Array(buffer);
}

function pcmToWav(pcmBase64, sampleRate) {
    var pcmData = base64Decode(pcmBase64);
    var pcmLen = pcmData.length;
    if (pcmLen % 2 !== 0) {
        throw new Error('16-bit PCM 音频字节数必须为偶数');
    }
    var wavLen = 44 + pcmLen;
    var headerBytes = createWavHeaderBytes(pcmLen, sampleRate);
    var buffer = new ArrayBuffer(wavLen);

    var wavBytes = new Uint8Array(buffer);
    wavBytes.set(headerBytes, 0);
    wavBytes.set(pcmData, 44);

    return base64Encode(wavBytes);
}

function canUseNativeDataAudioProcessing() {
    return typeof $data !== 'undefined' && $data &&
        typeof $data.fromByteArray === 'function' &&
        typeof $data.fromBase64 === 'function';
}

function pcmDataToWavBase64(pcmData, sampleRate) {
    if (!canUseNativeDataAudioProcessing() || !pcmData || typeof pcmData.length !== 'number') {
        return '';
    }

    var headerBytes = createWavHeaderBytes(pcmData.length, sampleRate);
    var headerArray = [];
    for (var i = 0; i < headerBytes.length; i++) {
        headerArray.push(headerBytes[i]);
    }
    var wavData = $data.fromByteArray(headerArray);
    wavData.appendData(pcmData);
    return wavData.toBase64();
}

function pcmBase64ToWavNative(base64, sampleRate) {
    if (!canUseNativeDataAudioProcessing()) {
        return '';
    }
    try {
        var str = String(base64 || '');
        var start = getBase64PayloadStart(str);
        var pcmData = $data.fromBase64(start ? str.substring(start) : str);
        return pcmDataToWavBase64(pcmData, sampleRate);
    } catch (e) {
        return '';
    }
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
    if (data && data.message) {
        return typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
    }
    if (data && data.detail) {
        return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
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
            if (inlineData && typeof inlineData.data === 'string' && inlineData.data.trim()) {
                return {
                    data: inlineData.data,
                    mimeType: inlineData.mimeType || ''
                };
            }
        }
    }

    return null;
}

function getContentTypeHeader(response) {
    if (!response) {
        return '';
    }
    var headers = response.headers;
    if (!headers) {
        return '';
    }
    if (headers['Content-Type']) {
        return String(headers['Content-Type']);
    }
    if (headers['content-type']) {
        return String(headers['content-type']);
    }

    for (var key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key) && String(key).toLowerCase() === 'content-type') {
            return String(headers[key]);
        }
    }
    return '';
}

function getResponseMimeType(resp) {
    var response = resp && resp.response;
    if (!response) {
        return '';
    }

    var contentType = getContentTypeHeader(response);
    if (contentType) {
        return contentType;
    }
    return response.MIMEType ? String(response.MIMEType) : '';
}

function isClearlyNonAudioMimeType(mimeType) {
    var lower = String(mimeType || '').toLowerCase();
    return lower.indexOf('json') !== -1 ||
        lower.indexOf('text/') === 0 ||
        lower.indexOf('html') !== -1 ||
        lower.indexOf('xml') !== -1;
}

function isRawAudioMimeTypeAllowed(mimeType) {
    var lower = String(mimeType || '').toLowerCase().split(';')[0].trim();
    if (isClearlyNonAudioMimeType(lower)) {
        return false;
    }
    if (!lower || lower.indexOf('audio/') === 0) {
        return true;
    }
    return lower === 'application/octet-stream' ||
        lower === 'binary/octet-stream' ||
        lower === 'application/ogg' ||
        lower === 'application/x-ogg' ||
        lower === 'application/flac' ||
        lower === 'application/x-flac' ||
        lower === 'application/pcm' ||
        lower === 'application/x-pcm';
}

function isBobDataObject(value) {
    try {
        return typeof $data !== 'undefined' && $data &&
            typeof $data.isData === 'function' && $data.isData(value);
    } catch (e) {
        return false;
    }
}

function hasParsedNonAudioData(resp) {
    var data = resp && resp.data;
    if (data === null || typeof data === 'undefined' || isBobDataObject(data)) {
        return false;
    }
    return typeof data === 'object' || typeof data === 'number' || typeof data === 'boolean';
}

function parsePossibleJsonData(rawData) {
    if (!rawData || typeof rawData.readUInt8 !== 'function' || typeof rawData.toUTF8 !== 'function') {
        return { matched: false };
    }

    var length = typeof rawData.length === 'number' ? rawData.length : 0;
    var index = 0;
    if (length >= 3 && rawData.readUInt8(0) === 0xEF &&
        rawData.readUInt8(1) === 0xBB && rawData.readUInt8(2) === 0xBF) {
        index = 3;
    }
    var scanLimit = Math.min(length, index + 256);
    while (index < scanLimit) {
        var value = rawData.readUInt8(index);
        if (value !== 0x20 && value !== 0x09 && value !== 0x0A && value !== 0x0D) {
            break;
        }
        index += 1;
    }

    if (index >= length || (index >= scanLimit && scanLimit < length)) {
        return { matched: true, data: null };
    }

    var firstByte = index < length ? rawData.readUInt8(index) : -1;
    var startsLikeJson = firstByte === 0x7B || firstByte === 0x5B || firstByte === 0x22 ||
        firstByte === 0x6E || firstByte === 0x74 || firstByte === 0x66 || firstByte === 0x2D ||
        (firstByte >= 0x30 && firstByte <= 0x39);
    if (!startsLikeJson) {
        return { matched: false };
    }

    var text = rawData.toUTF8();
    if (typeof text !== 'string') {
        return { matched: false };
    }
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.substring(1);
    }
    try {
        return { matched: true, data: JSON.parse(text) };
    } catch (e) {
        return { matched: false };
    }
}

function isBase64AudioTooLarge(base64) {
    var str = String(base64 || '');
    if (str.length > MAX_AUDIO_BASE64_CHARS + 1024) {
        return true;
    }
    return base64DecodedByteLength(str) > MAX_AUDIO_BYTES;
}

function getAudioPayload(resp) {
    var inlineAudio = getInlineAudioData(resp);
    if (inlineAudio) {
        if (inlineAudio.mimeType && !isRawAudioMimeTypeAllowed(inlineAudio.mimeType)) {
            return null;
        }
        if (isBase64AudioTooLarge(inlineAudio.data)) {
            return { tooLarge: true };
        }
        if (!isValidBase64AudioData(inlineAudio.data)) {
            return null;
        }
        return {
            data: inlineAudio.data,
            mimeType: inlineAudio.mimeType || '',
            source: 'inline'
        };
    }

    var mimeType = getResponseMimeType(resp);
    if (!isRawAudioMimeTypeAllowed(mimeType) || hasParsedNonAudioData(resp)) {
        return null;
    }

    var rawData = resp && resp.rawData;
    if (!rawData || typeof rawData.toBase64 !== 'function') {
        return null;
    }
    if (typeof rawData.length !== 'number' || !isFinite(rawData.length) || rawData.length <= 0) {
        return null;
    }
    if (rawData.length > MAX_AUDIO_BYTES) {
        return { tooLarge: true };
    }

    var parsedJson = parsePossibleJsonData(rawData);
    if (parsedJson.matched) {
        var parsedInlineAudio = getInlineAudioData({ data: parsedJson.data });
        if (!parsedInlineAudio) {
            return null;
        }
        if (parsedInlineAudio.mimeType && !isRawAudioMimeTypeAllowed(parsedInlineAudio.mimeType)) {
            return null;
        }
        if (isBase64AudioTooLarge(parsedInlineAudio.data)) {
            return { tooLarge: true };
        }
        if (!isValidBase64AudioData(parsedInlineAudio.data)) {
            return null;
        }
        return {
            data: parsedInlineAudio.data,
            mimeType: parsedInlineAudio.mimeType || '',
            source: 'inline'
        };
    }

    return {
        rawData: rawData,
        mimeType: mimeType,
        source: 'raw'
    };
}

function parseStreamedResponseData(rawData, response) {
    if (!rawData || typeof rawData.toUTF8 !== 'function') {
        return null;
    }

    var statusCode = response ? response.statusCode : 0;
    var mimeType = getResponseMimeType({ response: response });
    var isSuccessful = !statusCode || (statusCode >= 200 && statusCode < 300);
    if (isSuccessful) {
        var successfulJson = parsePossibleJsonData(rawData);
        if (successfulJson.matched) {
            return successfulJson.data;
        }
        if (!isClearlyNonAudioMimeType(mimeType)) {
            return null;
        }
    }

    var parsedJson = parsePossibleJsonData(rawData);
    if (parsedJson.matched) {
        return parsedJson.data;
    }

    var text = rawData.toUTF8();
    if (typeof text !== 'string') {
        return null;
    }
    return text;
}

function canStreamSpeechResponse() {
    return typeof $http.streamRequest === 'function' &&
        typeof $data !== 'undefined' &&
        $data && typeof $data.fromData === 'function' &&
        typeof $data.fromByteArray === 'function' &&
        typeof $data.fromBase64 === 'function' &&
        typeof $signal !== 'undefined' &&
        $signal && typeof $signal.new === 'function';
}

function getExpectedContentLength(response) {
    if (!response) {
        return 0;
    }
    var length = Number(response.expectedContentLength);
    if (!isNaN(length) && length > 0) {
        return length;
    }

    var headers = response.headers || {};
    for (var key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key) && String(key).toLowerCase() === 'content-length') {
            length = Number(headers[key]);
            return !isNaN(length) && length > 0 ? length : 0;
        }
    }
    return 0;
}

function requestSpeechResponse(request, handler) {
    var completed = false;
    function finish(resp) {
        if (completed) {
            return;
        }
        completed = true;
        handler(resp || {});
    }

    if (!canStreamSpeechResponse()) {
        finish({ streamUnsupported: true });
        return;
    }

    var cancelSignal;
    try {
        cancelSignal = $signal.new();
    } catch (e) {
        finish({ error: e });
        return;
    }
    var accumulatedData = null;
    var accumulatedLength = 0;
    var audioTooLarge = false;
    var streamProcessingError = null;

    try {
        $http.streamRequest({
            method: request.method,
            url: request.url,
            header: request.header,
            body: request.body,
            timeout: request.timeout,
            cancelSignal: cancelSignal,
            streamHandler: function(stream) {
                if (audioTooLarge || streamProcessingError || completed) {
                    return;
                }

                try {
                    var chunk = stream && stream.rawData;
                    if (!chunk) {
                        return;
                    }
                    var chunkLength = chunk.length;
                    if (typeof chunkLength !== 'number' || !isFinite(chunkLength) || chunkLength < 0) {
                        throw new Error('流数据长度无效');
                    }
                    if (chunkLength === 0) {
                        return;
                    }
                    if (accumulatedLength + chunkLength > MAX_AUDIO_BYTES) {
                        audioTooLarge = true;
                        accumulatedData = null;
                        accumulatedLength = 0;
                        try {
                            cancelSignal.send();
                        } catch (cancelError) {
                            // 超限错误优先，取消失败不应覆盖真正原因。
                        }
                        finish({ audioTooLarge: true });
                        return;
                    }

                    if (!accumulatedData) {
                        accumulatedData = $data.fromData(chunk);
                    } else {
                        accumulatedData.appendData(chunk);
                    }
                    accumulatedLength += chunkLength;
                } catch (e) {
                    streamProcessingError = e;
                    accumulatedData = null;
                    accumulatedLength = 0;
                    try {
                        cancelSignal.send();
                    } catch (cancelError) {
                        // 保留原始流处理错误。
                    }
                    finish({ streamProcessingError: streamProcessingError });
                }
            },
            handler: function(resp) {
                resp = resp || {};
                var contentTooLarge = audioTooLarge || getExpectedContentLength(resp.response) > MAX_AUDIO_BYTES;
                if (contentTooLarge) {
                    accumulatedData = null;
                    accumulatedLength = 0;
                }
                var normalized = {
                    error: resp.error,
                    response: resp.response,
                    rawData: accumulatedData,
                    audioTooLarge: contentTooLarge,
                    streamProcessingError: streamProcessingError
                };
                if (!contentTooLarge) {
                    try {
                        normalized.data = parseStreamedResponseData(accumulatedData, normalized.response);
                    } catch (e) {
                        normalized.streamProcessingError = e;
                    }
                }
                if (normalized.data !== null && typeof normalized.data !== 'undefined') {
                    accumulatedData = null;
                    accumulatedLength = 0;
                    normalized.rawData = null;
                }
                finish(normalized);
                normalized.rawData = null;
                accumulatedData = null;
                accumulatedLength = 0;
            }
        });
    } catch (e) {
        finish({ error: e });
    }
}

function decodeBase64Prefix(base64, byteCount) {
    var str = String(base64 || '');
    var start = getBase64PayloadStart(str);
    var charsNeeded = Math.ceil((byteCount + 2) / 3) * 4;
    var prefix = '';
    for (var i = start; i < str.length && prefix.length < charsNeeded; i++) {
        var character = str.charAt(i);
        if (!isBase64Whitespace(character)) {
            prefix += character;
        }
    }
    return base64Decode(prefix);
}

function normalizeBase64AudioData(base64) {
    var str = String(base64 || '');
    var start = getBase64PayloadStart(str);
    var payload = start ? str.substring(start) : str;
    if (!/[\t\n\r ]/.test(payload)) {
        return payload;
    }
    return payload.replace(/[\t\n\r ]+/g, '');
}

function getMpegFrameLength(bytes, offset) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) {
        return 0;
    }

    var b0 = bytes[offset];
    var b1 = bytes[offset + 1];
    var b2 = bytes[offset + 2];
    if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) {
        return 0;
    }

    var version = (b1 >> 3) & 0x03;
    var layer = (b1 >> 1) & 0x03;
    var bitrateIndex = (b2 >> 4) & 0x0F;
    var sampleRateIndex = (b2 >> 2) & 0x03;
    var padding = (b2 >> 1) & 0x01;
    if (version === 0x01 || layer === 0x00 || bitrateIndex === 0x00 ||
        bitrateIndex === 0x0F || sampleRateIndex === 0x03) {
        return 0;
    }

    var mpeg1Bitrates = {
        3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    };
    var mpeg2Bitrates = {
        3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
        1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    };
    var bitrateTable = version === 0x03 ? mpeg1Bitrates : mpeg2Bitrates;
    var bitrate = bitrateTable[layer][bitrateIndex] * 1000;
    var sampleRates = [44100, 48000, 32000];
    var sampleRate = sampleRates[sampleRateIndex];
    if (version === 0x02) {
        sampleRate = sampleRate / 2;
    } else if (version === 0x00) {
        sampleRate = sampleRate / 4;
    }

    if (layer === 0x03) {
        return Math.floor((12 * bitrate / sampleRate) + padding) * 4;
    }
    if (layer === 0x01 && version !== 0x03) {
        return Math.floor(72 * bitrate / sampleRate) + padding;
    }
    return Math.floor(144 * bitrate / sampleRate) + padding;
}

function hasConsecutiveMpegFrames(bytes) {
    var firstFrameLength = getMpegFrameLength(bytes, 0);
    if (!firstFrameLength || firstFrameLength + 4 > bytes.length) {
        return false;
    }
    if (!getMpegFrameLength(bytes, firstFrameLength)) {
        return false;
    }
    return (bytes[1] & 0x1E) === (bytes[firstFrameLength + 1] & 0x1E) &&
        (bytes[2] & 0x0C) === (bytes[firstFrameLength + 2] & 0x0C);
}

function hasValidId3Header(bytes) {
    if (!bytes || bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
        return false;
    }
    if (bytes[3] < 2 || bytes[3] > 4 || bytes[4] === 0xFF) {
        return false;
    }
    return (bytes[6] & 0x80) === 0 && (bytes[7] & 0x80) === 0 &&
        (bytes[8] & 0x80) === 0 && (bytes[9] & 0x80) === 0;
}

function sniffAudioContainer(bytes) {
    if (!bytes || bytes.length < 4) {
        return '';
    }
    var b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];

    if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
        if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x41 &&
            bytes[10] === 0x56 && bytes[11] === 0x45) {
            return 'wav';
        }
        return '';
    }
    if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
        return 'ogg';
    }
    if (b0 === 0x66 && b1 === 0x4C && b2 === 0x61 && b3 === 0x43) {
        return 'flac';
    }
    if (hasValidId3Header(bytes)) {
        return 'mp3';
    }
    if (hasConsecutiveMpegFrames(bytes)) {
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

function processAudioBase64(audioBase64, format, mimeType, sampleRate) {
    audioBase64 = normalizeBase64AudioData(audioBase64);
    var lowerMimeType = String(mimeType || '').toLowerCase();
    var shouldTreatAsPcm = String(format || '').toLowerCase() === 'pcm' ||
        lowerMimeType.indexOf('pcm') !== -1 ||
        lowerMimeType.indexOf('l16') !== -1;

    var declaredContainer = mimeTypeToContainer(lowerMimeType);
    if (declaredContainer) {
        return { value: audioBase64, outputFormat: declaredContainer };
    }

    var sniffedContainer = sniffAudioContainer(decodeBase64Prefix(audioBase64, 4096));
    if (sniffedContainer && !(shouldTreatAsPcm && sniffedContainer === 'mp3')) {
        return { value: audioBase64, outputFormat: sniffedContainer };
    }

    if (shouldTreatAsPcm) {
        if (base64DecodedByteLength(audioBase64) % 2 !== 0) {
            throw new Error('16-bit PCM 音频字节数必须为偶数');
        }
        var nativeWavBase64 = pcmBase64ToWavNative(audioBase64, sampleRate);
        if (nativeWavBase64) {
            return { value: nativeWavBase64, outputFormat: 'wav' };
        }
        return { value: pcmToWav(audioBase64, sampleRate), outputFormat: 'wav' };
    }

    return { value: audioBase64, outputFormat: format || 'audio' };
}

function readDataPrefix(data, byteCount) {
    if (!data || typeof data.readUInt8 !== 'function' || typeof data.length !== 'number') {
        return new Uint8Array(0);
    }
    var length = Math.min(data.length, byteCount);
    var bytes = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
        bytes[i] = data.readUInt8(i);
    }
    return bytes;
}

function processAudioData(rawData, format, mimeType, sampleRate) {
    var lowerMimeType = String(mimeType || '').toLowerCase();
    var shouldTreatAsPcm = String(format || '').toLowerCase() === 'pcm' ||
        lowerMimeType.indexOf('pcm') !== -1 ||
        lowerMimeType.indexOf('l16') !== -1;
    var declaredContainer = mimeTypeToContainer(lowerMimeType);
    if (declaredContainer) {
        return { value: rawData.toBase64(), outputFormat: declaredContainer };
    }

    var sniffedContainer = sniffAudioContainer(readDataPrefix(rawData, 4096));
    if (sniffedContainer && !(shouldTreatAsPcm && sniffedContainer === 'mp3')) {
        return { value: rawData.toBase64(), outputFormat: sniffedContainer };
    }

    if (shouldTreatAsPcm) {
        if (rawData.length % 2 !== 0) {
            throw new Error('16-bit PCM 音频字节数必须为偶数');
        }
        var nativeWavBase64 = pcmDataToWavBase64(rawData, sampleRate);
        if (nativeWavBase64) {
            return { value: nativeWavBase64, outputFormat: 'wav' };
        }
        return { value: pcmToWav(rawData.toBase64(), sampleRate), outputFormat: 'wav' };
    }

    return { value: rawData.toBase64(), outputFormat: format || 'audio' };
}

function processAudioPayload(payload, format, sampleRate) {
    if (payload && payload.rawData) {
        return processAudioData(payload.rawData, format, payload.mimeType, sampleRate);
    }
    return processAudioBase64(payload ? payload.data : '', format, payload ? payload.mimeType : '', sampleRate);
}

function createAudioTooLargeError() {
    return {
        type: 'api',
        message: '音频响应超过 ' + Math.floor(MAX_AUDIO_BYTES / (1024 * 1024)) + ' MiB 安全上限。'
    };
}

function createStreamUnsupportedError() {
    return {
        type: 'param',
        message: '当前 Bob 环境不支持安全的流式音频接收，请升级到 Bob 1.8.0 或更高版本。'
    };
}

function pluginValidate(completion) {
    var error = validateOptions();
    if (error) {
        completion({ result: false, error: error });
        return;
    }

    var apiKey = readOption('apiKey');
    var model = getModel();
    var voice = getVoice();
    var apiUrl = getApiUrl();

    requestSpeechResponse({
        method: 'POST',
        url: apiUrl,
        header: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: buildSpeechRequestBody('Hi', model, voice, getResponseFormat(), 1.0),
        timeout: VALIDATION_TIMEOUT_INTERVAL
    }, function(resp) {
        if (resp.streamUnsupported) {
            completion({ result: false, error: createStreamUnsupportedError() });
            return;
        }
        if (resp.audioTooLarge) {
            completion({ result: false, error: createAudioTooLargeError() });
            return;
        }
        if (resp.streamProcessingError) {
            completion({ result: false, error: { type: 'api', message: '音频响应处理失败。' } });
            return;
        }
        if (resp.error) {
            completion({ result: false, error: toServiceError(resp.error) });
            return;
        }

        var statusCode = resp.response ? resp.response.statusCode : 0;
        if (statusCode && (statusCode < 200 || statusCode >= 300)) {
            completion({ result: false, error: parseHttpError(resp) });
            return;
        }

        try {
            var payload = getAudioPayload(resp);
            if (payload && payload.tooLarge) {
                completion({ result: false, error: createAudioTooLargeError() });
                return;
            }
            if (!payload || (!payload.data && !payload.rawData)) {
                completion({ result: false, error: { type: 'api', message: 'OpenRouter TTS 服务没有返回音频数据。' } });
                return;
            }
        } catch (e) {
            completion({ result: false, error: { type: 'api', message: '音频响应处理失败。' } });
            return;
        }

        completion({ result: true });
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
    var sampleRate = getSampleRate();
    var instructions = readOption('instructions');
    var inputText = buildInputText(text, instructions);
    if (inputText.length > MAX_TEXT_LENGTH) {
        completion({
            error: {
                type: 'param',
                message: '文本与 Instructions 合并后超出 ' + MAX_TEXT_LENGTH + ' 字符限制（当前 ' + inputText.length + ' 字符）。'
            }
        });
        return;
    }
    var apiUrl = getApiUrl();
    var requestId = nextRequestId();
    var requestStartedAt = nowMs();
    var apiKeyCacheScope = getApiKeyCacheScope(apiKey);
    var apiKeyCacheGeneration = CACHE_API_KEY_GENERATION;
    var cacheKey = makeCacheKey(
        text,
        query.lang,
        apiUrl,
        model,
        voice,
        instructions,
        format,
        speed,
        sampleRate,
        apiKeyCacheScope
    );
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
        ' model=' + sanitizeLogValue(model) +
        ' voice=' + sanitizeLogValue(voice) +
        ' format=' + sanitizeLogValue(format) +
        ' sample_rate=' + sampleRate
    );

    requestSpeechResponse({
        method: 'POST',
        url: apiUrl,
        header: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: buildSpeechRequestBody(inputText, model, voice, format, speed),
        timeout: TTS_REQUEST_TIMEOUT_INTERVAL
    }, function(resp) {
            var requestElapsedMs = nowMs() - requestStartedAt;

            if (resp.streamUnsupported) {
                logTtsError(requestId, 'stream_unsupported', 'request_ms=' + requestElapsedMs);
                completion({ error: createStreamUnsupportedError() });
                return;
            }
            if (resp.audioTooLarge) {
                logTtsError(requestId, 'response_too_large', 'request_ms=' + requestElapsedMs + ' limit_bytes=' + MAX_AUDIO_BYTES);
                completion({ error: createAudioTooLargeError() });
                return;
            }
            if (resp.streamProcessingError) {
                logTtsError(requestId, 'stream_processing_error', 'request_ms=' + requestElapsedMs + ' message=' + sanitizeLogValue(resp.streamProcessingError.message || resp.streamProcessingError));
                completion({ error: { type: 'api', message: '音频响应处理失败。' } });
                return;
            }
            if (resp.error) {
                logTtsError(requestId, 'network_error', 'request_ms=' + requestElapsedMs);
                completion({ error: toServiceError(resp.error) });
                return;
            }

            var statusCode = resp.response ? resp.response.statusCode : 0;
            if (statusCode && (statusCode < 200 || statusCode >= 300)) {
                var httpError = parseHttpError(resp);
                logTtsError(requestId, 'http_error', 'request_ms=' + requestElapsedMs + ' status=' + statusCode);
                completion({ error: httpError });
                return;
            }

            try {
                var audioPayload = getAudioPayload(resp);
                if (audioPayload && audioPayload.tooLarge) {
                    logTtsError(requestId, 'response_too_large', 'request_ms=' + requestElapsedMs + ' limit_bytes=' + MAX_AUDIO_BYTES);
                    completion({ error: createAudioTooLargeError() });
                    return;
                }

                if (!audioPayload || (!audioPayload.data && !audioPayload.rawData)) {
                    logTtsError(requestId, 'invalid_response', 'request_ms=' + requestElapsedMs + ' reason=missing_audio_data');
                    completion({ error: { type: 'api', message: 'OpenRouter TTS 服务没有返回音频数据。' } });
                    return;
                }

                var convertStartedAt = nowMs();
                var sourceSizeLog = audioPayload.rawData
                    ? ' source_bytes=' + audioPayload.rawData.length
                    : ' source_base64_chars=' + audioPayload.data.length;
                var processed = processAudioPayload(audioPayload, format, sampleRate);
                audioPayload.rawData = null;
                var convertElapsedMs = nowMs() - convertStartedAt;
                var totalElapsedMs = nowMs() - requestStartedAt;
                var result = createTtsResult(processed.value, model, voice, processed.outputFormat, audioPayload.mimeType || format, 'miss');
                var cacheStored = CACHE_API_KEY_GENERATION === apiKeyCacheGeneration &&
                    CACHE_API_KEY_DIGEST === apiKeyCacheScope &&
                    setCachedAudioResult(cacheKey, result);

                logTtsInfo(
                    requestId,
                    'success',
                    'status=' + statusCode +
                    ' request_ms=' + requestElapsedMs +
                    ' convert_ms=' + convertElapsedMs +
                    ' total_ms=' + totalElapsedMs +
                    ' cache_store=' + (cacheStored ? 'yes' : 'no') +
                    ' source=' + audioPayload.source +
                    ' source_mime=' + sanitizeLogValue(audioPayload.mimeType || 'unknown') +
                    sourceSizeLog +
                    ' output_base64_chars=' + processed.value.length
                );

                completion({ result: result });
            } catch (e) {
                logTtsError(requestId, 'processing_error', 'request_ms=' + requestElapsedMs + ' total_ms=' + (nowMs() - requestStartedAt) + ' message=' + sanitizeLogValue(e.message || e));
                completion({ error: { type: 'api', message: '音频处理失败' } });
            }
    });
}
