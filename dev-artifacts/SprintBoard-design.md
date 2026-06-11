# SprintBoard — Design Plan

**Status:** Plan (not yet implemented)  
**Artifact type:** Developer tooling — not part of the game build

---

## Problem

We need a task board that:
- Opens in Chrome on mobile and desktop with no tooling required
- Stores ticket data in a human-readable, easily-editable format
- Is entirely self-contained in the repo (no external services)
- Supports light interactivity (column collapse, epic filter, drag-to-move)

---

## Format decision: HTML, not Markdown

| Option | Opens in Chrome natively | Human-readable data | Interactivity |
|--------|--------------------------|---------------------|---------------|
| `.md` file | ❌ renders as raw text | ✅ | ❌ |
| `.md` + grip/VS Code | ✅ (with tool) | ✅ | ❌ |
| `.html` inline data | ✅ | ✅ (JSON block) | ✅ |
| `.html` + build script | ✅ | ✅ (separate JSON) | ✅ |

**Decision: `.html` generated from `tickets.json` via a build script.**

Why: fully native in Chrome, mobile-friendly, interactive, and tickets remain
a clean separate file that any text editor can update without touching HTML.

---

## Why interactivity is NOT complicated here

Chrome opens a local `.html` file at `file://` with no server. The only
restriction is that `fetch()` is blocked for other local files — hence the
build script rather than a live JSON load.

Within a self-contained `.html` file, the following are all straightforward:

| Feature | Mechanism | Complexity |
|---------|-----------|------------|
| Column collapse/expand | `<details><summary>` HTML — zero JS | trivial |
| Filter tickets by epic | 10–15 lines JS | low |
| Drag ticket to new column | HTML5 Drag & Drop API, ~40 lines JS | low |
| Persist drag changes across reload | `localStorage`, 5 lines | low |
| Responsive layout (mobile stacks) | CSS Grid + `@media`, ~20 lines CSS | low |

Total estimate: ~200 lines HTML/CSS/JS for a polished, interactive board.
None of this requires a framework or build pipeline beyond the one-line data inject.

---

## File structure

```
dev-artifacts/
  tickets.json          ← canonical ticket data — edit this
  build-board.js        ← Node script: injects tickets.json into SprintBoard.html
  SprintBoard.html      ← generated output — open this in Chrome
  SprintBoard-design.md ← this file
```

`SprintBoard.html` is committed to the repo (so it can be opened immediately
without running the build), but it is a generated file — `tickets.json` is
the source of truth. After editing tickets, run the build once.

---

## tickets.json schema

```json
[
  {
    "id":     "E1-1",
    "epic":   "E1",
    "title":  "PWA manifest + icons",
    "status": "ready",
    "notes":  "manifest.json + icons so Add to Home Screen shows a proper icon"
  }
]
```

**Status values:** `"backlog"` | `"ready"` | `"in-progress"` | `"done"`

**Epic values:** `"E1"` through `"E6"` (matches TASKS.md epic IDs)

The schema is intentionally flat and minimal. Adding a field to every ticket
is a one-line search-replace in a JSON editor.

---

## Board layout

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  BACKLOG    │   READY     │ IN PROGRESS │    DONE     │
│  ⬜ N cards │  🟦 N cards │  🔶 N cards │  ✅ N cards │
├─────────────┼─────────────┼─────────────┼─────────────┤
│ [E1] card   │ [E1] card   │ [E2] card   │ [E1] card   │
│ [E2] card   │ [E3] card   │             │             │
│ ...         │ ...         │             │             │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

On mobile (< 640px): columns stack vertically, each collapsible via
`<details>` so Done/Backlog can be hidden to focus on the active work.

---

## Color coding

Each epic gets a distinct hue applied as a left-border accent on cards:

| Epic | Color |
|------|-------|
| E1 · Core Polish | cyan |
| E2 · Water & Interaction | blue |
| E3 · Visual System | purple |
| E4 · Entity Ecosystem | green |
| E5 · Deployment | orange |
| E6 · Creator Workshop | red/pink |

---

## Interactivity spec

### Always-on (CSS only, no JS)
- Column collapse on mobile via `<details>`
- Card hover highlight

### On page load (JS, ~15 lines)
- Epic filter buttons above the board — clicking an epic hides cards from
  other epics. "All" resets. State NOT persisted (intentional — filters are
  a viewing aid, not data).

### Drag to move (JS, ~40 lines)
- Drag a card from one column to another → status updates in the in-memory
  data and the card moves visually.
- On drop, updated ticket array is written to `localStorage` under key
  `koipond.board`. This overrides the baked-in data on next load.
- A **"Copy JSON"** button exports the current board state as a
  `tickets.json` snippet — paste it back into `tickets.json`, re-run the
  build, and the change is permanent in the repo.

This avoids file-write access (browsers can't write to disk) while keeping
the workflow ergonomic: drag things around, copy the result, paste into the
JSON file once you're happy.

---

## build-board.js

```js
// dev-artifacts/build-board.js
// Usage: node build-board.js
import { readFileSync, writeFileSync } from 'fs';
const tickets  = readFileSync('tickets.json', 'utf8');
let   template = readFileSync('SprintBoard.template.html', 'utf8');
template = template.replace('/*TICKETS_JSON*/', tickets);
writeFileSync('SprintBoard.html', template);
console.log('SprintBoard.html updated.');
```

Alternatively (skip the template file, simpler):

```js
import { readFileSync, writeFileSync } from 'fs';
const tickets = readFileSync('tickets.json', 'utf8');
let   html    = readFileSync('SprintBoard.html', 'utf8');
// Replace the JSON blob between sentinel comments
html = html.replace(
  /\/\* BEGIN_TICKETS \*\/[\s\S]*?\/\* END_TICKETS \*\//,
  `/* BEGIN_TICKETS */ ${tickets} /* END_TICKETS */`
);
writeFileSync('SprintBoard.html', html);
console.log('SprintBoard.html updated.');
```

The sentinel-comment approach means `SprintBoard.html` can be checked in
and directly opened even without running the build — only run the build
after editing tickets.

---

## Implementation checklist (when execution mode begins)

- [ ] Create `tickets.json` with all stories from TASKS.md
- [ ] Create `SprintBoard.html` (HTML + CSS + JS, self-contained)
- [ ] Create `build-board.js` (sentinel-replace script)
- [ ] Test: open `SprintBoard.html` in Chrome on desktop and mobile
- [ ] Test: drag a card, copy JSON, verify output matches expected schema
- [ ] Commit all three files
- [ ] Add `npm run board` script to `package.json` (or note the `node` command in a comment)

---

## Open questions (decide before implementation)

| # | Question | Options |
|---|----------|---------|
| Q1 | Include sprint milestone field on tickets? | Yes (sprint number or date) / No (status alone is enough) |
| Q2 | Show ticket notes on card, or behind a hover/expand? | Always visible (cleaner) / Expand on click (less cluttered) |
| Q3 | Dark theme? | Yes — consistent with the OLED aesthetic of the project |

---

*Plan written: 2026-06-11. Awaiting execution-mode green light.*
