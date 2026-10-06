/** Small custom effects that need per-sample control: bit crusher and beat gate. */

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 4, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
    ];
  }

  private held = [0, 0];
  private counter = 0;

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const bits = params.bits[0];
    const step = Math.pow(0.5, bits - 1);
    const ds = Math.max(1, Math.round(params.downsample[0]));
    const n = output[0].length;
    for (let i = 0; i < n; i++) {
      if (this.counter <= 0) {
        for (let c = 0; c < output.length; c++) {
          const x = (input[c] ?? input[0])[i];
          this.held[c] = step * Math.round(x / step);
        }
        this.counter = ds;
      }
      this.counter--;
      for (let c = 0; c < output.length; c++) output[c][i] = this.held[c] ?? 0;
    }
    return true;
  }
}

interface GateTiming {
  /** Context time at which `beat` was valid. */
  refTime: number;
  beat: number;
  /** Beats per second (0 = free-running at 2 Hz). */
  bps: number;
}

class BeatGateProcessor extends AudioWorkletProcessor {
  private timing: GateTiming = { refTime: 0, beat: 0, bps: 2 };
  private division = 0.25;
  private depth = 1;
  private env = 1;
  private readonly smooth = 1 - Math.exp(-1 / (0.0015 * sampleRate));

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data as Partial<GateTiming> & { division?: number; depth?: number };
      if (m.refTime !== undefined && m.beat !== undefined && m.bps !== undefined) {
        this.timing = { refTime: m.refTime, beat: m.beat, bps: m.bps };
      }
      if (m.division !== undefined) this.division = Math.max(1 / 32, m.division);
      if (m.depth !== undefined) this.depth = Math.max(0, Math.min(1, m.depth));
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const n = output[0].length;
    const { refTime, beat, bps } = this.timing;
    const rate = bps > 0 ? bps : 2;
    for (let i = 0; i < n; i++) {
      const t = currentTime + i / sampleRate;
      const b = beat + (t - refTime) * rate;
      const phase = (b / this.division) % 1;
      const open = (phase < 0 ? phase + 1 : phase) < 0.5;
      const target = open ? 1 : 1 - this.depth;
      this.env += (target - this.env) * this.smooth;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ?? input[0])[i] * this.env;
    }
    return true;
  }
}

registerProcessor('bitcrusher', BitcrusherProcessor);
registerProcessor('beat-gate', BeatGateProcessor);
