# voice-pair

Talk to Claude Code instead of typing. You speak, Claude answers out loud, and the code and
details still show up in the terminal like always.

Speech recognition and the voice both run on your Mac. Your audio never leaves your computer.

<p align="center">
  <img src="media/demo.gif" width="720" alt="A Claude Code session by voice: the user asks why the Word Rush card stays locked after login, Claude explains out loud, changes the code, runs the tests, and the card unlocks on the phone" />
</p>

<p align="center"><sub>A real bug in the Lexicon app, fixed by voice, with voice-pair's default voice.</sub></p>

## What you need

- A Mac with Apple Silicon (M1 or newer)
- Claude Code 2.1.285 or newer, in the terminal (not the desktop app), logged in with a claude.ai account
- [Homebrew](https://brew.sh), [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh) and jq
- About 2.7 GB of free disk space for the speech models

```bash
brew install uv jq
curl -fsSL https://bun.sh/install | bash
```

## Install

Install it as a Claude Code plugin or from a git clone. Both work the same after setup.

**As a plugin.** In Claude Code, run:

```
/plugin marketplace add rezaiyan/claude-plugins
/plugin install voice-pair@rezaiyan
/voice-pair:setup
```

Setup gets everything ready and adds a `voice-pair` command to your PATH. When the plugin
updates, the next `voice-pair` start sets up the new version by itself.

**From a git clone.**

```bash
git clone https://github.com/rezaiyan/voice-pair.git ~/voice-pair
ln -s ~/voice-pair/bin/voice-pair /opt/homebrew/bin/voice-pair   # or any folder on your PATH
voice-pair setup
```

Setup creates a Python environment, installs the Bun packages and downloads the speech models.
The download is about 2.7 GB, so the first run takes a few minutes. Every model file is checked
against a fixed SHA-256 hash. A Hugging Face warning about `HF_TOKEN` is normal. You only run
setup once.

Then test your microphone:

```bash
voice-pair check
```

When macOS asks if your terminal may use the microphone, say yes. The check records one sentence,
shows what it heard and reads it back. Do this once for each terminal app you use (Terminal,
iTerm, Ghostty and so on).

## Use it

### Start a session

Run `voice-pair` where you would normally run `claude`. Any `claude` option works:

```bash
cd ~/code/my-app
voice-pair
voice-pair --model opus
voice-pair --continue
```

Claude Code first shows a warning about development channels. Choose "I am using this for local
development" and press Enter. You'll see it on every start: voice-pair sends your words in
through a Claude Code channel, and Claude Code warns about every channel that isn't on
Anthropic's approved list. About three seconds later the speech models are ready and Claude is
listening.

Only sessions you start with `voice-pair` can hear you. A plain `claude` session has no voice,
even with voice-pair installed.

### Talk

Just speak, the way you'd talk to a colleague. When you pause for about 1.3 seconds, a soft tick
plays and your words are sent. They show up as a message from voice-pair:

```
← voice-pair: Why does the login test fail?
```

Claude treats it like a typed message. It reads files, runs commands and edits code as usual,
and still asks for your permission the same way.

You can mix typing and talking. When you type, Claude answers on screen only. When you speak
again, it talks again.

### What Claude says back

Claude talks in short sentences and leaves the details on screen:

- A quick question gets a quick answer.
- A longer task gets a short plan, an update when something important happens, and a summary at the end.
- Code, diffs, file paths and long lists stay on screen. They aren't read out.
- When Claude needs your permission, it tells you, and you answer with the keyboard.

The microphone is off while Claude speaks, so it doesn't hear itself. To make it stop early, run
`voice-pair stop` in another terminal. With headphones, `VOICE_PAIR_BARGE_IN=1` lets you
interrupt it by talking.

### Control it from another terminal

```bash
voice-pair stop      # stop talking right now
voice-pair mute      # turn the microphone off (or say "stop listening")
voice-pair unmute    # turn it back on
voice-pair status    # show the current state and voice mode
```

End the session like any Claude Code session: type `/exit` or press Ctrl+C twice. Only one voice
session can run at a time.

## Settings

Set these before the command, for example `VOICE_PAIR_SPEED=0.9 voice-pair`.

| Variable | Default | What it does |
|---|---|---|
| `VOICE_PAIR_DETAIL` | `brief` | `full` makes Claude explain more by voice. You can also say "explain more" or "keep it short". |
| `VOICE_PAIR_SPEED` | `1.0` | How fast Claude talks. Lower is slower. |
| `VOICE_PAIR_END_SILENCE_MS` | `1300` | How long a pause (ms) sends your message. Raise it if you get cut off. |
| `VOICE_PAIR_VAD_LEVEL` | `2` | How strict speech detection is, 0 to 3. Raise it in a noisy room. |
| `VOICE_PAIR_TTS` | `kokoro` | `say` uses the built-in macOS voice. |
| `VOICE_PAIR_VOICE` | `af_heart` | Which Kokoro voice to use. |
| `VOICE_PAIR_SAY_VOICE` | system voice | Which macOS voice `say` uses (see `say -v '?'`). |
| `VOICE_PAIR_START_MUTED` | off | `1` starts with the microphone off. |
| `VOICE_PAIR_BARGE_IN` | off | `1` lets you interrupt Claude by talking. Use headphones, or it hears itself. |
| `VOICE_PAIR_CUES` | `1` | `0` turns off the tick when your message is sent. |
| `VOICE_PAIR_BAND` | orb | `full` for the wide band with words and buttons, `0` for nothing above the prompt. |
| `VOICE_PAIR_LOG_TRANSCRIPTS` | off | `1` saves what you said in the log, for debugging. |
| `VOICE_PAIR_ALLOW_BYPASS` | off | `1` skips the question when permission checks are off. |
| `VOICE_PAIR_PORT` | `7788` | First local port to try for the control commands. |
| `VOICE_PAIR_CACHE` | `~/.cache/voice-pair` | Where models, the log and session files live. |
| `VOICE_PAIR_STT_MODEL` | `mlx-community/parakeet-tdt-0.6b-v3` | A different Parakeet model. It isn't hash-checked. |
| `VOICE_PAIR_STT_REVISION` | a fixed commit | Which version of the speech model to download. |
| `VOICE_PAIR_SIDECAR` | none | Development only: run a different audio process (the tests use a fake one). |

## Security and privacy

Please read this before you use voice-pair.

**The microphone is an open door.** Everything it hears becomes a message to Claude: a video in
the background, a phone call, someone else in the room. Keep Claude Code's permission prompts on,
so Claude has to ask before it runs commands or edits files. If you start voice-pair with
`--dangerously-skip-permissions` or `bypassPermissions` in your settings, it warns you and asks
you to type `yes` first. Permission prompts are read out loud, but you can only approve them with
the keyboard, never by voice.

**Where your words go.** Your audio stays on your Mac, and after setup voice-pair doesn't connect
to the internet. The text of what you say goes to Claude as your message, just like typed text,
and is saved in the Claude Code session history. Claude's answers are spoken out loud, so people
near you can hear them.

**The log doesn't keep your words.** `~/.cache/voice-pair/voice-pair.log` has timings and errors,
not what you said. Each message shows up only as its length, like `[42 chars]`. Only your user
account can read the file, and it rotates at 1 MB.

**The control commands are protected.** `voice-pair stop`, `mute` and the others talk to the
session through a port on `127.0.0.1`. Each session makes a random password for it and saves it
in a file only you can read. Requests without it are refused, and so is anything coming from a
web page. The port can't send messages to Claude. Only the microphone can.

**The models are checked.** Setup downloads the voice model from a fixed kokoro-onnx release and
the speech model from a fixed Hugging Face commit, and checks each file against a SHA-256 hash in
[`audio/models.py`](audio/models.py). If a file doesn't match, it's deleted and setup stops.

If you find a security problem, please report it privately with GitHub's "Report a
vulnerability" button in the Security tab, not in a public issue.

## Limits

- It only works in the Claude Code terminal app. The desktop app can't use channels yet.
- You can't interrupt Claude by voice while it's working. What you say is sent when it finishes.
  `voice-pair stop` stops the talking right away.
- Speech recognition sometimes gets technical words wrong ("jason" instead of JSON). Claude
  usually figures out what you meant from the code.

## How it works

| Part | File | What it does |
|---|---|---|
| Launcher | `bin/voice-pair` | Makes sure the voice server is there (the plugin ships it, a git clone registers it for your project), adds the hooks and tool permissions for this one session, and starts `claude`. |
| Channel server | `server/index.ts` | An MCP server that sends what you said into the session and gives Claude the `speak`, `set_voice_detail` and `set_listening` tools. |
| Turn logic | `server/state.ts` | Decides when to speak. If you asked by voice and Claude finished without speaking, it reads a short summary. |
| Audio process | `audio/sidecar.py` | Listens to the microphone, finds where you start and stop talking (webrtcvad), turns speech into text (Parakeet) and plays Claude's voice (Kokoro). It ignores the microphone while Claude talks. |
| Hook helper | `hooks/forward.ts` | Passes Claude Code hook events to the server. |
| Voice orb | `band/` | A Claude Code mod that reads the server's live state (what the voice is doing, and the equalizer bands of the microphone or Claude's voice) about 25 times a second and draws the orb above the prompt. |

With the plugin installed, every Claude Code session starts a small voice-pair server, but it
does nothing (no microphone, no tools) unless you started the session with `voice-pair`.

On an M2 Max, turning 5 seconds of speech into text takes about 150 ms, and Claude's voice starts
about 0.9 seconds after it calls `speak`.

## Uninstall

- Plugin: run `/plugin uninstall voice-pair@rezaiyan` in Claude Code, and delete the
  `voice-pair` command setup added (it tells you where).
- Git clone: the launcher registers the server in each project where you use it. Remove it there
  with `claude mcp remove voice-pair -s local`.

The models stay on disk. Delete `~/.cache/voice-pair` and
`~/.cache/huggingface/hub/models--mlx-community--parakeet-tdt-0.6b-v3` to get the space back.

## License

MIT, see [LICENSE](LICENSE). This repository only has voice-pair's own code. Setup installs the
other packages and downloads the models, and each has its own license.

Most use permissive licenses (MIT, BSD, Apache-2.0, ISC). `certifi` and `tqdm` are MPL-2.0 and
`soxr` is LGPL-2.1. Two parts of the Kokoro voice are GPL-3.0 or later:
[phonemizer](https://github.com/bootphon/phonemizer) and the
[espeak-ng](https://github.com/espeak-ng/espeak-ng) library inside `espeakng-loader`. That doesn't
matter for using or forking voice-pair. But if you share a package that includes them, like a
bundled app, the GPL applies to that package. With `VOICE_PAIR_TTS=say` they aren't used.

## Credits

- Speech recognition: [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
  by NVIDIA (CC-BY-4.0), run with [parakeet-mlx](https://github.com/senstella/parakeet-mlx) and the
  [mlx-community version](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3) of the model.
- Voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0), run with
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
- Speech detection: [webrtcvad](https://github.com/wiseman/py-webrtcvad) (MIT), from the
  [webrtcvad-wheels](https://github.com/daanzu/py-webrtcvad-wheels) build.
- Claude Code connection: [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (MIT).

The models aren't part of this repository. `voice-pair setup` downloads them.
