/** Records the master output (post-limiter) with MediaRecorder. */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm',
];

export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export class MixRecorder {
  private readonly dest: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mime = '';

  constructor(ctx: AudioContext, tap: AudioNode) {
    this.dest = ctx.createMediaStreamDestination();
    tap.connect(this.dest);
  }

  get supported(): boolean {
    return pickRecordingMime() !== null;
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Milliseconds since recording started. */
  get elapsedMs(): number {
    return this.recording ? performance.now() - this.startedAt : 0;
  }

  start(): void {
    const mime = pickRecordingMime();
    if (mime === null) throw new Error('Recording is not supported in this browser.');
    this.mime = mime;
    this.chunks = [];
    this.recorder = new MediaRecorder(
      this.dest.stream,
      mime ? { mimeType: mime, audioBitsPerSecond: 256_000 } : undefined,
    );
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  stop(): Promise<{ blob: Blob; extension: string; durationMs: number }> {
    const rec = this.recorder;
    const durationMs = this.elapsedMs;
    return new Promise((resolve, reject) => {
      if (!rec) return reject(new Error('Not recording'));
      rec.onstop = () => {
        const type = rec.mimeType || this.mime || 'audio/webm';
        resolve({ blob: new Blob(this.chunks, { type }), extension: extensionForMime(type), durationMs });
        this.recorder = null;
      };
      rec.stop();
    });
  }
}
