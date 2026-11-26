# UI primitives

Import from the barrel: `import { Button, Card, Sheet } from '../components/ui'`.
Live examples in both themes: `/dev/ui` (dev builds only).

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
| `Tabs` (`tabs`, `value`, `onChange`, `label`) | Switching views within one page. |
| `Field` (`label`, `error`, `hint`, `as`) | Any labelled input, select or textarea. |
| `Table` (`caption`) | Data tables. First column stays put; scrolls sideways on phones. |
| `Crest` (`name`, `src`, `color`, `size`) | Team or division logo. Initials when there is no image. |
| `Scoreline` (`home`, `away`, `live`) | Scores. Missing values show a dash. `live` animates changes. |

Rules:
- Colour comes from the tokens (`bg-surf`, `text-ink`, `text-mut`, `border-line`, `bg-acc`, `text-acc2`, `text-live`). No hex values in components.
- The division accent is `var(--div)`, set by the app shell. Never hardcode a division colour.
- Numbers (scores, points, ratings) use `font-display` and `tabular-nums`.
- Touch targets are at least 44px. Do not shrink them.
- Motion is 150 to 250ms and always `motion-safe:`.
- No em dashes in UI copy. Sentence case headings.
