import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import {
  applyStyle,
  displayColor,
  isHeading,
  normalizeLine,
  parseLine,
  rawOffset,
  styleAt,
  stripFormatting,
  visibleLength,
  visibleOffset,
} from '../src/richtext.ts';

const BLUE = '#2860b8';
const RED = '#c1352b';
const span = (text, css) => `<span style="${css}">${text}</span>`;

test('coloring a whole heading keeps the # marks outside the span', () => {
  const line = applyStyle('## Goals for Q4', 0, 12, { color: BLUE });
  assert.equal(line, `## ${span('Goals for Q4', `color: ${BLUE}`)}`);
  // Still a heading in Markdown, with the color applied.
  assert.equal(marked.parse(line).trim(), `<h2><span style="color: ${BLUE}">Goals for Q4</span></h2>`);
});

test('list, task and quote markers stay outside the span', () => {
  assert.equal(applyStyle('- [ ] Call mom', 0, 8, { color: RED }), `- [ ] ${span('Call mom', `color: ${RED}`)}`);
  assert.equal(applyStyle('> 1. Quote', 0, 5, { color: RED }), `> 1. ${span('Quote', `color: ${RED}`)}`);
  assert.equal(parseLine('    - nested').prefix, '    - ');
});

test('coloring part of a line, then changing and removing it', () => {
  let line = applyStyle('Ship the redesign today', 9, 17, { color: BLUE });
  assert.equal(line, `Ship the ${span('redesign', `color: ${BLUE}`)} today`);
  line = applyStyle(line, 0, 4, { color: BLUE });
  assert.equal(line, `${span('Ship', `color: ${BLUE}`)} the ${span('redesign', `color: ${BLUE}`)} today`);
  // Overlapping ranges merge into one span.
  line = applyStyle(line, 0, 17, { color: RED });
  assert.equal(line, `${span('Ship the redesign', `color: ${RED}`)} today`);
  // Recoloring the middle splits the span.
  line = applyStyle(line, 5, 8, { color: BLUE });
  assert.equal(line, `${span('Ship ', `color: ${RED}`)}${span('the', `color: ${BLUE}`)}${span(' redesign', `color: ${RED}`)} today`);
  // Default color removes the spans entirely.
  assert.equal(applyStyle(line, 0, 23, { color: null }), 'Ship the redesign today');
});

test('removing bold from a heading combines with its color', () => {
  let line = applyStyle('# Title', 0, 5, { color: BLUE });
  line = applyStyle(line, 0, 5, { normalWeight: true });
  assert.equal(line, `# ${span('Title', `color: ${BLUE}; font-weight: normal`)}`);
  assert.deepEqual(styleAt(line, 0, 5), { color: BLUE, normalWeight: true });
  line = applyStyle(line, 0, 5, { color: null });
  assert.equal(line, `# ${span('Title', 'font-weight: normal')}`);
  assert.equal(applyStyle(line, 0, 5, { normalWeight: null }), '# Title');
  assert.ok(isHeading(line));
  assert.ok(!isHeading('#hashtag'));
});

test('custom colors are stored as given', () => {
  assert.equal(applyStyle('Note', 0, 4, { color: '#FF8800' }), span('Note', 'color: #ff8800'));
  assert.equal(displayColor('#ff8800'), '#ff8800');
  assert.equal(displayColor(BLUE), 'var(--tag-blue-fg)');
});

test('styleAt reports only what the whole range shares', () => {
  const line = `${span('Ship', `color: ${BLUE}`)} the ${span('plan', `color: ${BLUE}`)}`;
  assert.deepEqual(styleAt(line, 0, 4), { color: BLUE });
  assert.deepEqual(styleAt(line, 0, 13), {});
  assert.deepEqual(styleAt(line, 2, 2), { color: BLUE });
  // At the very end of the line, the last run's style applies.
  assert.deepEqual(styleAt(line, 13, 13), { color: BLUE });
});

test('offsets map between raw and visible text', () => {
  const line = `## ${span('Hi', `color: ${BLUE}`)} there`;
  const parsed = parseLine(line);
  assert.equal(visibleLength(parsed), 8);
  const inner = line.indexOf('Hi');
  assert.equal(visibleOffset(parsed, inner), 0);
  assert.equal(visibleOffset(parsed, inner + 1), 1);
  assert.equal(visibleOffset(parsed, 4), 0); // inside the opening tag
  assert.equal(visibleOffset(parsed, line.indexOf('</span>') + 3), 2); // inside the closing tag
  assert.equal(rawOffset(parsed, 1), inner + 1);
  assert.equal(rawOffset(parsed, 2, -1), inner + 2); // end of the colored run
  assert.equal(rawOffset(parsed, 2, 1), line.indexOf(' there')); // start of the plain run
  assert.equal(rawOffset(parsed, 8), line.length);
});

test('other HTML is not treated as formatting', () => {
  const html = '<span style="background: yellow">hi</span> and <b>bold</b>';
  assert.deepEqual(parseLine(html).runs.map((r) => r.style), [{}]);
  assert.equal(normalizeLine(html), html);
  // A formatting span inside plain HTML elsewhere on the line still works.
  const mixed = `${html} ${span('x', `color: ${RED}`)}`;
  assert.equal(normalizeLine(mixed), mixed);
});

test('normalizeLine drops broken and empty formatting spans', () => {
  assert.equal(normalizeLine(`Hello <span style="color: ${RED}">world`), 'Hello world');
  assert.equal(normalizeLine('Hello world</span>!'), 'Hello world!');
  assert.equal(normalizeLine(`A <span style="color: ${RED}"></span>B`), 'A B');
  const ok = `## ${span('Fine', `color: ${RED}`)}`;
  assert.equal(normalizeLine(ok), ok);
});

test('stripFormatting removes only formatting tags', () => {
  assert.equal(stripFormatting(`## ${span('Goals', `color: ${BLUE}`)} for <b>Q4</b>`), '## Goals for <b>Q4</b>');
});
