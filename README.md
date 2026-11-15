# voice-pair

Talk to Claude Code instead of typing. You speak, your words go into the open Claude Code session
as a normal message, and Claude answers you out loud. Code and details still show up in the
terminal as usual. The voice part is short, like a colleague sitting next to you.

Speech recognition and the voice both run on your Mac. Your audio never leaves your computer.

<p align="center">
  <img src="media/demo.gif" width="720" alt="A Claude Code session by voice: the user asks why the Word Rush card stays locked after login, Claude explains out loud, changes the code, runs the tests, and the card unlocks on the phone" />
</p>

<p align="center"><sub>A real bug in the Lexicon app, fixed by voice. Claude speaks with voice-pair's default voice.</sub></p>

## What you need

- A Mac with Apple Silicon (M1 or newer)
- Claude Code 2.1.285 or newer, used in the terminal (not the desktop app), and logged in with a
  claude.ai account
- [Homebrew](https://brew.sh), [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh) and jq
- About 2.7 GB of free disk space for the speech models

If you are missing some of the tools:

```bash
brew install uv jq
curl -fsSL https://bun.sh/install | bash
```

## Install

You can install voice-pair as a Claude Code plugin, or from a git clone. Both work the same way
after setup.

### As a plugin

In Claude Code, run:

```
/plugin marketplace add rezaiyan/claude-plugins
/plugin install voice-pair@rezaiyan
/voice-pair:setup
```

`/voice-pair:setup` prepares everything and adds a `voice-pair` command to your PATH. When the
plugin gets an update, the next `voice-pair` start sets up the new version by itself.

With the plugin installed, every Claude Code session starts a small voice-pair process. It does
nothing (no microphone, no tools) unless you started the session with `voice-pair`.

### From a git clone

```bash
git clone https://github.com/rezaiyan/voice-pair.git ~/voice-pair
ln -s ~/voice-pair/bin/voice-pair /opt/homebrew/bin/voice-pair
voice-pair setup
```

The second line puts the `voice-pair` command on your PATH. You can link it into any other folder
on your PATH instead.

### What setup does

Setup creates a Python environment, installs the Bun packages and downloads the speech models
(about 2.7 GB, so the first run takes a few minutes). It checks every model file against a fixed
SHA-256 hash. A warning from Hugging Face about `HF_TOKEN` during the download is normal. You only
need to run setup once.

Then test your microphone:

```bash
voice-pair check
```

macOS will ask if your terminal app may use the microphone. Say yes. The check records one sentence,
shows what it heard, and reads it back to you. You need to do this once for each terminal app you
use (Terminal, iTerm, Ghostty and so on).

## Use it with Claude Code

### Start Claude with voice

Run `voice-pair` where you would normally run `claude`. It starts Claude Code for you, with voice
turned on:

```bash
cd ~/code/my-app
voice-pair                      # instead of: claude
voice-pair --model opus         # any claude option works
voice-pair --continue           # for example, continue your last conversation
```

Claude Code first shows a warning about development channels. This is normal for voice-pair.
Choose "I am using this for local development" and press Enter. After about three seconds the
speech models are ready. Now you have a normal Claude Code session that also listens to you.

A plain `claude` session has no voice, even with voice-pair installed. Only sessions you start
with `voice-pair` can hear you.

### Talk to Claude

Just speak, the way you would talk to a colleague. When you stop for about 1.3 seconds, a soft tick
plays and your words are sent. In the terminal they show up as a message from voice-pair:

```
← voice-pair: Why does the login test fail?
```

Claude treats it exactly like a message you typed. It can read files, run commands and edit code
as usual, and Claude Code still asks for your permission in the same way.

Some things you could say:

- "What does this project do?"
- "Run the tests and tell me what fails."
- "Open the auth middleware and explain the token check."
- "Rename this variable to user ID in the whole file."
- "Explain more." (switches to detailed voice mode, see below)
- "Stop listening." (turns the microphone off)

### What Claude says back

Claude talks in short sentences, and the details stay on the screen:

- For a quick question, it just says the answer.
- For a longer task, it says what it is going to do, gives a short update when something
  important happens, and sums up at the end.
- Code, diffs, file paths and long lists are not read out. You see them in the terminal as usual.
- When Claude needs your permission, it tells you, and you answer with the keyboard.

The microphone is off while Claude is speaking, so it doesn't hear itself. Wait until it stops,
then talk. To make it stop early, run `voice-pair stop` in another terminal.

### More detail by voice

By default Claude keeps its speech short and leaves the details on the screen. If you want to work
without looking at the screen, switch to detailed mode. Just say "explain more", "talk more" or
"I'm not looking at the screen". To go back, say "keep it short".

In detailed mode Claude:

- explains what it found and why, step by step
- describes code in words ("it takes the user ID, looks up the session, and fails if the token
  expired") instead of reading symbols
- tells you what it changed as a short list
- says the options out loud when it needs a decision, and which one it recommends
- reads a longer summary at the end if it finished without speaking

It still doesn't read code, long paths or command output word for word. Those don't work well as
speech, so Claude tells you what they mean instead.

To start a session in detailed mode, use `VOICE_PAIR_DETAIL=full voice-pair`. `voice-pair status`
shows the current mode.

Long answers are harder to stop. If you use headphones, `VOICE_PAIR_BARGE_IN=1` lets you interrupt
Claude by talking. Without headphones, use `voice-pair stop`.

### Typing and talking

You can mix both in one session. When you type a message, Claude answers on the screen only, as
in a normal session. When you speak again, it starts talking again.

### Stop the session

End it like any Claude Code session: type `/exit`, or press Ctrl+C twice.

### Control commands

To control a running session, open a second terminal:

```bash
voice-pair stop      # stop speaking right now
voice-pair mute      # turn the microphone off (you can also say "stop listening")
voice-pair unmute    # turn it back on
voice-pair status    # show the current state
```

Only one voice session can run at a time.

## Settings

Set these as environment variables before `voice-pair`, for example
`VOICE_PAIR_SPEED=0.9 voice-pair`.

| Variable | Default | What it does |
|---|---|---|
| `VOICE_PAIR_DETAIL` | `brief` | Set to `full` to start in detailed voice mode. You can also switch by voice. |
| `VOICE_PAIR_SPEED` | `1.0` | How fast Claude talks. Lower is slower. |
| `VOICE_PAIR_END_SILENCE_MS` | `1300` | How long a pause (in ms) sends your message. Raise it if you get cut off. |
| `VOICE_PAIR_VAD_LEVEL` | `2` | How strict the speech detection is, from 0 to 3. Raise it in a noisy room. |
| `VOICE_PAIR_TTS` | `kokoro` | Set to `say` to use the built-in macOS voice. |
| `VOICE_PAIR_VOICE` | `af_heart` | Which Kokoro voice to use. |
| `VOICE_PAIR_SAY_VOICE` | system voice | Which macOS voice to use with `say` (see `say -v '?'`). |
| `VOICE_PAIR_START_MUTED` | off | Set to `1` to start with the microphone off. |
| `VOICE_PAIR_BARGE_IN` | off | Set to `1` to interrupt Claude by talking. Use headphones, or it hears itself. |
| `VOICE_PAIR_CUES` | `1` | Set to `0` to turn off the small sound when your message is sent. |
| `VOICE_PAIR_LOG_TRANSCRIPTS` | off | Set to `1` to save what you said in the log, for debugging. |
| `VOICE_PAIR_ALLOW_BYPASS` | off | Set to `1` to skip the question when permission checks are off. |
| `VOICE_PAIR_PORT` | `7788` | First local port to try for the control commands. |
| `VOICE_PAIR_CACHE` | `~/.cache/voice-pair` | Where models, the log and session files are kept. |
| `VOICE_PAIR_STT_MODEL` | `mlx-community/parakeet-tdt-0.6b-v3` | A different Parakeet model. It is not hash-checked. |
| `VOICE_PAIR_STT_REVISION` | a fixed commit | Which version of the speech model to download. |
| `VOICE_PAIR_SIDECAR` | none | For development only: run a different audio process (the tests use a fake one). |

## Security and privacy

Please read this before you use voice-pair.

**The microphone is an open door.** Everything it hears becomes a message to Claude. That
includes a video playing in the background, a phone call, or another person in the room. Keep
Claude Code's permission prompts turned on, so Claude has to ask before it runs commands or edits
files. If you start voice-pair with `--dangerously-skip-permissions` or with `bypassPermissions`
in your settings, it warns you and asks you to type `yes` first. Permission prompts are read out
loud, but you can only approve them with the keyboard, never by voice.

**Where your words go.** Your audio stays on your Mac. After setup, voice-pair does not connect
to the internet. But the text of what you say is sent to Claude as your message, exactly like
typed text, and it is saved in the Claude Code session history. Claude's answers are spoken out
loud, so people near you can hear them.

**The log does not keep your words.** voice-pair writes a small log to
`~/.cache/voice-pair/voice-pair.log`. It contains timings and errors, but not what you said: each
message is shown only as its length, like `[42 chars]`. Only your user account can read the file,
and it is rotated at 1 MB.

**The control commands are protected.** `voice-pair stop`, `mute` and the other commands talk to
the session through a port on `127.0.0.1`. Each session creates a random password for this port
and saves it in a file that only you can read. Requests without it are refused, and so is any
request that comes from a web page. The port cannot send messages to Claude. Only the
microphone can do that.

**The models are checked.** `setup` downloads the voice model from a fixed kokoro-onnx release and
the speech recognition model from a fixed Hugging Face commit. It checks each file against a
SHA-256 hash in [`audio/models.py`](audio/models.py). If a file does not match, it is deleted and
setup stops.

If you find a security problem, please report it privately with GitHub's "Report a vulnerability"
button in the Security tab, not in a public issue.

## Limits

- It works only in the Claude Code terminal app. The desktop app cannot use channels yet.
- You cannot interrupt Claude by voice while it is working. What you say is sent when it finishes.
  `voice-pair stop` stops the speaking at once.
- Speech recognition sometimes gets technical words wrong ("jason" instead of JSON). Claude
  usually understands what you meant from the code.

## How it works

| Part | File | What it does |
|---|---|---|
| Launcher | `bin/voice-pair` | Makes sure the voice server is available (the plugin ships it; a git clone registers it for your project), adds the hooks and tool permissions for this one session, and starts `claude`. |
| Channel server | `server/index.ts` | An MCP server that sends what you said into the session and gives Claude the `speak`, `set_voice_detail` and `set_listening` tools. |
| Turn logic | `server/state.ts` | Decides when to speak. If you asked by voice and Claude finished without speaking, it reads a short summary of the answer. |
| Audio process | `audio/sidecar.py` | Listens to the microphone, finds where you start and stop talking (webrtcvad), turns speech into text (Parakeet), and plays Claude's voice (Kokoro). The microphone is ignored while Claude is speaking. |
| Hook helper | `hooks/forward.ts` | Passes Claude Code hook events to the server. |

The voice server only comes alive in a session started with `voice-pair`. In a plain `claude`
session it does nothing: no microphone, no tools.

To remove voice-pair:

- Plugin: run `/plugin uninstall voice-pair@rezaiyan` in Claude Code, and delete the
  `voice-pair` command that setup added (it tells you where).
- Git clone: with a git clone, the launcher registers the server for each project where you use
  it. Remove it there with `claude mcp remove voice-pair -s local`.

The models stay on disk: delete `~/.cache/voice-pair` and
`~/.cache/huggingface/hub/models--mlx-community--parakeet-tdt-0.6b-v3` to get the space back.

On an M2 Max, turning 5 seconds of speech into text takes about 150 ms. Claude's voice starts
about 0.9 seconds after it calls `speak`.

## Tests

```bash
cd audio && uv run pytest -q
cd server && bun test tests
```

The Python tests include a real run through speech detection and Parakeet, using speech made by
macOS `say`. The Bun tests start the real server with a fake audio process.

## License

MIT, see [LICENSE](LICENSE). This repository contains only voice-pair's own code. `setup`
installs the other packages and downloads the models, and each of them has its own license.

Most of them use permissive licenses (MIT, BSD, Apache-2.0, ISC). `certifi` and `tqdm` are MPL-2.0
and `soxr` is LGPL-2.1. Two parts of the Kokoro voice are GPL-3.0 or later:
[phonemizer](https://github.com/bootphon/phonemizer) and the
[espeak-ng](https://github.com/espeak-ng/espeak-ng) library inside `espeakng-loader`. This does
not matter for using or forking voice-pair. But if you share a package that includes them, such
as a bundled app, the GPL applies to that package. With `VOICE_PAIR_TTS=say` they are not used.

## Credits

- Speech recognition: [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
  by NVIDIA (CC-BY-4.0), run with [parakeet-mlx](https://github.com/senstella/parakeet-mlx) and the
  [mlx-community version](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3) of the model.
- Voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0), run with
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
- Speech detection: [webrtcvad](https://github.com/wiseman/py-webrtcvad) (MIT), from the
  [webrtcvad-wheels](https://github.com/daanzu/py-webrtcvad-wheels) build.
- Claude Code connection: [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
  (MIT).

The models are not part of this repository. `voice-pair setup` downloads them.
