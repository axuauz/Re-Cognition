/**
 * EqualiUI Offscreen Transcriber — 청각 정보를 시각 정보로 (자막이 없는 영상·소리용)
 *
 * 서비스 워커가 넘겨 준 탭 오디오 스트림을 짧은 구간으로 잘라 음성 인식 API 로 보내고, 받은 글자를 돌려준다.
 *   - 사용자가 "소리를 글자로 바꾸기"를 직접 누른 탭에서만, 끌 때까지만 동작한다.
 *   - 조용한 구간은 보내지 않는다 (비용·개인정보 최소화). 소리의 세기는 "소리 있음" 표시로도 쓰인다.
 *   - 녹음은 저장하지 않는다. 구간은 전송 직후 버린다.
 *   - 탭 소리를 가로채면 원래 소리가 꺼지므로, 같은 소리를 다시 스피커로 내보낸다.
 */
const CHUNK_MS = 5000; // 구간이 짧을수록 자막이 빨리 나오지만 호출 수가 늘고 문장이 더 자주 끊긴다 (8초 → 5초: 시연에서 지연을 줄이려고)
const SILENCE_RMS = 0.012;

let session = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'TRANSCRIBE_START') {
    start(message).then(() => sendResponse({ success: true })).catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (message.type === 'TRANSCRIBE_STOP') {
    stop();
    sendResponse({ success: true });
  }
});

const PROMPT = 'Transcribe the speech in this audio verbatim in its original language. Output only the transcript. If there is no speech, output nothing.';

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('오디오를 읽지 못했습니다.'));
  reader.readAsDataURL(blob);
});

// OpenRouter 의 오디오 입력은 wav/mp3 만 받는다 → webm 구간을 16kHz 모노 WAV 로 바꾼다 (5초 ≈ 160KB)
async function toWav(blob) {
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
  decodeCtx.close().catch(() => {});
  const RATE = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7FFF, true);
  return new Blob([view], { type: 'audio/wav' });
}

const report = (payload) => chrome.runtime.sendMessage({ type: 'TRANSCRIPT_EVENT', tabId: session && session.tabId, ...payload }).catch(() => {});

async function start({ streamId, tabId, apiKey, provider, model, language }) {
  stop();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(audioCtx.destination); // 사용자가 듣던 소리는 그대로 들리게
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  session = { tabId, stream, audioCtx, analyser, apiKey, provider, model, language, stopped: false, peak: 0, queue: Promise.resolve() };
  session.levelTimer = setInterval(() => {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    session.peak = Math.max(session.peak, rms);
    const active = rms > SILENCE_RMS;
    if (active !== session.lastActive) {
      session.lastActive = active;
      report({ kind: 'sound', active });
    }
  }, 250);

  recordNextChunk();
  report({ kind: 'state', state: 'listening' });
}

// 구간마다 녹음기를 새로 만들어야 각 구간이 혼자서도 재생 가능한 파일이 된다
function recordNextChunk() {
  if (!session || session.stopped) return;
  const current = session;
  const recorder = new MediaRecorder(current.stream, { mimeType: 'audio/webm;codecs=opus' });
  const parts = [];
  current.peak = 0;
  recorder.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
  recorder.onstop = () => {
    const loud = current.peak > SILENCE_RMS;
    if (loud && parts.length && !current.stopped) {
      const blob = new Blob(parts, { type: 'audio/webm' });
      current.queue = current.queue.then(() => transcribe(current, blob)).catch((e) => report({ kind: 'error', error: e.message }));
    }
    recordNextChunk();
  };
  recorder.start();
  current.recorder = recorder;
  current.chunkTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, CHUNK_MS);
}

async function transcribe(current, blob) {
  if (current.stopped) return;
  let text = '';
  if (current.provider === 'gemini') {
    const base64 = await toBase64(blob);
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': current.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [
        { text: PROMPT },
        { inline_data: { mime_type: 'audio/webm', data: base64 } }
      ] }], generationConfig: { temperature: 0 } })
    });
    if (!res.ok) throw new Error(`음성 인식 오류 (${res.status})`);
    const data = await res.json();
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else if (current.provider === 'openrouter') {
    const base64 = await toBase64(await toWav(blob));
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.apiKey}` },
      body: JSON.stringify({ model: current.model, temperature: 0, messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'input_audio', input_audio: { data: base64, format: 'wav' } }
      ] }] })
    });
    if (!res.ok) throw new Error(`음성 인식 오류 (${res.status}): ${(await res.text()).slice(0, 160)}`);
    text = (await res.json()).choices?.[0]?.message?.content || '';
  } else {
    const form = new FormData();
    form.append('file', blob, 'chunk.webm');
    form.append('model', 'whisper-1');
    if (current.language) form.append('language', current.language);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${current.apiKey}` }, body: form });
    if (!res.ok) throw new Error(`음성 인식 오류 (${res.status})`);
    text = (await res.json()).text || '';
  }
  text = text.trim();
  if (text && !current.stopped) report({ kind: 'text', text: text.slice(0, 400) });
}

function stop() {
  if (!session) return;
  const s = session;
  session = null;
  s.stopped = true;
  clearInterval(s.levelTimer);
  clearTimeout(s.chunkTimer);
  try { if (s.recorder && s.recorder.state === 'recording') s.recorder.stop(); } catch (e) {}
  s.stream.getTracks().forEach((t) => t.stop());
  s.audioCtx.close().catch(() => {});
}
