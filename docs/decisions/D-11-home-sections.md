# D-11 decision: home sections

Resolved by the owner on 2026-11-20. Applies to SL-060 and SL-093. Option A of `D-11-home-sections-proposal.md`: `home_section_types`, `home_sections` and `home_carousel_items`, kinds seeded as lookup data, hiding is `enabled = false`, and a division-following section renders only when the selected season has its section enabled.

- The legacy /wc archive remains separate under D-02. Home configuration omits a dedicated archive entry.
- The proposal's defaults apply: the news carousel is site-wide; dictators choose carousel items (editors do not); an empty carousel falls back to the latest 5 articles; a division-following section is hidden, not shown empty, when its gate is off.
