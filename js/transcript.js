// Meeting transcripts from .txt, .md, .vtt and .srt files: plain text with the
// cue numbers, timestamps and headers stripped. Pure, no DOM.

export const TRANSCRIPT_TYPES = ['txt', 'md', 'vtt', 'srt'];

/** Bigger than any real meeting transcript; keeps the AI requests sane. */
export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

const TIMESTAMP_LINE = /-->/;
// "[00:01:02]", "(01:02)", "00:01:02.500 " or "1:02 -" at the start of a line.
const LEADING_TIME = /^[[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?[\])]?\s*[-–:]?\s*/;
// A "Name: words" line. Names are short and start with a capital letter.
const SPEAKER_LINE = /^([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3}):\s+\S/;

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function byteLength(text) {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
}

/** WebVTT "<v Anna>Hello</v>" becomes "Anna: Hello"; other tags go. */
function cleanCaption(line) {
  const voice = /^<v(?:\.[\w.-]+)?\s+([^>]+)>(.*)$/.exec(line);
  const text = voice ? `${voice[1].trim()}: ${voice[2]}` : line;
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/** Caption files: drop the header, NOTE/STYLE blocks, cue numbers and timings. */
function captionLines(lines) {
  const out = [];
  let skipBlock = false;
  lines.forEach((line, i) => {
    if (!line) {
      skipBlock = false;
      return;
    }
    if (skipBlock) return;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true;
      return;
    }
    if (TIMESTAMP_LINE.test(line)) return;
    // A cue id ("1", "intro-2") is the line right before the timing.
    if (TIMESTAMP_LINE.test(lines[i + 1] || '')) return;
    out.push(cleanCaption(line));
  });
  return out;
}

/** Consecutive repeats (rolling auto-captions) collapse into one line. */
function dropRepeats(lines) {
  return lines.filter((line, i) => line && line !== lines[i - 1]);
}

function speakersOf(lines) {
  const names = [];
  for (const line of lines) {
    const match = SPEAKER_LINE.exec(line);
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Read a transcript file's text.
 * @returns {{text: string, speakers: string[], words: number}}
 * @throws on an unsupported type, an empty file or one over 2 MB.
 */
export function parseTranscript(name, text) {
  const type = extensionOf(name);
  if (!TRANSCRIPT_TYPES.includes(type)) {
    throw new Error(`"${name}" is not a transcript. Use a .txt, .md, .vtt or .srt file.`);
  }
  const raw = String(text || '').replace(/^﻿/, '');
  if (byteLength(raw) > MAX_TRANSCRIPT_BYTES) throw new Error(`"${name}" is over 2 MB.`);

  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim());
  const body = type === 'vtt' || type === 'srt' ? captionLines(lines) : lines;
  const kept = dropRepeats(body.map(line => line.replace(LEADING_TIME, '').trim()));
  if (!kept.length) throw new Error(`"${name}" is empty.`);

  const joined = kept.join('\n');
  return { text: joined, speakers: speakersOf(kept), words: joined.split(/\s+/).filter(Boolean).length };
}
