"""Turn chat-formatted text (markdown, code, paths) into something worth saying out loud."""

from __future__ import annotations

import re

_FENCE = re.compile(r"```.*?(```|$)", re.S)
_INLINE_CODE = re.compile(r"`([^`\n]{1,40})`|`[^`\n]*`")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_URL = re.compile(r"https?://\S+")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$", re.M)
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.M)
_EMPHASIS = re.compile(r"(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1")
_HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
_LONG_PATH = re.compile(r"(?:[\w.-]+/){2,}([\w.-]+)")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_SPACES = re.compile(r"[ \t]+")


def _inline_code(m: re.Match[str]) -> str:
    # Short identifiers (`foo.ts`, `npm test`) are worth saying; long snippets are not.
    return m.group(1) if m.group(1) else ""


def clean(text: str) -> str:
    """Strip markdown and code so TTS reads prose only."""
    t = _FENCE.sub(" ", text)
    t = _TABLE_ROW.sub(" ", t)
    t = _LINK.sub(r"\1", t)
    t = _URL.sub("a link", t)
    t = _INLINE_CODE.sub(_inline_code, t)
    t = _HTML_TAG.sub(" ", t)
    t = _HEADING.sub("", t)
    t = _BULLET.sub("", t)
    t = _EMPHASIS.sub(r"\2", t)
    t = _LONG_PATH.sub(r"\1", t)  # src/auth/middleware.ts -> middleware.ts
    lines = [ln.strip() for ln in t.splitlines()]
    # Each non-empty line becomes its own sentence-ish chunk.
    parts = []
    for ln in lines:
        if not ln:
            continue
        parts.append(ln if ln[-1] in ".!?:;," else ln + ".")
    t = " ".join(parts)
    return _SPACES.sub(" ", t).strip()


def sentences(text: str) -> list[str]:
    """Split cleaned text into sentences for incremental synthesis."""
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


def summary(text: str, max_chars: int = 280) -> str:
    """Leading sentences of the cleaned text, up to max_chars (always at least one sentence)."""
    out: list[str] = []
    length = 0
    for s in sentences(clean(text)):
        if out and length + len(s) + 1 > max_chars:
            break
        out.append(s)
        length += len(s) + 1
    if not out:
        return ""
    joined = " ".join(out)
    if len(joined) > max_chars * 2:  # one giant sentence: cut at a word boundary
        joined = joined[: max_chars * 2].rsplit(" ", 1)[0] + "."
    return joined
