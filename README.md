# voice-pair

Pair-program with Claude Code out loud. You talk, and what you say becomes a message in the open
session. Claude talks back, and code, diffs and detail stay in the chat. Speech recognition and
the voice run on your Mac (Apple Silicon); no audio leaves the machine.

```
mic ─▶ webrtcvad ─▶ Parakeet TDT (MLX) ─▶ channel event ─▶ open claude session
                                                              │
speakers ◀─ Kokoro TTS ◀─ speak tool (Claude narrates) ◀──────┤
          ◀─ Stop hook fallback (voice turn ended silently) ◀─┘
```

## Requirements

- An Apple Silicon Mac (speech recognition runs on MLX)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) ≥ 2.1.285, the terminal CLI, signed in
  with a claude.ai account (a requirement of Channels)
- [`uv`](https://docs.astral.sh/uv/), [`bun`](https://bun.sh) and `jq` (`brew install uv jq`, plus
  bun's installer)
- About 2.7 GB of disk for the speech models

## Use

```bash
git clone https://github.com/rezaiyan/voice-pair && ln -s "$PWD/voice-pair/bin/voice-pair" ~/bin/
voice-pair setup      # once: Python env, Bun deps, ~2.7 GB of local models (sha256-checked)
voice-pair check      # once per terminal app: mic permission + "I heard: …" round trip
cd ~/code/my-app && voice-pair        # any claude flags pass through, e.g. --model opus
```

Accept the development-channel warning (shown once per launch while Channels are in research
preview), then just talk. A pause of about 1.3 s sends what you said. Typing works as usual; once
you type, Claude stops reading its replies aloud until you speak again. One voice session runs at a
time.

Control a running session from another shell:

```bash
voice-pair stop       # stop talking now
voice-pair mute       # mic off (or say "stop listening")
voice-pair unmute
voice-pair status
```

## How it works

| Piece | File | Role |
|---|---|---|
| Launcher | `bin/voice-pair` | Registers the MCP server for the project (local scope, once), adds the hooks and tool permissions for this session only, and starts `claude` with the dev-channel flag |
| Channel server | `server/index.ts` | MCP server with the `claude/channel` capability. It pushes transcripts into the session, exposes `speak` / `set_listening` (loaded upfront), and runs the localhost control port for hooks |
| Turn logic | `server/state.ts` | Voice mode while your last input was speech. A voice turn that ended without `speak` gets a spoken summary; permission prompts are announced |
| Audio sidecar | `audio/sidecar.py` | Mic → VAD segmentation → Parakeet STT, and the TTS queue. The mic is ignored while Claude is speaking (no echo loop) |
| Hook shim | `hooks/forward.ts` | Forwards Stop / UserPromptSubmit / Notification hook payloads to the server; always exits 0 |

When `claude` is started without the launcher in a project where voice-pair is registered, the
server stays inert: no channel, no tools, no mic.

Measured on an M2 Max: speech-to-text takes about 150 ms for 5 s of speech, and the first spoken
audio comes about 0.9 s after Claude calls `speak`.

## Settings (env vars)

| Var | Default | |
|---|---|---|
| `VOICE_PAIR_TTS` | `kokoro` | `say` for the macOS built-in voice |
| `VOICE_PAIR_VOICE` | `af_heart` | Kokoro voice id |
| `VOICE_PAIR_SPEED` | `1.0` | speech rate (lower is slower) |
| `VOICE_PAIR_END_SILENCE_MS` | `1300` | pause length (ms) that sends what you said |
| `VOICE_PAIR_VAD_LEVEL` | `2` | 0–3; raise it in noisy rooms |
| `VOICE_PAIR_BARGE_IN` | off | `1` with headphones: start talking to interrupt Claude |
| `VOICE_PAIR_CUES` | `1` | soft tick when an utterance is sent |
| `VOICE_PAIR_START_MUTED` | off | start with the mic muted |
| `VOICE_PAIR_LOG_TRANSCRIPTS` | off | `1` writes what you said into the log (debugging) |
| `VOICE_PAIR_ALLOW_BYPASS` | off | `1` skips the confirmation when permissions are bypassed |
| `VOICE_PAIR_SAY_VOICE` | system | voice name for `say` (see `say -v '?'`) |
| `VOICE_PAIR_STT_MODEL` | `mlx-community/parakeet-tdt-0.6b-v3` | another Parakeet MLX model (not hash-checked) |
| `VOICE_PAIR_STT_REVISION` | pinned commit | Hugging Face revision of the STT model |
| `VOICE_PAIR_PORT` | `7788` | first local control port to try |
| `VOICE_PAIR_CACHE` | `~/.cache/voice-pair` | models, log, session files |
| `VOICE_PAIR_SIDECAR` | — | development: replace the audio process command (the tests use a fake) |

## Security and privacy

- **Anything the microphone hears is a prompt to Claude.** That includes a video, a call, or
  someone else in the room. Keep Claude Code's permission prompts on. If you start voice-pair with
  `--dangerously-skip-permissions` or `bypassPermissions` (flag or settings), it warns you and asks
  you to type `yes` first. Spoken permission prompts are announced but never approved by voice;
  you approve them on the keyboard.
- **Where your words go.** Audio never leaves your Mac: speech recognition and the voice run
  locally, and after setup voice-pair itself makes no network requests. The *text* of what you say
  is sent to Claude as your prompt, exactly as if you had typed it, and appears in the session
  transcript. Claude's spoken replies play out loud, so anyone in the room hears them.
- **Models are pinned and verified.** `setup` downloads Kokoro from a fixed kokoro-onnx release and
  Parakeet at a fixed Hugging Face commit, and checks every file against a SHA-256 in
  [`audio/models.py`](audio/models.py). A file that doesn't match is deleted and setup fails.
- **The local control port needs a per-session secret.** The server listens on `127.0.0.1` only. The
  launcher creates a random token for each session and gives it only to the hooks and to
  `voice-pair status|mute|unmute|stop` (in `~/.cache/voice-pair/token`, mode 600). Requests without
  the token, and any request a web page sends (any request carrying an `Origin` header), are
  refused. The port has no way to type into the session: only the microphone does that.
- **What you say isn't logged.** `~/.cache/voice-pair/voice-pair.log` (mode 600, rotated at 1 MB)
  records timings and errors, with transcripts replaced by their length. Set
  `VOICE_PAIR_LOG_TRANSCRIPTS=1` to keep the text while debugging. The port and token files are
  removed when the session ends.

Report a vulnerability privately through GitHub's "Report a vulnerability" (Security tab), not in a
public issue.

## Limits

- **Terminal CLI only.** The desktop app can't attach channels.
- **The terminal app needs microphone permission.** Run `voice-pair check` in that terminal first.
- **You can't interrupt by voice mid-turn.** What you say while Claude works is delivered at the
  start of the next turn (`voice-pair stop` silences playback right away).

## Tests

```bash
cd audio && uv run pytest -q     # segmenter, text cleanup, real say→VAD→Parakeet pipeline
cd server && bun test tests      # turn logic, MCP channel contract, auth, hook shim, restarts, inert mode
```

To remove voice-pair from a project: `claude mcp remove voice-pair -s local`.

## License

MIT, see [LICENSE](LICENSE). This repository contains only voice-pair's own code. `voice-pair setup`
installs the dependencies and downloads the models below, each under its own license.

Most dependencies are permissive (MIT, BSD, Apache-2.0, ISC; `certifi` and `tqdm` are MPL-2.0,
`soxr` is LGPL-2.1). Two parts of the Kokoro voice are **GPL-3.0-or-later**:
[phonemizer](https://github.com/bootphon/phonemizer) and the [espeak-ng](https://github.com/espeak-ng/espeak-ng)
library bundled in `espeakng-loader`. That doesn't affect using or forking voice-pair, but if you
redistribute a bundle that includes them (for example a packaged app), the GPL applies to that
bundle. With `VOICE_PAIR_TTS=say` they are not used.

## Credits

- Speech recognition: [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) by
  NVIDIA (CC-BY-4.0), run with [parakeet-mlx](https://github.com/senstella/parakeet-mlx) using the
  [mlx-community conversion](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3).
- Speech synthesis: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) via
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
- Voice activity detection: [webrtcvad](https://github.com/wiseman/py-webrtcvad) (MIT), via
  [webrtcvad-wheels](https://github.com/daanzu/py-webrtcvad-wheels).
- Claude Code integration: [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (MIT).

The models are downloaded by `voice-pair setup` and are not part of this repository.
