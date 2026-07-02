---
name: sprintboard-usage
description: >-
  How to keep OledKoiPond's project tracking accurate. Use this whenever you
  finish a piece of work, add or move a ticket, create an epic, file session
  artifacts/notes/designs, or update the SprintBoard. Covers where documents and
  media go (docs/epics/<E#>/, docs/idea-pond/), the ticket knowledge-graph step,
  editing dev-artifacts/SprintBoard.html (BAKED_DATA, statuses, epic filters),
  the doc/media card icons, and how much detail to put on a ticket.
---

# SprintBoard usage

The board lives at `dev-artifacts/SprintBoard.html` and opens directly in a
browser (no build step). Its ticket array — the `BAKED_DATA` block between the
`/* BEGIN_TICKETS */` and `/* END_TICKETS */` markers — **is the single source of
truth**. Edit it by hand. (The old `tickets.json` + `build-board.js` pipeline was
retired.)

Do these three things as work happens: **file artifacts**, **update the board**,
and **(placeholder) update the knowledge graph**.

---

## 1. Where session data & artifacts go

| What | Where |
|------|-------|
| Docs for an epic / its stories | `docs/epics/<E#>/` (e.g. `docs/epics/E13/`) |
| Ideas with no epic yet | `docs/idea-pond/` |
| Media (art, audio, diagrams, narrative docs) | alongside the doc, in the same folder |
| Cross-cutting refs (GDD, TASKS, boids notes) | `docs/` root |

- Create an epic folder the first time that epic gets a document — don't
  pre-create empty ones.
- Name story docs by ticket ID where useful (`E13-4-build-spec.md`).
- When a doc backs a ticket, set the ticket's `docRef` to its path so the card
  tooltip links them.

---

## 2. Knowledge graph  *(placeholder — not built yet)*

> We intend to maintain a project knowledge graph so we can tell whether code
> that's been implemented has also been captured as structured knowledge. The
> tooling doesn't exist yet and the shape is undecided.
>
> **For now:** when you ship a substantive piece of code, leave a detailed design
> writeup in the ticket's epic folder and set the ticket's `doc` marker to `3`
> (see below). That `doc:3` icon is our stand-in for "this is in the knowledge
> graph." Replace this section with the real workflow once the KG exists.

---

## 3. Updating SprintBoard.html

### Move a ticket between columns
Change the ticket's `"status"` to one of: `idea-pond`, `backlog`,
`ready-for-design`, `implementation`, `testing`, `live`. (Dragging in the browser
also works, but persists only to that browser's `localStorage` — copy it back
into `BAKED_DATA` via the **Copy JSON** button to make it permanent.)

### Ticket schema
Required: `id`, `epic`, `title`, `status`. Common: `sprint`, `notes` (the short
line shown collapsed). Optional detail fields (see §5) and markers (see §4).

### Adding a NEW epic — three edits, all near the top of the file
1. **Filter button** in `#controls` (header): copy an existing
   `<button class="filter-btn" data-epic="E14" style="color:#XXXXXX;border-color:#XXXXXX33">E14 Name</button>`.
   *Every epic needs a filter button — it's easy to forget.*
2. **`EPIC_COLORS`** — add `E14: '#XXXXXX'` (match the button color).
3. **`EPIC_NAMES`** — add `E14: 'Human-readable name'`.

Then add the epic's tickets to `BAKED_DATA`.

---

## 4. Card icons (markers)

Two **independent** flags describe a ticket's documentation footprint. Both are
optional; a card can show a doc icon and the media icon together.

**`doc`** — how much planning/design exists (mutually exclusive progression):

| value | icon | meaning |
|-------|------|---------|
| `1` | single page | documented elsewhere; minimal planning (no epic needed) |
| `2` | stack of docs | implementation details exist (in an epic); not started yet |
| `3` | stack + centered plus | highly detailed implementation design — **added to the knowledge graph** |

- Optional `docRef` (string) names the source file; shows in the hover tooltip.

**`media`** — set to `true` (or a descriptive string) when media / special file
types are attached (art, audio, diagrams, narrative docs beyond a plain `.md`).
Renders a portrait-photo icon next to the doc icon. A string value shows in the
tooltip.

```json
{ "id":"E13-1", "epic":"E13", "title":"…", "status":"live",
  "doc":3, "docRef":"docs/epics/E13/entity-customization-plan.md",
  "media":"turntable renders + audio" }
```

The header legend is generated from these definitions, so it stays in sync
automatically.

---

## 5. How much detail per ticket

Cards are **collapsed by default** and the note clamps to two lines, so the board
stays a fast visual scanner. A **Details** toggle expands any card that has extra
content. Because detail is hidden until opened, **don't be shy with it** — put as
much as is useful in these optional fields:

| field | shows as | notes |
|-------|----------|-------|
| `desc` | Description | one or two sentences |
| `created` / `started` / `ended` | date row | free-form date strings |
| `tech` | Technical summary | how it was / will be built |
| `open` | Open questions | string or array of strings |
| `bugs` | Known bugs / issues | string or array; rendered in red |

Keep `notes` short (it's the collapsed one-liner); push the rest into the fields
above. Fill in only what's true — every field is optional and only present ones
render.

---

## Quick verify after editing
Open `dev-artifacts/SprintBoard.html` in a browser (or headless Chromium) and
confirm: no console errors, the ticket landed in the right column, the epic
filter button works, and any icons/detail render as intended.
