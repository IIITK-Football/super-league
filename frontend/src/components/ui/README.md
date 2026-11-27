# UI primitives

Import from the barrel: `import { Button, Card, Sheet } from '../components/ui'`.
Live examples in both themes: `/dev/ui` and, for every input control with its states, `/ui-gallery` (dev builds only).

| Primitive | Use for |
|---|---|
| `Button` (`variant` primary, secondary, quiet, danger; `size` sm, md, lg) | Every action. `buttonClasses(variant, size)` styles a link. |
| `Card` (`as`) | A surface on the page. |
| `Pill` (`tone` neutral, acc, win, live) | Status labels. `live` adds a pulsing dot. |
| `Skeleton` | Loading bars sized like the final content. Never a full-screen spinner. |
| `EmptyState` (`title`, `action`) | Checked and empty, with the next step. |
| `ErrorState` (`message`, `onRetry`) | A failed load, with a retry. |
| `Notice` (`tone` info, success, error, warning) | Inline status next to a form or action. |
| `Sheet` (`open`, `onClose`, `title`) | Bottom sheet on phones, side panel from md up. Escape closes, focus is trapped. |
| `Tabs` (`tabs`, `value`, `onChange`, `label`) | Switching views within one page. The underline slides to the selected tab. |
| `Field` (`label`, `error`, `hint`, `as`) | Any labelled control. Eyebrow label; hint and error are linked by `aria-describedby`. Native: `as="select"` or `"textarea"`. Custom: pass a function child, `{(p) => <Select {...p} ... />}`; `p` holds `id`, `aria-labelledby`, `aria-describedby`, `aria-invalid`. |
| `TextInput` (`icon`, `size` md or lg), `TextArea` (`rows`) | Text in a glass well with a soft white focus glow. `icon` is a lucide component. Refs forward to the field. |
| `Select` (`value`, `onChange(value)`, `options` `[{ value, label, icon?, description?, disabled? }]`, `placeholder`, `name`, `disabled`, `id`) | Picking one of a short list. Arrows, Home, End, Enter, Escape, type-ahead. `name` adds a hidden input for forms. `icon` is a node (a `Crest`). |
| `Combobox` (as `Select`, plus `searchPlaceholder`, `emptyText`) | Long lists (players, teams): a search box filters by label and description. |
| `SegmentedControl` (`options` `[{ value, label, icon?, disabled? }]`, `value`, `onChange`, `aria-label` or `aria-labelledby`) | Two to five exclusive choices (card colour, home or away). A radio group; arrows move and choose. |
| `NumberField` (`value`, `onChange(number)`, `min`, `max`, `step`, `size` md or lg) | Counts, minutes, scores. Hold - or + to repeat; Up, Down, Page Up, Page Down, Home, End; typed values clamp on Enter or blur. `lg` gives big digits. |
| `Switch` (`checked`, `onChange(bool)`, `label`, `description`) | An instant on or off setting. |
| `Checkbox` (`checked`, `onChange(bool)`, `label`, `description`) | A choice that is saved with a form. Native input underneath. |
| `DateTimeField` (`type` date, time or datetime-local, input props) | Dates and times. Native pickers (reliable on phones) in the well, with an icon. |
| `Toaster` + `toast({ title, description, tone, duration })` / `useToast()` | Brief confirmation after an action (`success`, `error`, `info`). `Toaster` is mounted once in `App.jsx`. Inline problems next to a form still use `Notice` or the field error. |
| `Table` (`caption`) | Data tables. First column stays put; scrolls sideways on phones. |
| `Crest` (`name`, `src`, `color`, `size`) | Team or division logo. Initials when there is no image. |
| `Scoreline` (`home`, `away`, `live`) | Scores. Missing values show a dash. `live` animates changes. |
| `ConfirmDialog` (`open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `tone` default or danger, `onConfirm`) | Confirm a destructive or irreversible step. `onConfirm` may return a promise: busy state, and a rejection shows inline. Bottom sheet on phones, card on laptop. |
| `ConfirmProvider` + `useConfirm()` | Mounted once in `App.jsx`. `const ok = await confirm({ title, description, confirmLabel, tone })` resolves `true` or `false`. Use this instead of `window.confirm`. |
| `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem` (`tone` default or danger), `MenuSeparator` | Action menus. Radix dropdown: arrow keys, Enter, Escape. Items are 44px. |
| `Popover`, `PopoverTrigger`, `PopoverContent` | Short, non-critical detail anchored to a control. Escape and outside click close it. |

Rules:
- Never call `window.alert`, `window.confirm` or `window.prompt`. Use `useConfirm` (or `ConfirmDialog`).
- Colour comes from the tokens (`bg-surf`, `text-ink`, `text-mut`, `border-line`, `bg-acc`, `text-acc2`, `text-live`). No hex values in components.
- The division accent is `var(--div)`, set by the app shell. Never hardcode a division colour.
- Numbers (scores, points, ratings) use `font-display` and `tabular-nums`.
- Touch targets are at least 44px. Do not shrink them.
- Motion is 150 to 250ms and always `motion-safe:`. `motion/react` animations use the shared `SPRING` (`springs.js`) inside `<MotionConfig reducedMotion="user">`.
- Controls wear the `well` utility (index.css); floating panels wear `float-glass`. Prefer `Select`, `NumberField` and `DateTimeField` over bare native inputs.
- No em dashes in UI copy. Sentence case headings.

## The look (night, built on the original site)

Reference implementations: `pages/Home.jsx`, `pages/LeagueLanding.jsx`, `components/match/HeroMatch.jsx`,
`components/standings/StandingsTable.jsx`, `components/NewsArticle.jsx`, `components/shell/AppShell.jsx`.

- Ground is true black (`bg-bg`), type is white (`text-ink`), secondary text `text-mut`. Dark always; light only by choice.
- Headings: `<h1|h2|h3 className="font-display ...">` render in Inter Black, uppercase, tight. Page titles
  `text-4xl sm:text-6xl`, section titles `text-3xl sm:text-4xl`. Never recolour a word inside a heading.
- Labels: `eyebrow` (tiny, letter-spaced, uppercase, muted). Use it for column heads, kickers, meta lines and "see all"
  links (with an arrow icon). Do not add labels that repeat what the design already shows.
- Tiles: `glass rounded-card` (subtle frosted surface with a top highlight). Clickable tiles add `lift` (rises on hover);
  feature tiles may use `<Spotlight>` (cursor light). Never stack glass inside glass; inner rows use dividers
  (`divide-y divide-line/70`).
- Names of clubs and players in lists: `font-black uppercase tracking-tight`. Numbers that matter (points, goals, scores):
  `font-display tabular-nums`, large. `<NumberTicker>` for a headline stat.
- Live: red ping dot (`bg-live animate-ping`) plus "Live · 67′". `beam` on the one live tile. Photos are black and white
  at rest and colour on hover (see NewsArticle).
- Buttons: primary is a white pill (`bg-ink text-bg rounded-pill font-black uppercase tracking-[0.2em] text-sm`), secondary
  is a glass pill. 44px targets.
- Spacing: sections `space-y-14`, inside a section `space-y-4`. Laptop content uses the width (grids), nothing floats in
  empty space; phones stack.
- Banned: neon colours, coloured text gradients (only the white-to-grey `.chrome` on display headings and big numbers), italics except the wordmark, pills that state the obvious ("Upcoming" on a
  future fixture), em dashes, filler copy.
