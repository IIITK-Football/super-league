# D-07 proposal: home video chapters, rotation, mobile and resume

Status: **proposal, open**. Blocks SL-060 (the first configurable version) and SL-093 (the redesign). Media comes from the Phase 3 storage system (SL-071, SL-073). Drafted 2026-11-18.

## 1. Current state
- **Hard-coded media.** `frontend/src/pages/LeagueLanding.jsx` hard-codes the production R2 host, 9 poster URLs, 3 clips per division, the division list, copy and colours, and a fixed interleaved clip order.
- **Separate HLS manifests.** Each clip has its own manifest behind `/api/media/<name>/master.m3u8`. `backend/app/api/media/[...path]/route.ts` repeats the host and an allow-list of the 9 stream names.
- **Player behaviour.**
  - Two persistent hls.js slots.
  - The first clip is forced to the highest quality.
  - Playback advances when a clip ends.
  - Arrow keys, Enter and swipe work, there is a pause control, and the poster shows on error.
- **Mobile and reduced motion.** On mobile the card is a 9:16 `object-fit: cover` crop. Reduced motion only disables CSS animation; the video still autoplays.
- **Unused section type.** `section_types` has an unused `video` row ("Season video chapter on the home page").

## 2. Options
| | A. `home_videos` + chapter tables (recommended) | B. `season_sections('video').settings` JSON | C. Keep in code |
|---|---|---|---|
| Ordering and overlap checks | constraints | hand-checked JSON | n/a |
| One long video across divisions | natural | awkward | no |
| Works with today's 9 clips | yes (per-chapter media) | yes | yes |
| Audit (SL-027) | add triggers | already audited | no |

## 3. Recommendation (A)
```
home_videos(id, title, manifest_key NULL, poster_key, portrait_manifest_key NULL, captions_key NULL,
  duration_seconds, status draft|published, is_active  -- one active (partial unique), updated_at, updated_by)
home_video_chapters(id, video_id, season_id, sort_order, start_seconds, end_seconds NULL,
  media_key NULL  -- per-chapter manifest override, poster_key, entry_points_seconds numeric[], label NULL,
  UNIQUE (video_id, sort_order))
```
- **Storage:** the tables store object keys, never URLs. The Worker turns keys into URLs through the storage abstraction.
- **Validation:** `start < end`; no overlap on a shared manifest; entry points within `[start, end − 5 s]`; the season must be visible.
- **Housekeeping:** retire the `video` section type in SL-040. Audit both tables.

**Rotation:**
- Chapter order is the dictator's `sort_order`. The current season of the first visible division is the lead chapter.
- Each new session starts the lead chapter at the next `entry_points_seconds` value, round-robin from a counter in `localStorage`, so it is deterministic and testable. Later chapters start at `start_seconds`.
- At a chapter's end, playback advances and wraps after the last chapter.

**Resume:**
- "Resume" is a per-chapter position kept in `sessionStorage` for the current tab.
- Switching division saves the current chapter's time; coming back resumes there, unless within 3 s of the end.
- Returning to `/` in the same session restores the last chapter.
- A new session gets the rotated lead chapter.
- Selecting a division on the home page does not change the site-wide division until the visitor enters it.

**Mobile:**
- Muted, `playsinline` autoplay, paused when off-screen or when the tab is hidden.
- Never crop faces: use the portrait manifest when configured, otherwise show the landscape video letterboxed over a blurred poster.
- Automatic quality on narrow or Save-Data connections.
- Reduced motion or Save-Data: the poster and a play button only.

**SL-060 (minimal):**
- One video. Each of today's clips becomes a chapter with its own `media_key`, so nothing is re-encoded and existing media is kept.
- A dashboard form sets chapter order, season, poster and entry points, with its states.
- `LeagueLanding` reads `/api/home/video`, and the hard-coded constants and allow-list go.

**SL-093 (redesign):**
- One long manifest with time-range chapters in a single retained player.
- Division rail, parallax, captions, and a portrait rendition.

## 4. Questions for the owner
1. Chapters per season, not per division? **Default: yes.** Older seasons appear only if added.
2. Rotate start points round-robin per browser, not at random? **Default: round-robin.**
3. Keep resume for the tab session only? **Default: yes.**
4. On mobile, use a portrait encode when available and letterbox otherwise, never cropping? **Default: yes.**
5. Show reduced-motion visitors the poster only, with no autoplay? **Default: yes.**
6. Should selecting a division on the home page change the site-wide division? **Default: no,** only entering it does.
