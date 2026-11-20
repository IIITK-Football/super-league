# D-07 decision: home video chapters, rotation, mobile and resume

Resolved by the owner on 2026-11-20. Applies to SL-060 and SL-093. Option A of `D-07-home-video-proposal.md` (`home_videos` and `home_video_chapters` tables that store object keys, never URLs), with these answers to its questions:
1. Chapters belong to seasons, not divisions; older seasons appear only if added.
2. The lead chapter's start point rotates round-robin per browser (a counter in `localStorage`), not at random.
3. Resume is per chapter and lasts for the tab session only (`sessionStorage`).
4. Mobile uses a portrait rendition when one is configured and otherwise letterboxes over a blurred poster, never cropping faces.
5. Reduced-motion and Save-Data visitors see the poster and a play button, with no autoplay.
6. Selecting a division on the home page does not change the site-wide division until the visitor enters it.

SL-060 delivers the minimal version (each current clip becomes a chapter with its own `media_key`, nothing re-encoded); SL-093 redesigns it in Phase 9.
