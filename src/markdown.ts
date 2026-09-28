// Matches task items, including nested (`- - [ ]`) and quoted (`> - [ ]`) ones.
const TASK_RE = /^((?:\s*>)*\s*(?:(?:[-*+]|\d+[.)])\s+)+\[)([ xX])(\].*)$/;
const FENCE_RE = /^(?:\s*>)*\s{0,3}(`{3,}|~{3,})/;

// Flips the nth Markdown task checkbox in the source text. Lines inside fenced
// code blocks are skipped, since the preview doesn't render checkboxes there.
export function toggleTask(body: string, index: number): string {
  const lines = body.split('\n');
  let fence: string | null = null;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const task = lines[i].match(TASK_RE);
    if (!task) continue;
    if (seen++ === index) {
      lines[i] = `${task[1]}${task[2] === ' ' ? 'x' : ' '}${task[3]}`;
      break;
    }
  }
  return lines.join('\n');
}
