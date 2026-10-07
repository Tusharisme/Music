import { eqKnobToGain, filterKnob, gainToDb, trimKnobToDb } from '../../audio/curves';

/** Read-outs for the mixer knobs. */
export const eqFmt = (v: number): string => {
  const g = eqKnobToGain(v);
  return g <= 0 ? 'KILL' : `${gainToDb(g) >= 0 ? '+' : ''}${gainToDb(g).toFixed(1)} dB`;
};

export const trimFmt = (v: number): string =>
  `${trimKnobToDb(v) >= 0 ? '+' : ''}${trimKnobToDb(v).toFixed(1)} dB`;

export const filterFmt = (v: number): string => {
  const f = filterKnob(v);
  if (Math.abs(v) < 0.02) return 'OFF';
  const hz = v < 0 ? f.lpHz : f.hpHz;
  return `${v < 0 ? 'LP' : 'HP'} ${hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : Math.round(hz)}`;
};
