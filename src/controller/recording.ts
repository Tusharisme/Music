import { create } from 'zustand';
import { engine } from '../audio/engine';
import { useHistory, tracklistText } from '../state/history';
import { useUI } from '../state/ui';

interface RecState {
  recording: boolean;
  startedAt: number;
  last: { url: string; name: string; size: number } | null;
}

export const useRecording = create<RecState>()(() => ({ recording: false, startedAt: 0, last: null }));

export async function toggleRecording(): Promise<void> {
  await engine.init();
  const rec = engine.recorder;
  const ui = useUI.getState();
  if (!rec || !rec.supported) {
    ui.toast('Recording is not supported in this browser.', 'error');
    return;
  }
  if (!rec.recording) {
    rec.start();
    useHistory.getState().clear();
    useRecording.setState({ recording: true, startedAt: performance.now() });
    // Note what's already playing as the first tracklist entry.
    ui.toast('Recording the master output…', 'info');
    return;
  }
  const { blob, extension } = await rec.stop();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `MixMind-set-${stamp}.${extension}`;
  const prev = useRecording.getState().last;
  if (prev) URL.revokeObjectURL(prev.url);
  const url = URL.createObjectURL(blob);
  useRecording.setState({ recording: false, last: { url, name, size: blob.size } });
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  const list = tracklistText(useHistory.getState().entries);
  if (list) {
    const t = document.createElement('a');
    t.href = URL.createObjectURL(new Blob([list], { type: 'text/plain' }));
    t.download = name.replace(/\.[a-z0-9]+$/, '-tracklist.txt');
    t.click();
  }
  ui.toast(`Saved ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`, 'success');
}
