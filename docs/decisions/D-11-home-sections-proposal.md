# D-11 proposal: homepage sections that follow the current division

Historical proposal. See [the current decision](D-11-home-sections.md) for the archive placement.

Status: **proposal, open**. Blocks SL-060 (configurable first version) and SL-093 (redesign). The video is D-07. Drafted 2026-11-18.

## 1. Current state
- **The home page** (`/`, `LeagueLanding.jsx`) has only the hero video and a menu of hard-coded divisions.
- **The division page** (`/<division>`, `Home.jsx`) shows fixed blocks in a fixed order:
  - the season select;
  - the live or next match;
  - "Top 4 Standings" or a hard-coded "Road to Final";
  - "The Onion Drops" news grid;
  - "Player Leaders";
  - "Fantasy Snapshot".
- **News** on the dashboard is the latest 5 `newsletter` rows. `newsletter` has no division or season column.
- **`section_types` / `season_sections`** configure each season's own page and navigation (`fixtures`, `standings`, `stats`, `fantasy`, `news`, ...). They are audited and edited in `ManageDivisions.jsx`.

## 2. Options
| | A. New `home_sections` (recommended) | B. Reuse `season_sections` with home keys | C. Hard-coded order |
|---|---|---|---|
| Global sections (news, World Cup) | natural | need a fake season | yes |
| One ordered list for the home page | yes | merged per season at runtime | yes |
| Mixes home placement with division navigation | no | yes | n/a |
| Dictator-configurable | yes | yes | no |

A keeps the home page as one ordered list. It still uses `season_sections` as the gate: a division-following section renders only when the selected season has the matching section enabled, so "is fantasy on?" is answered in one place.

## 3. Recommendation (A)
```
home_section_types(key PK, label, follows_division bool, requires_season_section text NULL REFERENCES section_types(key))
home_sections(id, kind REFERENCES home_section_types, sort_order, enabled, title NULL, settings jsonb (object), updated_at, updated_by)
home_carousel_items(section_id, newsletter_id, sort_order, PRIMARY KEY (section_id, newsletter_id))
```
- **Data, not enums:** kinds are seeded by migration as lookup data. Public read; dictators write. All three tables are audited.
- **Hiding** is `enabled = false`, never a delete.
- **"Current division"** is the division of the selected video chapter (D-07), or the lead chapter's division.
- **The API** `/api/home?division=<slug>` returns the ordered, enabled sections with their data, reusing the dashboard queries.

**Default order** (from today's pages):

| # | kind | follows division | gate | source |
|---|---|---|---|---|
| 1 | `hero_video` (pinned) | chapter rail | — | LeagueLanding |
| 2 | `news_carousel` | no | — | chosen items; an empty list falls back to the latest 5 |
| 3 | `match_spotlight` | yes | `fixtures` | live/next match |
| 4 | `standings_snapshot` | yes | `standings` (or `bracket` for knockouts) | Top 4 |
| 5 | `player_leaders` | yes | `stats` | Golden Boot / Playmaker |
| 6 | `fantasy_snapshot` | yes | `fantasy` | Fantasy Snapshot |
| 7 | `world_cup_entry` | no | — | the SL-060 entry to `/wc` |

"Road to Final" stays with SL-054. The division page `Home.jsx` is not changed by this decision.

**SL-060 (minimal):** a dictator panel to:
- reorder and enable sections;
- choose and order carousel items;
- edit the World Cup entry.

The home page renders a simple stacked layout. **SL-093** redesigns the carousel and motion.

**Untouched:** the newsletter schema, editor permissions, the World Cup page, and the meaning of `season_sections`.

## 4. Questions for the owner
1. Keep the news carousel site-wide instead of following the division? **Default: yes.** Newsletter has no division column; tagging articles by division is a separate decision.
2. Should dictators only choose carousel items, or editors too? **Default: dictators only** (SL-003).
3. Should an empty carousel fall back to the latest 5 articles? **Default: yes.**
4. Hide a division-following section when its season gate is off, instead of showing an empty state? **Default: hide.**
5. Make the World Cup entry an ordinary, reorderable section? **Default: yes.**
6. Should dictators add new section kinds through data alone? **Default: no.** A kind needs a renderer, so kinds are added by migration; dictators order, enable and configure them.
