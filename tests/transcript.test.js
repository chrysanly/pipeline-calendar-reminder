import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import { parseTranscript, MAX_TRANSCRIPT_BYTES, TRANSCRIPT_TYPES } from '../js/transcript.js';

const throws = (fn, pattern) => {
  try {
    fn();
  } catch (err) {
    assert(pattern.test(err.message), `unexpected message: ${err.message}`);
    return;
  }
  throw new Error('expected an error');
};

test('parseTranscript keeps Speaker: lines from a .txt and counts words', () => {
  const result = parseTranscript('call.txt', 'Anna: Hello Omar.\nOmar: Hi Anna, thanks for joining.\n\nAnna: Let us start.');
  assertEqual(result.text, 'Anna: Hello Omar.\nOmar: Hi Anna, thanks for joining.\nAnna: Let us start.');
  assertDeepEqual(result.speakers, ['Anna', 'Omar']);
  assertEqual(result.words, 13);
});

test('parseTranscript strips the WEBVTT header, NOTE blocks, cue ids and timings', () => {
  const vtt = [
    'WEBVTT', 'Kind: captions', '',
    'NOTE recorded by Teams', 'second note line', '',
    '1', '00:00:01.000 --> 00:00:04.000', '<v Anna Lee>Welcome everyone</v>', '',
    'intro-2', '00:00:04.000 --> 00:00:06.500 align:start', '<v Omar>Thanks, <b>Anna</b> &amp; team</v>'
  ].join('\r\n');
  const result = parseTranscript('meeting.VTT', vtt);
  assertEqual(result.text, 'Anna Lee: Welcome everyone\nOmar: Thanks, Anna & team');
  assertDeepEqual(result.speakers, ['Anna Lee', 'Omar']);
});

test('parseTranscript strips .srt cue numbers and timings and merges repeated lines', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nAnna: We agreed on the price.\n\n2\n00:00:02,000 --> 00:00:03,000\nAnna: We agreed on the price.\n\n3\n00:00:03,000 --> 00:00:05,000\nOmar: Great, 20 units.\n';
  const result = parseTranscript('call.srt', srt);
  assertEqual(result.text, 'Anna: We agreed on the price.\nOmar: Great, 20 units.');
  assertEqual(result.words, 10);
});

test('parseTranscript removes leading timestamps in text exports', () => {
  const result = parseTranscript('notes.md', '[00:01:02] Anna: Budget first\n(03:04) Omar: Agreed\n00:05:06 - Anna: Next steps');
  assertEqual(result.text, 'Anna: Budget first\nOmar: Agreed\nAnna: Next steps');
});

test('parseTranscript drops a byte-order mark', () => {
  assertEqual(parseTranscript('a.txt', '﻿Hello').text, 'Hello');
});

test('parseTranscript rejects other file types, empty files and files over 2 MB', () => {
  assertDeepEqual(TRANSCRIPT_TYPES, ['txt', 'md', 'vtt', 'srt']);
  throws(() => parseTranscript('deck.pdf', 'text'), /not a transcript/);
  throws(() => parseTranscript('noext', 'text'), /not a transcript/);
  throws(() => parseTranscript('empty.txt', '  \n\n '), /is empty/);
  throws(() => parseTranscript('only-timings.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n'), /is empty/);
  throws(() => parseTranscript('big.txt', 'a'.repeat(MAX_TRANSCRIPT_BYTES + 1)), /over 2 MB/);
  assertEqual(parseTranscript('limit.txt', 'a'.repeat(MAX_TRANSCRIPT_BYTES)).words, 1);
});
