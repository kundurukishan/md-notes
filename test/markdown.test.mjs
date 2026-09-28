import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { toggleTask } from '../src/markdown.ts';

// Checkbox states in the order the preview renders them.
function rendered(body) {
  const html = marked.parse(body, { gfm: true, breaks: true, async: false });
  return [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0].includes('checked'));
}

const doc = [
  '- [ ] first',
  '',
  '```md',
  '- [ ] inside a code block',
  '```',
  '',
  '~~~',
  '- [x] also code',
  '```',
  '- [ ] still code (a ``` line does not close a ~~~ fence)',
  '~~~',
  '',
  '> - [ ] quoted',
  '- - [x] nested',
  '1. [ ] numbered',
].join('\n');

test('every rendered checkbox toggles the matching source line', () => {
  const states = rendered(doc);
  assert.deepEqual(states, [false, false, true, false]);
  for (let i = 0; i < states.length; i++) {
    const after = rendered(toggleTask(doc, i));
    const expected = states.map((s, j) => (j === i ? !s : s));
    assert.deepEqual(after, expected, `toggling checkbox ${i}`);
  }
});

test('code blocks are left untouched', () => {
  const toggled = toggleTask(doc, 1);
  assert.match(toggled, /- \[ \] inside a code block/);
  assert.match(toggled, /- \[x\] also code/);
  assert.match(toggled, /> - \[x\] quoted/);
});

test('an out-of-range index changes nothing', () => {
  assert.equal(toggleTask(doc, 99), doc);
});
