import { create } from 'zustand';

export type MobileTab = 'decks' | 'mixer' | 'library' | 'ai';
export type Modal = null | 'settings' | 'help' | 'track' | 'welcome';
export type BottomTab = 'library' | 'ai' | 'history';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface UIState {
  tab: MobileTab;
  bottomTab: BottomTab;
  modal: Modal;
  editTrackId: string | null;
  toasts: Toast[];
  dragTrackId: string | null;
  midiLearn: boolean;
  midiLearnTarget: string | null;
  setTab: (t: MobileTab) => void;
  setBottomTab: (t: BottomTab) => void;
  open: (m: Modal, trackId?: string) => void;
  close: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  setDrag: (id: string | null) => void;
  setMidiLearn: (on: boolean) => void;
  setMidiLearnTarget: (t: string | null) => void;
}

let toastId = 1;

export const useUI = create<UIState>()((set, get) => ({
  tab: 'decks',
  bottomTab: 'library',
  modal: null,
  editTrackId: null,
  toasts: [],
  dragTrackId: null,
  midiLearn: false,
  midiLearnTarget: null,
  setTab: (tab) => set({ tab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  open: (modal, trackId) => set({ modal, editTrackId: trackId ?? null }),
  close: () => set({ modal: null, editTrackId: null }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setDrag: (dragTrackId) => set({ dragTrackId }),
  setMidiLearn: (midiLearn) => set({ midiLearn, midiLearnTarget: null }),
  setMidiLearnTarget: (midiLearnTarget) => set({ midiLearnTarget }),
}));
