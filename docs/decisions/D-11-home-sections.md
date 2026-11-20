# D-11 decision: home sections

Resolved by the owner on 2026-11-20. Applies to SL-060 and SL-093. Option A of `D-11-home-sections-proposal.md`: `home_section_types`, `home_sections` and `home_carousel_items`, kinds seeded as lookup data, hiding is `enabled = false`, and a division-following section renders only when the selected season has its section enabled.

- **`world_cup_entry` stays a home section** and SL-060 keeps its World Cup entry outcome: a configurable home entry that links to `/wc`. It changes nothing in World Cup itself (`D-02-world-cup-separation.md`).
- The existing World Cup link in the Fantasy navigation is removed (SL-043), so `/wc` is reached from home content and its own URL.
- The proposal's defaults apply: the news carousel is site-wide; dictators choose carousel items (editors do not); an empty carousel falls back to the latest 5 articles; a division-following section is hidden, not shown empty, when its gate is off.
