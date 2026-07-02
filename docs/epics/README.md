# Epic documentation

One folder per epic, named by its epic ID (`E1`, `E2`, … `E13`, `B1`). Everything
that documents an epic or one of its stories lives in its folder: design notes,
build specs, research, diagrams, artwork, audio, and narrative docs.

```
docs/epics/
  E13/
    entity-customization-plan.md     ← architecture / design
    E13-4-build-spec.md              ← per-story build spec
    <art, audio, diagrams, …>        ← media that earns a ticket its media icon
```

## Conventions

- **Create a folder when an epic first gets a document** — don't pre-create empty
  ones. `docs/idea-pond/` holds documents for ideas that don't have an epic yet.
- **Name story docs by ticket ID** where it helps (e.g. `E13-4-build-spec.md`).
- When a ticket points at a doc, set its `docRef` on the SprintBoard card to the
  path here (e.g. `docs/epics/E13/entity-customization-plan.md`) so the hover
  tooltip links the two.
- Cross-cutting references that aren't tied to a single epic (e.g.
  `docs/GDD.md`, `docs/TASKS.md`, the boids references) stay at the `docs/` root.

See `.claude/skills/sprintboard-usage/SKILL.md` for the full workflow — where
artifacts go, how the SprintBoard markers work, and how to keep the board accurate.
