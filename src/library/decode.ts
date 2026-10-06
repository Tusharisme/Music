/** Decoding helpers for analysis (22.05 kHz) and playback (context rate). */

export const ANALYSIS_RATE = 22050;

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor {
  const w = window as unknown as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  const C = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!C) throw new Error('Web Audio is not supported in this browser');
  return C;
}

/** Decode compressed audio at a low sample rate for analysis. */
export async function decodeForAnalysis(
  blob: Blob,
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const Ctor = offlineCtor();
  try {
    const ctx = new Ctor(1, 1, ANALYSIS_RATE);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return {
      channels: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i)),
      sampleRate: buf.sampleRate,
    };
  } catch {
    // Some browsers refuse low-rate offline contexts: decode at 44.1 kHz and let the analyzer cope.
    const ctx = new Ctor(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return {
      channels: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i)),
      sampleRate: buf.sampleRate,
    };
  }
}

/** Decode at the playback context's rate. */
export async function decodeForPlayback(blob: Blob, ctx: BaseAudioContext): Promise<AudioBuffer> {
  return ctx.decodeAudioData(await blob.arrayBuffer());
}
