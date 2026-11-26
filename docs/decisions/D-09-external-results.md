# D-09 · Partner fixtures and results feed

The owner chose partner keys only. A dictator can issue and revoke an individual key for a named consumer. Every key reads the same dataset. Authorization applies to every request, including cache hits and conditional responses.

The read-only v1 contract includes divisions, seasons, fixtures, results and standings for visible public seasons, including historical ones. Hidden or archived divisions and seasons are excluded. Individual match events, player names and account data are outside v1. Use stable public IDs and timezone-aware ISO timestamps. Consumer requests receive per-key rate limiting with 429 and Retry-After. Document shorter freshness for live results, conditional requests and operational limits with the implementation.

Publish a new version for breaking changes and keep a deprecated version available for six months. That window carries forward the default in the [proposal](D-09-external-results-proposal.md). [SL-063](../../backlog/items/SL-063.md) defines the partner and dictator acceptance scenarios.
