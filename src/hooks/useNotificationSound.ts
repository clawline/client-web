const SOUND_ENABLED_KEY = 'openclaw.soundEnabled';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function isSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(SOUND_ENABLED_KEY);
    return val !== 'false'; // default on
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  } catch { /* ignore */ }
}

export function getSoundEnabled(): boolean {
  return isSoundEnabled();
}

function playTone(frequency: number, duration: number, volume = 0.15) {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

/** Short ding — new message arrived */
export function playNewMessage() {
  playTone(880, 0.15, 0.12);
  setTimeout(() => playTone(1100, 0.1, 0.08), 100);
}

/** Double tone — urgent, multiple unread */
export function playUrgent() {
  playTone(660, 0.12, 0.15);
  setTimeout(() => playTone(880, 0.12, 0.15), 150);
  setTimeout(() => playTone(1100, 0.15, 0.1), 300);
}
