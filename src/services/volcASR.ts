/**
 * 语音转文本服务
 * 
 * 当前使用浏览器原生 Web Speech API（Chrome/Edge/Safari 支持）。
 * 火山引擎豆包 ASR 需要 WebSocket 自定义 headers，浏览器无法直接连接，
 * 后续通过 gateway 代理接入。
 * 
 * API keys 存储在 localStorage，供未来代理模式使用。
 */

const STORAGE_KEY = 'volcASR.config';

export interface VolcASRConfig {
  appKey: string;
  accessKey: string;
  resourceId: string;
}

const DEFAULT_CONFIG: VolcASRConfig = {
  appKey: '5657903170',
  accessKey: 'IleDHSzMi-vqSVGgsMGlBCqQmujsh_Of',
  resourceId: 'volc.bigasr.sauc.duration',
};

export function getASRConfig(): VolcASRConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return DEFAULT_CONFIG;
}

export function setASRConfig(config: Partial<VolcASRConfig>): void {
  const current = getASRConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }));
}

// ---- Web Speech API wrapper ----

// Extend Window type for vendor-prefixed SpeechRecognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SRInstance = any;
type SRConstructor = new () => SRInstance;

function getSpeechRecognitionCtor(): SRConstructor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as SRConstructor | null;
}

export function isSpeechRecognitionSupported(): boolean {
  return !!getSpeechRecognitionCtor();
}

export type ASRResultCallback = (text: string, isFinal: boolean) => void;

export class SpeechRecognitionSession {
  private recognition: SRInstance = null;
  private onResult: ASRResultCallback;
  private onError: (err: string) => void;
  private onEnd: () => void;
  private stopped = false;
  private restartOnEnd = false;

  constructor(opts: {
    onResult: ASRResultCallback;
    onError: (err: string) => void;
    onEnd: () => void;
  }) {
    this.onResult = opts.onResult;
    this.onError = opts.onError;
    this.onEnd = opts.onEnd;
  }

  start(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.onError('Speech recognition not supported in this browser');
      return;
    }

    this.stopped = false;
    this.restartOnEnd = true;

    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e: Event) => {
      const event = e as unknown as SpeechRecognitionEvent;
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        this.onResult(finalText, true);
      }
      if (interimText) {
        this.onResult(interimText, false);
      }
    };

    recognition.onerror = (e: Event) => {
      const error = e as unknown as { error: string };
      if (error.error === 'no-speech' || error.error === 'aborted') {
        // Ignore non-fatal errors
        return;
      }
      this.onError(error.error || 'Recognition error');
    };

    recognition.onend = () => {
      if (!this.stopped && this.restartOnEnd) {
        // Auto-restart for continuous recognition
        try {
          recognition.start();
        } catch {
          this.onEnd();
        }
        return;
      }
      this.onEnd();
    };

    try {
      recognition.start();
    } catch {
      this.onError('Failed to start recognition');
      return;
    }

    this.recognition = recognition;
  }

  stop(): void {
    this.stopped = true;
    this.restartOnEnd = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch { /* ignore */ }
      this.recognition = null;
    }
  }

  destroy(): void {
    this.stop();
  }
}
