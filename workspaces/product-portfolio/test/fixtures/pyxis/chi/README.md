# Repository CHI fixtures

These synthetic fixtures model the minimal repository context, repository-image
candidate, and selected-image projections from Pyxis commit
`6b76c6886d9fed016117b9634c7caef9014ce2cc`. They are not production captures
and contain no source credentials or user data.

The fixed observation clock is `2026-10-13T12:00:00.000Z`. Candidate selection
is deliberately separate from winner grade periods. Counts use unique winning
image IDs, while stream slots preserve each winning stream/architecture
membership. Candidate traversal is ascending `_id` keyset pagination and grade
quality never influences which image wins.
