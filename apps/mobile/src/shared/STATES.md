# Per-screen state checklist (Definition of Done)

Every screen story is done only when its UX deliverable and its tests cover the PRD section 6.4
interaction states that apply. Use the shared feedback components; do not invent new ones.

| State | Pattern | Component |
|-------|---------|-----------|
| initial | the screen as first drawn, before data | shell and header only |
| loading | skeleton blocks, values fade in over 150-250 ms; never a spinner | `Skeleton`, `Reveal` |
| empty | paper boat, one sentence, one primary button | `EmptyState` |
| populated | real data; an unknown balance shows "not set", never zero | screen |
| error | plain cause, "Nothing was saved", Retry and an alternative path; announced once, assertively; focus to the first invalid field | `ErrorBlock` |
| partial / import-review | what was read, what needs a decision, one next step | screen |
| permission-denied | what is unavailable and the one path that still works, plus Open settings | `ErrorBlock` |
| read-only | controls absent or inert with the reason in text | screen |
| confirmation | reversible actions use a toast with Undo (at least 10 s, pauses on touch or focus, stays under TalkBack) | `useToast` |
| success | `Saved` toast, or the changed value visible in place | `useToast` |
| offline | **not shown**: the app works fully offline, so there is no offline state | none |

Also required for every screen: sentence-case copy from `copy.ts`, money only through `<Amount>`, colours only from theme
tokens, 48dp controls, TalkBack labels with role and state, and the state set above covered by tests.
