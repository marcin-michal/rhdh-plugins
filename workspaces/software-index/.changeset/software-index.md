---
'@red-hat-developer-hub/backstage-plugin-software-index': minor
'@red-hat-developer-hub/backstage-plugin-software-index-common': minor
'@red-hat-developer-hub/backstage-plugin-pyxis-common': minor
'@red-hat-developer-hub/backstage-plugin-pyxis-node': minor
'@red-hat-developer-hub/backstage-plugin-catalog-backend-module-pyxis': minor
---

Introduce Software Index for RHDH 1.10.3 and Backstage 1.49.4. Browse Pyxis
product listings, repositories, teams, and container health grades at
`/software-index` in both the classic and new frontend systems. The local
app uses the catalog and guest sign-in by default and offers a separate
fixture demo.

Import Pyxis inventory through read-only GraphQL over mTLS using stable catalog
identities and guarded reconciliation. Add shared source and projection
contracts and cache-backed repository health snapshots for the latest published
image per stream and architecture, including tags, digests, and publication dates.
