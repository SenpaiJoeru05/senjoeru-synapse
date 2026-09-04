/**
 * MemoryService — read and correct what Joeru remembers.
 *
 * Memory is plain markdown in joeru-kit, one fact per file, with an index at
 * MEMORY.md that Joeru reads first and then follows selectively. This service
 * is the UI's way in: browse, fix a wrong memory, delete one that went stale.
 *
 * Writing here writes into a git repo the user owns, so paths are validated
 * strictly rather than trusted — a slug is a slug, never a path.
 *
 * The index is kept in step surgically rather than regenerated. Joeru writes
 * those lines himself and phrases the hooks in his own words; rebuilding the
 * file wholesale would flatten that every time someone fixed a typo.
 */

const fs = require('fs-extra');
const path = require('path');

// Directory name → the `type` recorded in each file's frontmatter.
const FOLDERS = {
  facts: 'fact',
  preferences: 'preference',
  decisions: 'decision',
  corrections: 'correction',
};

const HEADINGS = {
  facts: 'Facts',
  preferences: 'Preferences',
  decisions: 'Decisions',
  corrections: 'Corrections',
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parse(source) {
  const match = source.match(FRONTMATTER);
  if (!match) return { data: {}, body: source.trim() };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    data[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { data, body: source.slice(match[0].length).trim() };
}

/** kebab-case → Title Case, for the index line of a brand-new memory. */
const titleize = (slug) =>
  slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

class MemoryService {
  /** @param {{ memoryDir: string }} opts */
  constructor({ memoryDir }) {
    this.dir = memoryDir;
    this.indexFile = path.join(memoryDir, 'MEMORY.md');
  }

  available() {
    return fs.existsSync(this.dir);
  }

  /** Reject anything that isn't a known folder and a plain slug. */
  #resolve(folder, slug) {
    if (!FOLDERS[folder]) throw new Error(`Unknown memory type "${folder}"`);
    if (!SLUG.test(String(slug || ''))) throw new Error(`Invalid slug "${slug}"`);

    const file = path.join(this.dir, folder, `${slug}.md`);
    // Belt and braces: even with the slug pattern above, never allow a write
    // to escape the memory directory.
    if (!file.startsWith(path.join(this.dir, folder) + path.sep)) {
      throw new Error('Path escapes the memory directory');
    }
    return file;
  }

  list() {
    if (!this.available()) return { available: false, dir: this.dir, memories: [] };

    const memories = [];
    for (const folder of Object.keys(FOLDERS)) {
      const dir = path.join(this.dir, folder);
      if (!fs.existsSync(dir)) continue;

      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
        const slug = path.basename(file, '.md');
        const { data, body } = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const stat = fs.statSync(path.join(dir, file));

        memories.push({
          folder,
          slug,
          type: data.type || FOLDERS[folder],
          name: data.name || slug,
          description: data.description || '',
          created: data.created || null,
          updated: stat.mtimeMs,
          body,
          // Links written as [[other-slug]] — surfaced so the UI can show what
          // a memory connects to.
          links: [...body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)].map((m) => m[1]),
        });
      }
    }

    memories.sort((a, b) => b.updated - a.updated);
    return { available: true, dir: this.dir, memories };
  }

  save(folder, slug, { description, body }) {
    const file = this.#resolve(folder, slug);
    const isNew = !fs.existsSync(file);

    const existing = isNew ? { data: {} } : parse(fs.readFileSync(file, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);

    const frontmatter = [
      `name: ${slug}`,
      `description: ${String(description || existing.data.description || '').replace(/\r?\n/g, ' ')}`,
      `type: ${FOLDERS[folder]}`,
      `created: ${existing.data.created || today}`,
    ].join('\n');

    fs.ensureDirSync(path.dirname(file));
    fs.writeFileSync(file, `---\n${frontmatter}\n---\n\n${String(body || '').trim()}\n`, 'utf8');

    this.#syncIndex(folder, slug, description, isNew);
    return { folder, slug, created: isNew };
  }

  remove(folder, slug) {
    const file = this.#resolve(folder, slug);
    if (!fs.existsSync(file)) throw new Error('No such memory');

    fs.removeSync(file);
    this.#dropFromIndex(folder, slug);
    return { folder, slug, removed: true };
  }

  /* ── index upkeep ──────────────────────────────────────────────────────── */

  #readIndex() {
    return fs.existsSync(this.indexFile) ? fs.readFileSync(this.indexFile, 'utf8') : '';
  }

  #syncIndex(folder, slug, description, isNew) {
    let index = this.#readIndex();
    if (!index) return;

    const link = `(${folder}/${slug}.md)`;
    const lines = index.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes(link));

    if (at !== -1) {
      // Keep the title Joeru chose; only refresh the hook after the em dash.
      const title = lines[at].match(/^- \[([^\]]+)\]/)?.[1] || titleize(slug);
      lines[at] = `- [${title}]${link}${description ? ` — ${description}` : ''}`;
      fs.writeFileSync(this.indexFile, lines.join('\n'), 'utf8');
      return;
    }

    if (!isNew) return;

    // New memory: file it under its heading, replacing the "none yet" note if
    // this is the first of its kind.
    const heading = `## ${HEADINGS[folder]}`;
    const headingAt = lines.findIndex((l) => l.trim() === heading);
    const entry = `- [${titleize(slug)}]${link}${description ? ` — ${description}` : ''}`;

    if (headingAt === -1) {
      lines.push('', heading, '', entry);
    } else {
      const placeholder = lines.findIndex(
        (l, i) => i > headingAt && /^_\(none yet/.test(l.trim()),
      );
      const nextHeading = lines.findIndex((l, i) => i > headingAt && l.startsWith('## '));
      if (placeholder !== -1 && (nextHeading === -1 || placeholder < nextHeading)) {
        lines[placeholder] = entry;
      } else {
        lines.splice(headingAt + 2, 0, entry);
      }
    }

    fs.writeFileSync(this.indexFile, lines.join('\n'), 'utf8');
  }

  #dropFromIndex(folder, slug) {
    const index = this.#readIndex();
    if (!index) return;

    const link = `(${folder}/${slug}.md)`;
    const lines = index.split(/\r?\n/).filter((l) => !l.includes(link));

    // Removing the last entry of a kind would otherwise leave a bare heading.
    // Put the placeholder back, so the section still reads as deliberate and a
    // later create has something to replace again.
    const heading = `## ${HEADINGS[folder]}`;
    const headingAt = lines.findIndex((l) => l.trim() === heading);
    if (headingAt !== -1) {
      const nextHeading = lines.findIndex((l, i) => i > headingAt && l.startsWith('## '));
      const end = nextHeading === -1 ? lines.length : nextHeading;
      const hasEntry = lines.slice(headingAt + 1, end).some((l) => l.trim().startsWith('- ['));
      const hasPlaceholder = lines.slice(headingAt + 1, end).some((l) => /^_\(none/.test(l.trim()));

      if (!hasEntry && !hasPlaceholder) {
        lines.splice(headingAt + 2, 0, `_(none yet)_`);
      }
    }

    fs.writeFileSync(this.indexFile, lines.join('\n'), 'utf8');
  }
}

module.exports = { MemoryService, FOLDERS };
