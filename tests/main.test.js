'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

class MockData {
    constructor(bytes, hooks) {
        this.bytes = Uint8Array.from(bytes || []);
        this.hooks = hooks || {};
        this.__mockData = true;
    }

    get length() {
        return this.hooks.length == null ? this.bytes.byteLength : this.hooks.length;
    }

    appendData(other) {
        this.bytes = Uint8Array.from(Buffer.concat([
            Buffer.from(this.bytes),
            Buffer.from(other.bytes)
        ]));
    }

    toBase64() {
        if (this.hooks.onBase64) {
            this.hooks.onBase64();
        }
        return Buffer.from(this.bytes).toString('base64');
    }

    toUTF8() {
        if (this.hooks.onUTF8) {
            this.hooks.onUTF8();
        }
        return Buffer.from(this.bytes).toString('utf8');
    }

    readUInt8(index) {
        return index >= 0 && index < this.bytes.length ? this.bytes[index] : 0;
    }
}

function options(overrides) {
    return Object.assign({
        apiKey: 'sk-test-one',
        apiUrl: 'https://openrouter.ai/api/v1/audio/speech',
        model: 'google/gemini-3.1-flash-tts-preview',
        customModel: '',
        voiceGemini: 'Kore',
        customVoice: '',
        responseFormat: 'pcm',
        pcmSampleRate: '24000',
        speed: '1.0',
        instructions: ''
    }, overrides || {});
}

function runPlugin(sandbox) {
    vm.createContext(sandbox);
    new vm.Script(source, { filename: 'main.js' }).runInContext(sandbox);
    return sandbox;
}

function createFallbackPlugin(pluginOptions, responder) {
    const state = { requests: [], infoLogs: [], errorLogs: [], signals: [], timers: [], invalidatedTimers: [] };
    const sandbox = {
        $option: pluginOptions,
        $log: {
            info(message) { state.infoLogs.push(message); },
            error(message) { state.errorLogs.push(message); }
        },
        $data: {
            fromData(value) {
                return new MockData(value.bytes);
            },
            fromByteArray(value) {
                return new MockData(value);
            },
            fromBase64(value) {
                return new MockData(Buffer.from(value, 'base64'));
            },
            isData(value) {
                return !!(value && value.__mockData);
            }
        },
        $signal: {
            new() {
                const signal = {
                    sent: false,
                    sendCount: 0,
                    send() {
                        signal.sent = true;
                        signal.sendCount += 1;
                    }
                };
                state.signals.push(signal);
                return signal;
            }
        },
        $timer: {
            schedule(timer) {
                state.timers.push(timer);
                return state.timers.length;
            },
            invalidate(timerId) {
                state.invalidatedTimers.push(timerId);
            }
        },
        $http: {
            streamRequest(request) {
                state.requests.push(request);
                const response = responder(request, state.requests.length) || {};
                if (response.rawData) {
                    request.streamHandler({ rawData: response.rawData });
                }
                request.handler({ error: response.error, response: response.response });
            }
        }
    };
    return { context: runPlugin(sandbox), state };
}

function createStreamPlugin(pluginOptions, scenario) {
    const state = { requests: [], signals: [], completionCount: 0 };
    const sandbox = {
        $option: pluginOptions,
        $log: { info() {}, error() {} },
        $data: {
            fromData(value) {
                return new MockData(value.bytes);
            },
            fromByteArray(value) {
                return new MockData(value);
            },
            fromBase64(value) {
                return new MockData(Buffer.from(value, 'base64'));
            },
            isData(value) {
                return !!(value && value.__mockData);
            }
        },
        $signal: {
            new() {
                const signal = {
                    sent: false,
                    sendCount: 0,
                    send() {
                        signal.sent = true;
                        signal.sendCount += 1;
                        if (scenario.reenterHandlerOnCancel && state.activeRequest) {
                            state.activeRequest.handler({
                                error: { message: 'cancelled synchronously' },
                                response: scenario.response
                            });
                        }
                    }
                };
                state.signals.push(signal);
                return signal;
            }
        },
        $http: {
            streamRequest(request) {
                state.requests.push(request);
                state.activeRequest = request;
                const chunks = typeof scenario.chunks === 'function' ? scenario.chunks() : scenario.chunks;
                for (const chunk of chunks || []) {
                    if (request.cancelSignal.sent) {
                        break;
                    }
                    request.streamHandler({ rawData: new MockData(chunk) });
                }
                request.handler({
                    error: request.cancelSignal.sent && scenario.errorOnCancel
                        ? { message: 'cancelled' }
                        : scenario.error,
                    response: scenario.response || {
                        statusCode: 200,
                        MIMEType: 'audio/pcm',
                        headers: {}
                    }
                });
            }
        }
    };
    return { context: runPlugin(sandbox), state };
}

function createUnsupportedPlugin(pluginOptions) {
    const state = { requests: [], completionCount: 0 };
    const sandbox = {
        $option: pluginOptions,
        $log: { info() {}, error() {} },
        $http: {}
    };
    return { context: runPlugin(sandbox), state };
}

function createDeferredPlugin(pluginOptions) {
    const state = { pending: [], completionCount: 0 };
    const sandbox = {
        $option: pluginOptions,
        $log: { info() {}, error() {} },
        $data: {
            fromData(value) { return new MockData(value.bytes); },
            fromByteArray(value) { return new MockData(value); },
            fromBase64(value) { return new MockData(Buffer.from(value, 'base64')); },
            isData(value) { return !!(value && value.__mockData); }
        },
        $signal: {
            new() {
                return { send() {} };
            }
        },
        $http: {
            streamRequest(request) {
                state.pending.push(request);
            }
        }
    };
    return { context: runPlugin(sandbox), state };
}

function completeDeferredRequest(request, bytes) {
    request.streamHandler({ rawData: new MockData(bytes) });
    request.handler({
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    });
}

function callTts(plugin, query) {
    let output;
    plugin.context.tts(Object.assign({ text: 'Hello', lang: 'en' }, query || {}), (value) => {
        plugin.state.completionCount = (plugin.state.completionCount || 0) + 1;
        output = value;
    });
    assert.ok(output, 'tts completion should be called synchronously by the mock');
    return output;
}

function wavSampleRate(base64) {
    return Buffer.from(base64, 'base64').readUInt32LE(24);
}

function startsWithAscii(base64, value) {
    return Buffer.from(base64, 'base64').subarray(0, value.length).toString('ascii') === value;
}

test('uses Bob pt-br language code', () => {
    const plugin = createFallbackPlugin(options(), () => ({}));
    const languages = Array.from(plugin.context.supportLanguages());
    assert.equal(languages.includes('pt-br'), true);
    assert.equal(languages.includes('pt-BR'), false);
});

test('uses SHA-256 digests for non-sensitive cache keys', () => {
    const plugin = createFallbackPlugin(options(), () => ({}));
    assert.equal(
        plugin.context.sha256Hex('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    assert.equal(
        plugin.context.sha256Hex('你好🙂'),
        crypto.createHash('sha256').update('你好🙂').digest('hex')
    );
    const key = plugin.context.makeCacheKey(
        'private text',
        'en',
        'https://example.test?token=private',
        'model',
        'voice',
        'private instruction',
        'pcm',
        1,
        24000,
        plugin.context.getApiKeyCacheScope('sk-private-key')
    );
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(key.includes('private'), false);
});

test('base64 helpers decode data URIs and whitespace without whole-string cleanup', () => {
    const plugin = createFallbackPlugin(options(), () => ({}));
    const decoded = plugin.context.base64Decode('data:audio/pcm;base64, AQID\nBA== ');
    assert.deepEqual(Array.from(decoded), [1, 2, 3, 4]);
    assert.equal(plugin.context.base64DecodedByteLength('AQIDBA=='), 4);

    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);
    const dataUriResult = plugin.context.processAudioBase64(
        `data:audio/mpeg;base64,${mp3.toString('base64')}`,
        'mp3',
        'audio/mpeg',
        24000
    );
    assert.equal(dataUriResult.value, mp3.toString('base64'));
});

test('preserves query and fragment while completing API paths', () => {
    const pluginOptions = options();
    const plugin = createFallbackPlugin(pluginOptions, () => ({}));
    const cases = [
        ['https://openrouter.ai?x=1', 'https://openrouter.ai/api/v1/audio/speech?x=1'],
        ['https://openrouter.ai/api?x=1', 'https://openrouter.ai/api/v1/audio/speech?x=1'],
        ['https://openrouter.ai/api/v1?x=1#f', 'https://openrouter.ai/api/v1/audio/speech?x=1#f'],
        ['https://example.test/audio/speech?x=1', 'https://example.test/audio/speech?x=1'],
        ['https://example.test/tts#fragment', 'https://example.test/tts#fragment']
    ];

    for (const [input, expected] of cases) {
        pluginOptions.apiUrl = input;
        assert.equal(plugin.context.getApiUrl(), expected);
    }
});

test('requires TLS for remote API URLs and strictly validates loopback authorities', () => {
    const pluginOptions = options();
    const plugin = createFallbackPlugin(pluginOptions, () => ({}));

    for (const url of [
        'http://localhost:8080',
        'http://127.0.0.1:8080',
        'http://127.12.34.56',
        'http://[::1]:8080'
    ]) {
        pluginOptions.apiUrl = url;
        assert.equal(plugin.context.validateApiUrl(), null, url);
    }

    for (const url of [
        'http://example.com',
        'http://localhost.evil.test',
        'http://localhost@evil.test',
        'http://evil@localhost',
        'http://evil\\@localhost',
        'http://127.0.0.1.evil.test',
        'http://127.0.0.999',
        'http://[::1].evil.test',
        'http://[localhost]',
        'http://[127.0.0.1]',
        'https://:443',
        'https://@'
    ]) {
        pluginOptions.apiUrl = url;
        assert.ok(plugin.context.validateApiUrl(), url);
    }

    pluginOptions.apiUrl = 'http://example.com';
    const result = callTts(plugin);
    assert.match(result.error.message, /HTTPS/);
    assert.equal(plugin.state.requests.length, 0);
});

test('Custom Voice overrides recognized-family menus and clearing restores the menu voice', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const firstOptions = options({ customVoice: 'my-provider-voice', voiceGemini: 'Kore' });
    const first = createFallbackPlugin(firstOptions, () => ({
        rawData: new MockData(pcm),
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    }));
    const firstResult = callTts(first);
    assert.equal(first.state.requests[0].body.voice, 'my-provider-voice');
    assert.equal(firstResult.result.raw.voice, 'my-provider-voice');

    const secondOptions = options({ customVoice: '', voiceGemini: 'Puck' });
    const second = createFallbackPlugin(secondOptions, () => ({
        rawData: new MockData(pcm),
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    }));
    callTts(second);
    assert.equal(second.state.requests[0].body.voice, 'Puck');
});

test('prefers inline audio over the JSON envelope rawData', () => {
    let rawBase64Calls = 0;
    const pcm = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    const envelope = {
        candidates: [{
            content: {
                parts: [{
                    inlineData: {
                        data: pcm.toString('base64'),
                        mimeType: 'audio/pcm'
                    }
                }]
            }
        }]
    };
    const plugin = createFallbackPlugin(options(), () => ({
        data: envelope,
        rawData: new MockData(Buffer.from(JSON.stringify(envelope)), {
            onBase64() {
                rawBase64Calls += 1;
                throw new Error('JSON envelope must not be encoded as audio');
            }
        }),
        response: { statusCode: 200, MIMEType: 'application/json', headers: {} }
    }));

    const result = callTts(plugin);
    assert.equal(rawBase64Calls, 0);
    assert.equal(result.result.raw.format, 'wav');
    assert.equal(startsWithAscii(result.result.value, 'RIFF'), true);
});

test('rejects JSON rawData with explicit or missing MIME without base64 conversion', () => {
    for (const mimeType of ['application/json', '']) {
        let rawBase64Calls = 0;
        const plugin = createFallbackPlugin(options(), () => ({
            data: { error: { message: 'not audio' } },
            rawData: new MockData(Buffer.from('{"error":{"message":"not audio"}}'), {
                onBase64() {
                    rawBase64Calls += 1;
                    throw new Error('JSON must not be encoded as audio');
                }
            }),
            response: { statusCode: 200, MIMEType: mimeType, headers: {} }
        }));

        const result = callTts(plugin);
        assert.match(result.error.message, /没有返回音频数据/);
        assert.equal(rawBase64Calls, 0);
    }
});

test('keeps binary audio when Bob also exposes a decoded UTF-8 string', () => {
    let rawBase64Calls = 0;
    const pcm = Buffer.from([0, 0, 0, 0]);
    const plugin = createFallbackPlugin(options(), () => ({}));
    const payload = plugin.context.getAudioPayload({
        data: '\0\0\0\0',
        rawData: new MockData(pcm, {
            onBase64() { rawBase64Calls += 1; }
        }),
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    });

    const result = plugin.context.processAudioPayload(payload, 'pcm', 24000);
    assert.equal(result.outputFormat, 'wav');
    assert.equal(rawBase64Calls, 0, 'raw PCM should be wrapped as native data before one final base64 conversion');
    assert.deepEqual(
        Array.from(Buffer.from(result.value, 'base64').subarray(44)),
        [0, 0, 0, 0]
    );
});

test('rejects truncated odd-length 16-bit PCM', () => {
    const plugin = createFallbackPlugin(options(), () => ({}));
    assert.throws(
        () => plugin.context.processAudioData(new MockData([1]), 'pcm', 'audio/pcm', 24000),
        /偶数/
    );
    assert.throws(
        () => plugin.context.processAudioBase64(Buffer.from([1]).toString('base64'), 'pcm', 'audio/pcm', 24000),
        /偶数/
    );
});

test('rejects malformed inline data and explicitly non-audio MIME types', () => {
    let rawBase64Calls = 0;
    const plugin = createFallbackPlugin(options(), () => ({
        data: {
            candidates: [{ content: { parts: [{ inlineData: { data: { invalid: true } } }] } }]
        },
        rawData: new MockData(Buffer.from('not an image'), {
            onBase64() { rawBase64Calls += 1; }
        }),
        response: { statusCode: 200, MIMEType: 'image/png', headers: {} }
    }));

    const result = callTts(plugin);
    assert.match(result.error.message, /没有返回音频数据/);
    assert.equal(rawBase64Calls, 0);

    const invalidBase64Payload = plugin.context.getAudioPayload({
        data: {
            candidates: [{
                content: {
                    parts: [{ inlineData: { data: '%%%', mimeType: 'audio/mpeg' } }]
                }
            }]
        }
    });
    assert.equal(invalidBase64Payload, null);
});

test('uses actual response MIME instead of the requested format', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const pcmPlugin = createFallbackPlugin(options({ responseFormat: 'mp3' }), () => ({
        rawData: new MockData(pcm),
        response: {
            statusCode: 200,
            MIMEType: 'audio/mpeg',
            headers: { 'cOnTeNt-TyPe': 'audio/pcm; rate=24000' }
        }
    }));
    const pcmResult = callTts(pcmPlugin);
    assert.equal(pcmResult.result.raw.format, 'wav');
    assert.equal(startsWithAscii(pcmResult.result.value, 'RIFF'), true);

    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
    const mp3Plugin = createFallbackPlugin(options({ responseFormat: 'pcm' }), () => ({
        rawData: new MockData(mp3),
        response: {
            statusCode: 200,
            MIMEType: 'application/octet-stream',
            headers: { 'Content-Type': 'audio/mpeg' }
        }
    }));
    const mp3Result = callTts(mp3Plugin);
    assert.equal(mp3Result.result.raw.format, 'mp3');
    assert.equal(mp3Result.result.value, mp3.toString('base64'));
});

test('PCM sample rate and API-key scope are part of the cache key', () => {
    const pluginOptions = options({ pcmSampleRate: '24000' });
    const pcm = Buffer.from([1, 2, 3, 4]);
    const plugin = createFallbackPlugin(pluginOptions, () => ({
        rawData: new MockData(pcm),
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    }));

    const first = callTts(plugin, { text: 'cache me' });
    assert.equal(plugin.state.requests.length, 1);
    assert.equal(wavSampleRate(first.result.value), 24000);

    pluginOptions.pcmSampleRate = '48000';
    const second = callTts(plugin, { text: 'cache me' });
    assert.equal(plugin.state.requests.length, 2);
    assert.equal(wavSampleRate(second.result.value), 48000);

    const third = callTts(plugin, { text: 'cache me' });
    assert.equal(plugin.state.requests.length, 2);
    assert.equal(third.result.raw.cache, 'hit');

    pluginOptions.apiKey = 'sk-test-two';
    callTts(plugin, { text: 'cache me' });
    assert.equal(plugin.state.requests.length, 3);
    assert.ok(plugin.state.invalidatedTimers.length >= 2);

    pluginOptions.apiKey = 'sk-test-one';
    callTts(plugin, { text: 'cache me' });
    assert.equal(plugin.state.requests.length, 4);
});

test('cache expiry timer removes idle entries without another lookup', () => {
    const plugin = createFallbackPlugin(options(), () => ({
        rawData: new MockData([1, 2, 3, 4]),
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    }));
    callTts(plugin, { text: 'expire me' });
    assert.equal(plugin.context.AUDIO_CACHE_ORDER.length, 1);
    assert.equal(plugin.state.timers.length, 1);

    plugin.state.timers[0].handler();
    assert.equal(plugin.context.AUDIO_CACHE_ORDER.length, 0);
});

test('an in-flight request cannot repopulate cache after API-key rotation', () => {
    const pluginOptions = options({ apiKey: 'sk-key-a' });
    const plugin = createDeferredPlugin(pluginOptions);
    let firstResult;
    let secondResult;
    let thirdResult;

    plugin.context.tts({ text: 'same text', lang: 'en' }, (value) => { firstResult = value; });
    pluginOptions.apiKey = 'sk-key-b';
    plugin.context.tts({ text: 'same text', lang: 'en' }, (value) => { secondResult = value; });
    pluginOptions.apiKey = 'sk-key-a';
    plugin.context.tts({ text: 'same text', lang: 'en' }, (value) => { thirdResult = value; });
    assert.equal(plugin.state.pending.length, 3);

    completeDeferredRequest(plugin.state.pending[0], [1, 2, 3, 4]);
    assert.ok(firstResult && firstResult.result);
    assert.equal(plugin.context.AUDIO_CACHE_ORDER.length, 0);

    completeDeferredRequest(plugin.state.pending[1], [5, 6, 7, 8]);
    assert.ok(secondResult && secondResult.result);
    assert.equal(plugin.context.AUDIO_CACHE_ORDER.length, 0);

    completeDeferredRequest(plugin.state.pending[2], [9, 10, 11, 12]);
    assert.ok(thirdResult && thirdResult.result);
    assert.equal(plugin.context.AUDIO_CACHE_ORDER.length, 1);
});

test('MP3 sniffing rejects weak PCM-like prefixes but keeps high-confidence MP3', () => {
    const plugin = createFallbackPlugin(options(), () => ({}));
    const falsePositive = Buffer.from([0xFF, 0xFB, 0x90, 0x64, 1, 2, 3, 4]);
    const pcmResult = plugin.context.processAudioBase64(falsePositive.toString('base64'), 'pcm', '', 24000);
    assert.equal(pcmResult.outputFormat, 'wav');
    assert.equal(startsWithAscii(pcmResult.value, 'RIFF'), true);

    const id3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const id3Result = plugin.context.processAudioBase64(id3.toString('base64'), 'wav', '', 24000);
    assert.equal(id3Result.outputFormat, 'mp3');
    assert.equal(id3Result.value, id3.toString('base64'));

    const frameLength = 417;
    const twoFrames = Buffer.alloc(frameLength + 5);
    Buffer.from([0xFF, 0xFB, 0x90, 0x64]).copy(twoFrames, 0);
    Buffer.from([0xFF, 0xFB, 0x90, 0x64]).copy(twoFrames, frameLength);
    const frameResult = plugin.context.processAudioBase64(twoFrames.toString('base64'), 'wav', '', 24000);
    assert.equal(frameResult.outputFormat, 'mp3');

    const explicitPcmResult = plugin.context.processAudioBase64(twoFrames.toString('base64'), 'pcm', '', 24000);
    assert.equal(explicitPcmResult.outputFormat, 'wav');
});

test('single oversized stream chunk is rejected before base64 conversion', () => {
    let rawBase64Calls = 0;
    const oversized = new MockData([1], {
        length: (64 * 1024 * 1024) + 1,
        onBase64() {
            rawBase64Calls += 1;
            throw new Error('oversized response must not be converted');
        }
    });
    const plugin = createFallbackPlugin(options(), () => ({
        rawData: oversized,
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    }));

    const result = callTts(plugin);
    assert.match(result.error.message, /64 MiB/);
    assert.equal(rawBase64Calls, 0);
});

test('fails closed when safe streaming APIs are unavailable', () => {
    const plugin = createUnsupportedPlugin(options());
    const result = callTts(plugin);
    assert.match(result.error.message, /Bob 1\.8\.0/);
    assert.equal(plugin.state.requests.length, 0);
});

test('streaming path aggregates chunks and accepts the exact size boundary', () => {
    const scenario = {
        chunks: [Buffer.from([1, 2]), Buffer.from([3, 4])],
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    };
    const plugin = createStreamPlugin(options(), scenario);
    plugin.context.MAX_AUDIO_BYTES = 4;

    const result = callTts(plugin);
    assert.equal(plugin.state.requests.length, 1);
    assert.equal(plugin.state.signals[0].sendCount, 0);
    assert.equal(plugin.state.completionCount, 1);
    assert.equal(result.result.raw.format, 'wav');
    assert.deepEqual(
        Array.from(Buffer.from(result.result.value, 'base64').subarray(44)),
        [1, 2, 3, 4]
    );
});

test('streaming path cancels cumulative overflow and completes only once', () => {
    const scenario = {
        chunks: [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])],
        errorOnCancel: true,
        reenterHandlerOnCancel: true,
        response: { statusCode: 200, MIMEType: 'audio/pcm', headers: {} }
    };
    const plugin = createStreamPlugin(options(), scenario);
    plugin.context.MAX_AUDIO_BYTES = 4;

    const result = callTts(plugin);
    assert.match(result.error.message, /响应超过/);
    assert.equal(plugin.state.signals[0].sendCount, 1);
    assert.equal(plugin.state.completionCount, 1);
});

test('streaming path honors an oversized declared content length', () => {
    const plugin = createStreamPlugin(options(), {
        chunks: [Buffer.from([1, 2])],
        response: {
            statusCode: 200,
            MIMEType: 'audio/pcm',
            expectedContentLength: 5,
            headers: {}
        }
    });
    plugin.context.MAX_AUDIO_BYTES = 4;

    const result = callTts(plugin);
    assert.match(result.error.message, /响应超过/);
    assert.equal(plugin.state.completionCount, 1);
});

test('streaming path parses generic-MIME JSON and extracts inline audio', () => {
    const pcm = Buffer.from([9, 8, 7, 6]);
    const envelope = Buffer.from(JSON.stringify({
        candidates: [{
            content: {
                parts: [{
                    inlineData: {
                        data: pcm.toString('base64'),
                        mimeType: 'audio/pcm'
                    }
                }]
            }
        }]
    }));
    const plugin = createStreamPlugin(options(), {
        chunks: [envelope.subarray(0, 11), envelope.subarray(11)],
        response: { statusCode: 200, MIMEType: 'application/octet-stream', headers: {} }
    });

    const result = callTts(plugin);
    assert.equal(result.result.raw.format, 'wav');
    assert.deepEqual(
        Array.from(Buffer.from(result.result.value, 'base64').subarray(44)),
        [9, 8, 7, 6]
    );
});

test('streaming path parses UTF-8 JSON errors only after byte aggregation', () => {
    const errorBody = Buffer.from(JSON.stringify({ detail: '请求失败' }));
    const splitAt = errorBody.indexOf(Buffer.from('请')) + 1;
    const plugin = createStreamPlugin(options(), {
        chunks: [errorBody.subarray(0, splitAt), errorBody.subarray(splitAt)],
        response: { statusCode: 400, MIMEType: 'application/octet-stream', headers: {} }
    });

    const result = callTts(plugin);
    assert.equal(result.error.message, '请求失败');
    assert.equal(plugin.state.completionCount, 1);
});

test('streaming 2xx JSON error without a useful MIME is never returned as audio', () => {
    const body = Buffer.from('{"error":{"message":"still not audio"}}');
    const plugin = createStreamPlugin(options(), {
        chunks: [body],
        response: { statusCode: 200, MIMEType: '', headers: {} }
    });

    const result = callTts(plugin);
    assert.match(result.error.message, /没有返回音频数据/);
});

test('streaming JSON is rejected even when the server mislabels it as audio', () => {
    for (const mimeType of ['audio/mpeg', 'audio/pcm']) {
        const plugin = createStreamPlugin(options(), {
            chunks: [Buffer.from('{"error":{"message":"mislabeled"}}')],
            response: { statusCode: 200, MIMEType: mimeType, headers: {} }
        });
        const result = callTts(plugin);
        assert.match(result.error.message, /没有返回音频数据/, mimeType);
    }
});

test('streaming generic-MIME primitive JSON is never returned as audio', () => {
    const plugin = createStreamPlugin(options(), {
        chunks: [Buffer.from('null')],
        response: { statusCode: 200, MIMEType: 'application/octet-stream', headers: {} }
    });

    const result = callTts(plugin);
    assert.match(result.error.message, /没有返回音频数据/);
});
