import { smartChannel } from '../audio/curves';
import { useMixer } from '../state/mixer';
import { useSettings } from '../state/settings';

/** A channel's low EQ and filter as they sound: the knobs plus the smart crossfader's move. */
export function useSmartChannel(deck: number): { eqLow: number; filter: number } {
  const c = useMixer((s) => s.ch[deck]);
  const x = useMixer((s) => s.xfader);
  const mode = useSettings((s) => s.crossfaderMode);
  return smartChannel(mode, x, deck, c.eqLow, c.filter);
}
