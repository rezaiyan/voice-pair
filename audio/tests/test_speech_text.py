from speech_text import clean, sentences, summary


def test_clean_should_drop_fenced_code_blocks():
    text = "Fixed it.\n```ts\nconst x = 1\n```\nTests pass."
    assert clean(text) == "Fixed it. Tests pass."


def test_clean_should_keep_short_inline_code_and_drop_long_snippets():
    text = "Run `npm test` then check `const result = await fetchEverything(withRetries, andBackoff)` output."
    out = clean(text)
    assert "npm test" in out
    assert "fetchEverything" not in out


def test_clean_should_strip_markdown_decoration():
    text = "## Summary\n- **Bold** item\n- [link text](https://x.y/z)\n1. _step_ one"
    assert clean(text) == "Summary. Bold item. link text. step one."


def test_clean_should_shorten_long_paths_to_basename():
    assert clean("Edited src/auth/middleware/token.ts today.") == "Edited token.ts today."


def test_clean_should_drop_tables_and_replace_urls():
    text = "Results:\n| a | b |\n|---|---|\n| 1 | 2 |\nSee https://example.com/x for more."
    assert clean(text) == "Results: See a link for more."


def test_sentences_should_split_on_terminal_punctuation():
    assert sentences("One. Two? Three!") == ["One.", "Two?", "Three!"]


def test_summary_should_keep_leading_sentences_within_budget():
    text = "First point here. " + "Second point is longer. " * 20
    out = summary(text, max_chars=60)
    assert out.startswith("First point here.")
    assert len(out) <= 60


def test_summary_should_return_empty_when_only_code():
    assert summary("```\nonly code\n```") == ""


def test_summary_should_cut_one_giant_sentence_at_word_boundary():
    out = summary("word " * 400, max_chars=50)
    assert 0 < len(out) <= 101
    assert out.endswith(".")


def test_summary_keeps_more_sentences_with_a_bigger_limit():
    text = " ".join(f"Step {i} changed the parser in a small way." for i in range(1, 21))
    short = summary(text)
    long = summary(text, max_chars=1200)
    assert len(short) <= 280
    assert len(long) > 3 * len(short)
