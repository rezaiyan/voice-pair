---
description: Set up voice-pair (Python environment, speech models) and add the voice-pair command to your PATH
allowed-tools: Bash
---

Set up the voice-pair plugin for the user. Run these two commands one after the other with the Bash
tool and stop if one fails:

1. `"${CLAUDE_PLUGIN_ROOT}/bin/voice-pair" setup`
   The first run downloads about 2.7 GB of speech models and can take several minutes, so use a
   10-minute timeout (600000 ms). Later runs are quick.
2. `"${CLAUDE_PLUGIN_ROOT}/bin/voice-pair" link`
   This adds a small `voice-pair` command to a folder on the user's PATH.

Then tell the user, in a few short sentences:

- Setup is done (or what failed, with the error).
- Next, in their own terminal app (Terminal, iTerm, Ghostty, not the Claude desktop app), run
  `voice-pair check` once to allow the microphone and test it.
- Then start a voice session from a project folder with `voice-pair`.
- Voice sessions only work in the Claude Code terminal app, not in the desktop app.
