/**
 * Remembers where the Assistant window was, so it comes back where you left it.
 *
 * The window was hardcoded to 440x560 at the OS default position on every
 * launch, which for a window you summon many times a day means moving it out of
 * the way many times a day.
 *
 * Stored in data/ rather than metrics/config.json on purpose: this is per
 * machine UI state, not configuration. data/ is gitignored, so a saved position
 * from one laptop never travels to another with a different monitor layout —
 * which is the case that would otherwise open the window somewhere invisible.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'assistant-window.json');

const DEFAULTS = { width: 440, height: 560 };

/** Below this the layout breaks; matches the window's own minimums. */
const MIN = { width: 360, height: 420 };

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;   // absent or corrupt — the defaults are perfectly fine
  }
}

/**
 * Bounds to open with, or just a size when there is nothing sensible saved.
 *
 * A remembered position is only reused if it still lands on a display that
 * exists. Unplugging a second monitor otherwise leaves the window restored to
 * coordinates nothing can show, which looks exactly like the hotkey being
 * broken — you press it, something opens, and you never see it.
 */
function initialBounds(screen) {
  const saved = load();
  const size = {
    width: Math.max(MIN.width, Number(saved?.width) || DEFAULTS.width),
    height: Math.max(MIN.height, Number(saved?.height) || DEFAULTS.height),
  };

  if (!Number.isFinite(saved?.x) || !Number.isFinite(saved?.y)) return size;

  // Visible if the saved position sits inside any display's work area. The
  // top-left corner alone is enough — a window mostly offscreen can still be
  // dragged back, but one whose corner is on a dead display cannot.
  const onScreen = screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.workArea;
    return saved.x >= x - 8 && saved.x < x + width - 40
      && saved.y >= y - 8 && saved.y < y + height - 40;
  });

  return onScreen ? { ...size, x: Math.round(saved.x), y: Math.round(saved.y) } : size;
}

let timer = null;

/**
 * Persist the current bounds, coalesced.
 *
 * Dragging a window emits a continuous stream of move events, and writing a
 * file on each one is a lot of disk for something only read at startup.
 */
function save(win) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      // Never record a minimized or maximized frame as the normal size —
      // getNormalBounds is the restored geometry, which is what to reopen at.
      const b = win.isDestroyed() ? null : win.getNormalBounds();
      if (!b) return;
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, `${JSON.stringify(b, null, 2)}\n`, 'utf8');
    } catch { /* losing the position is not worth surfacing */ }
  }, 400);
}

/** Write immediately — for quit, where a debounce would never fire. */
function flush(win) {
  clearTimeout(timer);
  try {
    if (!win || win.isDestroyed()) return;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, `${JSON.stringify(win.getNormalBounds(), null, 2)}\n`, 'utf8');
  } catch { /* as above */ }
}

/** Attach the listeners that keep the file current. */
function track(win) {
  for (const event of ['moved', 'resized']) win.on(event, () => save(win));
}

module.exports = { initialBounds, track, flush, FILE, MIN, DEFAULTS };
