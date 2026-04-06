# Rome Design Overhaul Plan — Luma Aesthetic

> **Goal:** Make Rome look and feel like the shadcn Luma preset — Montserrat font, Stone/warm-gray backgrounds, #B81917 red accent, clean white cards on muted surface, 8px border-radius, Title Case labels. No new dependencies. CSS-only changes to `packages/client/src/index.css` and view component inline styles.

**Visual Reference:** shadcn Luma preset (Style=Luma, Base=Stone, Theme=Red, Font=Montserrat). Financial dashboard feel: calm, structured, premium. Think Apple Notes meets Linear.

**Design Gold Standard (already in codebase):** `.kanban-card` — white card, `border-radius:6px`, `box-shadow:0 1px 2px rgba(0,0,0,0.04)`, subtle border. Everything else should aspire to this.

---

## What's Wrong (Audit Findings)

### 1. Font system at war with itself
- `--font-family: "Tomorrow"` set in `:root:18` and hardcoded 12+ times throughout CSS (`'Tomorrow',sans-serif`)
- Montserrat Variable is installed (`@import "@fontsource-variable/montserrat"`) and wired via Tailwind (`--font-sans` in `@theme inline`)
- BUT Tomorrow wins for ALL custom CSS elements — TopBar, tabs, buttons, detail panel, board cards, etc.
- shadcn components get Montserrat (via `@layer base { html { @apply font-sans } }`)
- Result: two fonts fighting on every page, Montserrat only appears in shadcn dropdowns/dialogs

### 2. White-on-white flatness
- `--rome-bg: #FFFFFF`, `--rome-surface: #F8F8F8` — barely distinguishable
- Cards sit on white background = no depth, no hierarchy
- Luma target: warm stone surface (`#F5F4F2` approx), white cards on top = instant hierarchy

### 3. Board card accent strips (AI Slop Pattern #8)
- `.board-card-accent { width:3px }` — the colored left border on every board card
- Pure decoration, zero information value (priority is already shown as a chip on the same card)
- Listed explicitly in gstack AI Slop blacklist: "Colored left-border on cards"

### 4. Kanban status left-borders (same pattern, different view)
- `.kanban-card.status-in_progress { border-left: 3px solid #2563eb }` 
- `.kanban-card.status-blocked { border-left: 3px solid #dc2626 }`
- Cards already live in their status column — the border-left adds no information, just visual noise

### 5. Font sizes below readable minimum
- `.gantt-bar`: `font-size: 8px` — unreadable on any display
- `.board-card-chip`: `font-size: 8px` — priority badges are invisible
- `.budget-bar-fill`: `font-size: 8px`
- Target minimum: 11px

### 6. ALL CAPS overload
- TopBar tabs: `text-transform: uppercase; letter-spacing: 2px` → "TASKS" "BOARD" "GRAPH" etc.
- Button labels: `text-transform: uppercase` on `.btn`
- Detail panel labels: `text-transform: uppercase` on `.dp-label`
- Board group labels: `text-transform: uppercase`
- Budget section titles: `text-transform: uppercase`
- Kanban column labels: `text-transform: uppercase`
- Result: the entire app screams. Nothing at rest, everything at 11.
- Luma target: Title Case for most labels, ALL CAPS reserved for the logo only

### 7. Border-radius inconsistency
- Board cards: `border-radius: 4px`
- Add-node card: `border-radius: 4px`
- Share popover: `border-radius: 4px`
- Kanban cards: `border-radius: 6px` ← gold standard
- Detail panel badge: `border-radius: 2px`
- Target: `8px` uniform for cards/panels, `4px` for small chips/badges

### 8. TopBar button inconsistency
- `.btn` class: uppercase, 9px font, no border-radius — feels like a different app
- `.archive-btn-topbar`: different padding/style — doesn't match `.btn`
- Username: 9px gray, nearly invisible
- ARCHIVE button: styled differently from all other TopBar buttons

### 9. Login page has no visual context
- Currently: floating card on white background, no Rome branding beyond logo text
- Luma target: subtle stone background, maybe a subtle pattern or the DXD diamond motif

---

## Decisions Already Made (Not Up for Review)

| Decision | Choice |
|----------|--------|
| Primary font | Montserrat Variable (already installed) |
| Accent color | #B81917 (keep) |
| Background | Warm stone/gray, ~#F5F4F2 |
| Card background | #FFFFFF (white on stone) |
| Border-radius | 8px for cards/panels, 4px for chips/tags |
| Text casing | Title Case for labels/buttons, ALL CAPS for logo only |
| Board card left-border | Remove entirely |
| Kanban status left-borders | Remove (cards are already in their status column) |
| Min font size | 11px |

---

## Implementation Steps

### Phase 1: Font Fix (index.css — 15 minutes)
**The fix that changes everything.**

- Change `--font-family: "Tomorrow"` → `--font-family: 'Montserrat Variable', system-ui, sans-serif` in `:root`
- Remove all hardcoded `font-family:'Tomorrow',sans-serif` occurrences (grep shows ~12 instances)
- Keep the Google Fonts import for Tomorrow for now (remove later if confirmed not needed)
- Files: `packages/client/src/index.css`
- After this change: `var(--font-family)` in custom CSS and `font-sans` Tailwind class both resolve to Montserrat. Systems aligned.

Key occurrences to find and replace:
```
.tab { ... font-family:'Tomorrow',sans-serif; ... }
.btn { ... font-family:'Tomorrow',sans-serif; ... }
.dp-input { ... font-family:'Tomorrow',sans-serif; ... }
.dp-textarea { ... font-family:'Tomorrow',sans-serif; ... }
.board-card-body textarea { ... font-family:'Tomorrow',sans-serif; ... }
.board-add-row input { ... font-family:'Tomorrow',sans-serif; ... }
.graph-node text { font-family:'Tomorrow',sans-serif; }
.share-input { ... font-family:'Tomorrow',sans-serif; ... }
.archive-title { font-family: var(--font-family); }  ← already OK
.archive-btn-restore { ... font-family: var(--font-family); ... }  ← already OK
```

**Verification:** Every text element should render in Montserrat after this change.

### Phase 2: Color System — Stone Background (index.css — 10 minutes)

Update CSS variables in `:root`:
```css
--rome-bg: #F5F4F2;          /* warm stone, replaces #FFFFFF */
--rome-surface: #FFFFFF;      /* white cards, replaces #F8F8F8 */
--rome-surface-hover: #F8F7F5; /* stone hover */
--rome-border: #E5E3DF;       /* warm border */
--rome-text-muted: #6B6968;   /* warmer muted — passes 4.5:1 contrast on stone */
```

Also update the shadcn OKLCH tokens to match (critical — any shadcn dialog/popover uses these):
```css
--background: oklch(0.974 0.003 75.2);  /* warm stone ~#F5F4F2 */
--card: oklch(1 0 0);                    /* white cards — keep */
```

**Impact:** The entire app shell gets the stone base. Cards (board cards, kanban cards, panels) will now visually "float" on the surface because they're white on stone. Any shadcn popover/dialog also gets the stone background, not white-on-white.

**Tab specifics:** Also update `.tab` in Phase 6:
```css
.tab { font-size: 11px; letter-spacing: 0.3px; /* remove text-transform: uppercase */ }
.logo { font-size: 12px; letter-spacing: 2.5px; text-transform: uppercase; /* keep */ }
```

### Phase 3: Remove AI Slop Left Borders (index.css — 5 minutes)

Board card accent strip:
- Remove `.board-card-accent` div from `BoardView.tsx` render (just remove the JSX element)
- Remove `.board-card-accent` CSS rule from `index.css:184`
- Board card gets slightly less padding on the left to compensate

Kanban status borders:
- Remove `border-left: 3px solid` from `.kanban-card.status-in_progress`
- Remove `border-left: 3px solid` from `.kanban-card.status-blocked`
- The blocked state keeps its background tint (`background: #FEF2F2`) — background treatment is fine, left-border is AI slop
- The in_progress state gets NO replacement treatment — the column header IS the status indicator
- Note: after removing `border-left` from blocked cards, the border becomes `border: 1px solid #FECACA` — keep that subtle red border for the full card perimeter (not just left side)

**BoardView.tsx change:**
```tsx
// In packages/client/src/pages/BoardView.tsx, search for:
className="board-card-accent"
// Remove that entire div element (it's purely decorative)
// Then remove the .board-card-accent CSS rule from index.css
```

### Phase 4: Border Radius — Uniform 8px (index.css — 10 minutes)

Cards and panels: change to `border-radius: 8px`
- `.board-card { border-radius: 4px }` → `border-radius: 8px`
- `.kanban-card { border-radius: 6px }` → `border-radius: 8px`
- `.add-node-card { border-radius: 4px }` → `border-radius: 8px`
- `.share-pop { border-radius: 4px }` → `border-radius: 8px`
- `.board-subgroup-header { border-radius: 4px }` → `border-radius: 8px`
- `.board-add-row { border-radius: 4px }` → `border-radius: 8px`

Small chips: keep at 4px or use 3px:
- `.dp-badge { border-radius: 2px }` → `border-radius: 4px`
- `.board-card-chip { border-radius: 2px }` → `border-radius: 4px`
- `.kanban-card-responsible { border-radius: 3px }` → keep at 4px

### Phase 5: Minimum Font Size — 11px Floor (index.css — 5 minutes)

Audit all `font-size: 8px` and `font-size: 9px` occurrences:

| Selector | Current | Target |
|----------|---------|--------|
| `.gantt-bar` | 8px | 10px (gantt bars are tight) |
| `.board-card-chip` | 8px | 10px |
| `.budget-bar-fill` | 8px | 10px |
| `.board-subgroup-toggle` | 8px | 10px |
| `.board-subgroup-count` | 8px | 10px |
| `.btn` | 9px | 11px |
| `.dp-badge` | 9px | 10px |
| `.dp-label` | 10px | 11px |
| `.logo` | 11px | 12px |

### Phase 6: Text Casing — Title Case (index.css + component files — 20 minutes)

**Rule:** `text-transform: uppercase` stays ONLY on `.logo`. Remove from everything else. Adjust `letter-spacing` down when removing uppercase.

Removals in `index.css`:
- `.tab` — remove `text-transform: uppercase; letter-spacing: 2px` → reduce letter-spacing to `0.3px`
- `.btn` — remove `text-transform: uppercase; letter-spacing: 1px`
- `.dp-label` — remove `text-transform: uppercase; letter-spacing: 1.2px`
- `.board-group-label` — remove `text-transform: uppercase; letter-spacing: 2px`
- `.board-subgroup-label` — remove `text-transform: uppercase; letter-spacing: 1.2px`
- `.budget-section-title` — remove `text-transform: uppercase; letter-spacing: 2px`
- `.kanban-sidebar-title` — remove `text-transform: uppercase; letter-spacing: 2px`
- `.kanban-column-label` — remove `text-transform: uppercase; letter-spacing: 1.5px`
- `.gantt-header-cell` — remove `text-transform: uppercase; letter-spacing: 1px`
- `.gantt-sidebar-group` — remove `text-transform: uppercase; letter-spacing: 1.5px`
- `.archive-row-header` — remove `text-transform: uppercase`
- `.archive-group-label` — remove `text-transform: uppercase`
- `.archive-btn-restore` — remove `text-transform: uppercase`
- `.archive-btn-topbar` — remove `text-transform: uppercase`
- `.share-pop-title` — remove `text-transform: uppercase`

Component text changes (inline strings in TSX, not CSS):
- `packages/client/src/components/TopBar.tsx:58` — change `{t.toUpperCase()}` → `{t.charAt(0).toUpperCase() + t.slice(1)}`
  - Result: Tasks, Board, Graph, Gantt, Budget, Kanban (clean, readable)
- TopBar buttons: "LOGOUT" → "Logout", "SHARE" → "Share" (lines ~73-74)
- `packages/client/src/pages/TasksView.tsx:194` — "ADD" → "Add"
- TopBar "+ NODE", "+ GROUP", "+ STREAM" buttons — keep the `+` prefix, change: "+ Node", "+ Group", "+ Stream"

**KEEP uppercase:**
- `.logo { text-transform: uppercase }` — "DXD HALO OPS" — this is brand identity, stays ALL CAPS
- The logo `letter-spacing: 2.5px` also stays — it's intentional brand tracking

### Phase 7: TopBar Polish (TopBar.tsx + index.css — 15 minutes)

Current issues:
- `.btn` is flat, no border-radius, 9px text
- Username at `font-size: 9px; color: #999` — nearly invisible
- Mixed button styles (`.btn` vs `.archive-btn-topbar`)

Changes:
- Add `border-radius: 6px` to `.btn`
- Increase `.btn` font-size to 11px
- Unify `.archive-btn-topbar` to match `.btn` style, just with a red active state
- Username: increase to 11px, use `color: var(--rome-text-muted)`
- Consider making the logo area slightly bolder — it competes with nothing currently

### Phase 8: Login Page (LoginPage/AuthPage component — 10 minutes)

Current: plain white card floating on white background.
Target: stone background (`--rome-bg`), white card centered, subtle DXD diamond motif perhaps.

If there's an `AuthPage.tsx` or `LoginPage.tsx`:
- Set page background to `var(--rome-bg)` (stone)
- Ensure card has `border-radius: 8px`, `box-shadow: 0 4px 24px rgba(0,0,0,0.08)`
- Add the diamond logo mark above the form (the `logo-diamond` div style)

---

## File Impact

| File | Changes |
|------|---------|
| `packages/client/src/index.css` | All of Phases 1-7 above |
| `packages/client/src/components/TopBar.tsx` | Tab casing (line 58), button text casing |
| `packages/client/src/pages/BoardView.tsx` | Remove `<div className="board-card-accent">` from card render |
| `packages/client/src/pages/TasksView.tsx` | "ADD" → "Add" button (line 194) |
| Auth component (wherever login UI lives) | Phase 8 |

---

## Definition of Done

- [ ] All text renders in Montserrat Variable (no Tomorrow anywhere on screen)
- [ ] App shell background is warm stone, not white
- [ ] Cards visually float on the surface (white on stone)
- [ ] No colored left-border strips on board cards or kanban cards
- [ ] All cards have 8px border-radius
- [ ] No text below 10px
- [ ] Tabs and buttons are Title Case (not UPPERCASE)
- [ ] Only the logo remains ALL CAPS
- [ ] TopBar buttons are visually consistent (same style class)
- [ ] Login page has stone background

## Approved Mockups

*(To be filled in after mockup generation)*

---

## Not In Scope

| Decision | Rationale |
|----------|-----------|
| Dark mode | Not a current user need for 5-10 internal users |
| Responsive / mobile | Rome is desktop-only by design |
| shadcn component replacement | Views use custom CSS, not shadcn components. Keep it. |
| Graph view layout | Layout algorithm is a separate concern from visual style |
| New color palette beyond stone | User confirmed: keep #B81917, just fix the background |
| Animation/transitions | Current `transition: all 0.15s` is fine, no changes needed |
| Icon system | No icons in the current design, don't add them |

## What Already Exists

| Asset | Location |
|-------|----------|
| Montserrat Variable | `@import "@fontsource-variable/montserrat"` in index.css |
| shadcn Stone OKLCH tokens | `:root` variables in index.css (already installed by shadcn init) |
| Kanban card design | `.kanban-card` in index.css — the visual gold standard |
| CSS variable system | `--rome-red`, `--rome-bg`, `--rome-surface`, `--rome-border`, `--rome-text`, `--rome-text-muted` |
| Red accent | `#B81917` throughout, keep |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 6/10 → 8/10, 3 decisions resolved |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** Design review passed. Eng review required before implementation.
