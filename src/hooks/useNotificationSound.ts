const SOUND_ENABLED_KEY = 'openclaw.soundEnabled';

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  } catch { /* ignore */ }
}

export function getSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(SOUND_ENABLED_KEY);
    return val !== 'false'; // default on
  } catch {
    return true;
  }
}

// ── Base64-encoded short notification sounds (WAV) ──
// Generated programmatically: tiny sine-wave blips, ~100-200ms each

function generateWavBase64(frequencies: number[], durations: number[], volume = 0.3): string {
  const sampleRate = 22050;
  const totalDuration = durations.reduce((a, b) => a + b, 0);
  const numSamples = Math.floor(sampleRate * totalDuration);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Generate samples
  let offset = 0;
  for (let seg = 0; seg < frequencies.length; seg++) {
    const freq = frequencies[seg];
    const dur = durations[seg];
    const segSamples = Math.floor(sampleRate * dur);
    for (let i = 0; i < segSamples; i++) {
      const t = i / sampleRate;
      const envelope = Math.max(0, 1 - (t / dur) * 1.5); // fade out
      const sample = Math.sin(2 * Math.PI * freq * t) * volume * envelope;
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      view.setInt16(44 + (offset + i) * 2, intSample, true);
    }
    offset += segSamples;
  }

  // Convert to base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

// Cache generated data URLs
let _newMsgSound: string | null = null;
let _urgentSound: string | null = null;

function getNewMsgDataUrl(): string {
  if (!_newMsgSound) {
    // Two-tone ding: 880Hz + 1100Hz
    _newMsgSound = generateWavBase64([880, 1100], [0.12, 0.1], 0.25);
  }
  return _newMsgSound;
}

function getUrgentDataUrl(): string {
  if (!_urgentSound) {
    // Three-tone ascending: 660 → 880 → 1100
    _urgentSound = generateWavBase64([660, 880, 1100], [0.1, 0.1, 0.12], 0.3);
  }
  return _urgentSound;
}

function playSound(dataUrl: string) {
  if (!getSoundEnabled()) return;
  try {
    const audio = new Audio(dataUrl);
    audio.volume = 0.5;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { /* autoplay blocked, ignore */ });
    }
  } catch {
    // ignore
  }
}

/** Short ding — new message arrived */
export function playNewMessage() {
  playSound(getNewMsgDataUrl());
}

/** Triple tone — urgent, multiple unread */
export function playUrgent() {
  playSound(getUrgentDataUrl());
}
