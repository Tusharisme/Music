/** Message protocol between the main thread and the deck-engine AudioWorklet. */

export type EngineCommand =
  | {
      type: 'load';
      deck: number;
      L: Int16Array;
      R: Int16Array;
      sampleRate: number;
      bpm: number;
      firstBeat: number;
    }
  | { type: 'unload'; deck: number }
  | { type: 'play'; deck: number }
  | { type: 'pause'; deck: number }
  | { type: 'seek'; deck: number; sec: number; smooth?: boolean; keepPhase?: boolean }
  | { type: 'tempo'; deck: number; rate: number }
  | { type: 'keyLock'; deck: number; on: boolean }
  | { type: 'keyShift'; deck: number; semis: number }
  | { type: 'bend'; deck: number; amount: number }
  | { type: 'grid'; deck: number; bpm: number; firstBeat: number }
  | { type: 'loop'; deck: number; startSec: number; endSec: number }
  | { type: 'loopOff'; deck: number }
  | { type: 'roll'; deck: number; beats: number }
  | { type: 'rollEnd'; deck: number }
  | { type: 'beatJump'; deck: number; beats: number }
  | { type: 'scratchStart'; deck: number }
  | { type: 'scratchMove'; deck: number; sec: number; vel: number }
  | { type: 'scratchEnd'; deck: number }
  | { type: 'brake'; deck: number; seconds: number }
  | { type: 'spinback'; deck: number; seconds: number }
  | { type: 'reverse'; deck: number; on: boolean }
  | { type: 'slip'; deck: number; on: boolean }
  | { type: 'master'; deck: number }
  | { type: 'syncMode'; deck: number; mode: SyncMode }
  | { type: 'alignPhase'; deck: number }
  | { type: 'arm'; deck: number; trigger: number; triggerSec: number; startSec: number }
  | { type: 'disarm'; deck: number }
  | { type: 'tempoRamp'; deck: number; to: number; seconds: number }
  /** Run `cmd` when `deck` plays across `sec` (sample accurate). */
  | { type: 'at'; deck: number; sec: number; cmd: EngineCommand; tag?: string }
  | { type: 'cancelAt'; deck: number; tag?: string };

export type SyncMode = 'off' | 'tempo' | 'beat';

export interface DeckTick {
  /** Position in seconds of track time. */
  pos: number;
  /** Tempo ratio (pitch fader / sync), excluding bends. */
  tempo: number;
  /** Current playback rate (0 when stopped). */
  rate: number;
  playing: boolean;
  loopOn: boolean;
  loopStart: number;
  loopEnd: number;
  slipActive: boolean;
  slipPos: number;
  armed: boolean;
  scratching: boolean;
}

export type EngineEvent =
  | { type: 'tick'; time: number; decks: DeckTick[] }
  | { type: 'ended'; deck: number }
  | { type: 'started'; deck: number; time: number }
  | { type: 'loaded'; deck: number };
