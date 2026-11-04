import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const skill = readFileSync('skills/mouseketool/SKILL.md', 'utf8');
// Parsed strictly, as GitHub and other Agent Skills hosts do: a lenient reader hid an unquoted ": " here.
const frontmatter = parse(/^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '') as { name?: unknown; description?: unknown };
const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
const gate = /## 1\. Gate\n\n(.+)\n/.exec(skill)?.[1] ?? '';
// What the skill triggers on is everything before its exclusion.
const triggersOn = description.split('Do NOT')[0]!;

describe('SKILL.md trigger scope', () => {
  it('has frontmatter that is valid YAML with the skill name', () => {
    expect(frontmatter.name).toBe('mouseketool');
  });

  it('has a description under the 1024 character limit', () => {
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThan(1024);
  });

  it('triggers on a new reusable tool, app, service or library, not on a script or on any size', () => {
    for (const kind of ['reusable', 'tool', 'app', 'service', 'library']) expect(triggersOn).toContain(kind);
    expect(triggersOn).not.toMatch(/script/i);
    expect(description).not.toMatch(/whatever its size/i);
    expect(gate).not.toMatch(/even a small one/i);
  });

  it('excludes a one-off script and a change to existing code, in the description and in the gate', () => {
    for (const text of [description, gate]) {
      expect(text).toMatch(/one-off script/i);
      expect(text).toMatch(/change, fix or extend/i);
    }
  });
});
