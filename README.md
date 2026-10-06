# MixMind — the AI DJ mixer in your browser

A two-deck DJ mixer that runs entirely in the browser, on desktop, tablet and phone, with an AI that
listens to your music, tells you what to play next, and mixes it in for you.

![MixMind on desktop, in the middle of an AI transition](docs/desktop.webp)

<p align="center"><img src="docs/mobile.webp" alt="MixMind on a phone: decks, mixer and AI copilot" width="760"></p>

## What it does

### The AI

- **Hears your music.** Every track is analysed on your device: BPM and beat grid, downbeats, musical
  key (Camelot), energy (1–10), loudness, timbre, and song structure (intro, breakdowns, drops,
  outro, and the best mix-in and mix-out points).
- **Suggests what to play next.** It ranks your whole library against the playing track by harmonic
  compatibility (the Camelot wheel, including fixes by key shift), tempo fit (including half or
  double time), energy direction and sound. Each pick explains itself, for example _"8A → 9A lifts
  the energy"_ or _"125.0 BPM (−2.4%)"_. A vibe setting (keep, build, cool down, switch it up) steers
  the picks.
- **AI Mix.** One tap and it plans a transition, loads and beat-matches the track, starts it on the
  phrase at the exact sample, and performs the EQ, filter, fader and FX moves on the audio clock. It
  has nine techniques: bass-swap blend, long harmonic blend, filter fade, echo out, loop-roll build,
  quick cut, tempo-ramp blend, reverb wash and spinback. If you touch a control during a mix, that
  control is yours and the rest carries on. ✕ cancels the whole transition.
- **Auto DJ.** It plays a whole set hands-free, taking tracks from your queue or its own best pick
  and mixing each one in on the outro.
- **Claude copilot (optional).** Chat with a DJ assistant that can see your decks and library. It can
  pick tracks, suggest real-world songs to look up (with search links), and plan a whole set (for
  example _"60 minutes, warm-up to peak"_).

### The decks and mixer

- **Decks:** jog wheels (scratch in vinyl mode, nudge otherwise), sync with beat-phase lock, master
  deck, key lock (time-stretching), key shift and key match, 8 hot cues, auto and manual loops,
  loop rolls, beat jumps, slip, reverse, brake, spinback and quantize.
- **Mixer:** trim, a 3-band isolator EQ with full kills, a low-pass/high-pass filter sweep, channel
  faders with meters, a crossfader with three curves (smooth, linear, cut), master limiter and a
  headphone cue (split cue).
- **FX** per deck, synced to the beat: echo, reverb, flanger, phaser, crush, gate and wobble.
- **Sampler:** 8 one-shots (air horn, siren, laser, riser, boom, crash, scratch, rewind) on the
  pads.
- **Waveforms:** scrolling 3-band waveforms on the beat grid, plus an overview with song sections.
- **Recording:** record your mix and download the audio with a tracklist.

### Everywhere

- **Layouts:** separate layouts for desktop, tablet and phone. The app installs as a PWA and keeps
  working offline (the built-in AI runs locally).
- **Controllers and keyboard:** MIDI controllers via MIDI learn, plus keyboard shortcuts.
- **Library:** drag and drop files or whole folders in any format your browser can decode (MP3,
  AAC/M4A, WAV, FLAC, OGG/Opus…). Tags and artwork are read from the files. Everything is stored in
  your browser (IndexedDB).
- **Demo crate:** 8 original demo tracks, from deep house to drum & bass, are generated in your
  browser, so you can mix straight away.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click **Let's mix**. Two matching demo tracks load onto the decks.
Press ▶ on deck A, then hit **AI Mix** on a suggestion.

Requires Node 22+.

### Turning on Claude (optional)

The built-in AI (suggestions, AI Mix, Auto DJ) needs no key. The Claude copilot (chat, real-song
discovery and set planning) can be turned on in either of two ways:

- **Server key:** `cp .env.example .env` and set `ANTHROPIC_API_KEY`. The key stays on the server,
  and the browser talks to `/api`.
- **Your own key:** open **Ask Claude** (or Settings → AI) and paste a key. It's stored only in that
  browser and sent directly to Anthropic.

The default model is **Claude Opus 5.5**. You can switch to Sonnet 5.5 or Haiku 4.5 in Settings, or
with `MIXMIND_AI_MODEL` on the server. Requests opt into Anthropic's server-side refusal fallbacks
(`fallbacks: "default"`) on the models that support them.

**Privacy:** audio never leaves your device. Claude only receives track metadata (title, artist,
genre, BPM, key, energy, length, mood, intro and outro length) and what the decks are doing.

## Deploying

```bash
npm run build   # web app → dist/, API server → dist-server/
npm start       # serves both on http://localhost:8787
```

| Variable             | Default           | Purpose                                            |
| -------------------- | ----------------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | –                 | Enables the Claude copilot through the server      |
| `MIXMIND_AI_MODEL`   | `claude-opus-5-5` | Default Claude model                               |
| `MIXMIND_RATE_LIMIT` | `40`              | AI requests per IP per 5 minutes                   |
| `PORT` / `HOST`      | `8787` / 0.0.0.0  | Where the server listens                           |
| `BASE_PATH`          | `/`               | Build-time base path when hosting under a sub-path |

**Docker:**

```bash
docker build -t mixmind .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... mixmind
```

**Static hosting** (GitHub Pages, Netlify, any CDN): the `vite build` output works on its own, and
Claude then runs in bring-your-own-key mode. This repo includes a GitHub Pages workflow. To use it,
go to Settings → Pages, set the source to **GitHub Actions**, then run **Deploy to GitHub Pages**
from the Actions tab.

Phones need HTTPS to install the app and use MIDI (localhost is fine for development).

## How it works

```
src/
  audio/       Web Audio engine. One AudioWorklet renders both decks sample by sample
               (WSOLA time-stretch for key lock, scratching, loops, sync PLL, sample-accurate
               armed starts). Mixer strips (LR4 isolator EQ, filter), FX, sampler, recorder.
  analysis/    Web Worker: FFT and onsets → tempo and beat grid, downbeats, key, loudness,
               structure, timbre.
  library/     Import, tags and artwork, IndexedDB, decoding, the demo-track synthesizer.
  ai/          Recommender, transition planner, auto-mixer, Auto DJ, Claude client and prompts.
  controller/  Deck and mixer actions, the engine ↔ UI bridge, keyboard, MIDI, recording.
  components/  React UI: decks, mixer, waveforms, library, AI panel.
  state/       Zustand stores.
server/        Hono API: /api/health, /api/ai/picks, /api/ai/chat (streaming), /api/ai/setplan.
```

- **Recommendations** blend four scores, weighted by the chosen style. "Balanced" is 32% harmonic,
  30% tempo, 20% energy and 18% timbre. Other styles favour key, energy flow or sound.
- **Transition plans** are bar-aligned automation lanes (faders, EQs, filters, FX sends) plus
  actions (loops, FX, spinbacks), laid out on the outgoing track's phrase grid. The auto-mixer
  schedules them as Web Audio automation and starts the incoming deck inside the audio thread, so
  mixes stay tight even when the tab is in the background.

## Keyboard shortcuts

| Keys              | Action                           |
| ----------------- | -------------------------------- |
| `Q` / `U`         | Cue deck A / B (hold to preview) |
| `W` / `I`         | Play / pause deck A / B          |
| `E` / `O`         | Sync deck A / B                  |
| `1–4` / `7–0`     | Hot cues 1–4 (Shift deletes)     |
| `A` `S` / `J` `K` | Nudge slower / faster (hold)     |
| `D` / `L`         | Auto loop on / off               |
| `F` / `;`         | Key lock                         |
| `←` `→` `↓`       | Crossfader left / right / centre |
| `M`               | AI Mix the top suggestion        |
| `Shift` + `M`     | Cancel the AI transition         |
| `N`               | Auto DJ on / off                 |
| `Shift` + `R`     | Start / stop recording           |
| `/`               | Search the library               |
| `?`               | Help                             |

## Development

| Command             | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run dev`       | Dev server with the API mounted (reads `.env`)                             |
| `npm test`          | Unit tests: DSP, analysis accuracy, harmonic rules, planner, Claude client |
| `npm run test:e2e`  | Playwright on desktop and phone, against the production build              |
| `npm run lint`      | ESLint                                                                     |
| `npm run typecheck` | TypeScript (strict)                                                        |
| `npm run format`    | Prettier                                                                   |

CI runs all of these on every push.

## Browser support

Recent Chrome, Edge, Safari (16.4+) and Firefox. On iPhone, MixMind asks iOS for a playback audio
session so the ring/silent switch doesn't mute it.

## License

[MIT](LICENSE)
