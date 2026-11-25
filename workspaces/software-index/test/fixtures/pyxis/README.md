# Fixture provenance

Synthetic, deterministic projection fixtures; not production captures.

- Source commit: `6b76c6886d9fed016117b9634c7caef9014ce2cc` of Pyxis.
- Schema paths: `schema/schema/{product_listing,container_repository,container_team}`; GraphQL envelope/pagination from `docs/common/graphql-user-guide.md`.
- Seed: fixed IDs 1/2/3 prefixes, fixed 2026-01-01 source update, 2025-01-01 membership dates.
- Assumes internal viewer access; no source credentials, personal profiles or actual employee IDs.
- Deliberate alterations in tests cover vendor ambiguity, malformed records/rosters, deleted listings, opaque owners, pagination changes and synthetic transport errors.
- Baseline: two listings, three repositories (including an unlisted repository), two teams and two source Users; three direct listing edges.
- Stored-null evidence is an authoritative domain fixture only; GraphQL wire null never proves it.
- TLS certificates are generated in temporary directories at test time and never packaged.
