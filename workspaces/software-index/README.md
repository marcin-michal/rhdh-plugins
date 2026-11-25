# Software Index

Software Index helps product, program management, and engineering teams find
owners and track container health for Red Hat products and repositories. It
reads inventory from Pyxis and targets RHDH 1.10.3 / Backstage 1.49.4. The
workspace contains five private plugin packages and a local frontend/backend app.

- `software-index` provides paginated catalog browsing, entity details and
  repository grade views for both classic and new Backstage frontend systems.
- `software-index-common` defines neutral source identities, read envelopes
  and associations.
- `pyxis-common` defines source projections, admission, roster, host-binding
  and repository CHI snapshot contracts.
- `pyxis-node` handles verified mTLS transport, validated GraphQL reads, bounded
  pagination, normalization, latest-image CHI selection and restricted read ports.
- `catalog-backend-module-pyxis` provides catalog ingestion, relationship
  processing, guarded reconciliation, cache-backed CHI enrichment, scheduling
  and host OpenTelemetry instrumentation.

The module imports source listings and repositories as Resources, teams as Groups,
and member references as isolated Users in the `pyxis` namespace. Repository
ownership comes from one `team_id`. Only direct listing repository IDs establish
`pyxisHasRepository` / `pyxisRepositoryOf` relationships. When CHI is enabled,
repository Resources include bounded `spec.pyxisChi` snapshots of the latest
published image per stream and architecture. Single-stream repositories without
stream tags use `latest`. Configure expected architectures to track their coverage.

Provider `vendorPolicy` defaults to `redhat-only`: only exact `redhat` records
qualify. Set `redhat-or-unlabeled` to also admit null or missing labels. Malformed
labels remain unresolved in both modes; other strings are excluded. A GraphQL
null still does **not** prove a stored explicit null. Switching back to strict
mode preserves already admitted unlabeled entities.

Required read failures prevent catalog mutations for the source instance.
Successful scans apply deltas and retain previously imported records when the
only change is scan absence or unpublished status. Deletion based on absence
requires a confirmed internal 404 with `absenceDeletion: confirmed-internal-404`
and `internalNotFoundValidated: true`.

## Development

Use Node 22 or 24 and repository Yarn 4.18.1. Target export and installation
acceptance use Node 24. Install dependencies from the workspace root.

```sh
YARN_ENABLE_SCRIPTS=false yarn install --immutable
```

If the SQLite native binding is missing, run `yarn rebuild better-sqlite3`
before starting the backend or running catalog tests.

Run the workspace checks from the same directory.

```sh
yarn fix --check
yarn tsc:full
yarn lint:all --max-warnings 0
yarn prettier:check
yarn test:acceptance
yarn build:all
yarn build:api-reports:only --ci
```

`yarn start` starts the live frontend and catalog/auth backend. Use
`yarn start:demo` for an explicitly labeled, frontend-only fixture demo. See the
[frontend development guide](plugins/software-index/README.md#local-development).

Root dependency installation is separate; workspace postinstall only invokes it
when explicitly requested through `PYXIS_INSTALL_REPOSITORY_ROOT=true`.

### Live Pyxis credentials

Copy the [configuration example](plugins/catalog-backend-module-pyxis/app-config.dynamic.yaml)
to the git-ignored `app-config.local.yaml`. Use the same source instance ID under
`pyxis.sources` and `catalog.providers.pyxis`. Set these variables in the backend
environment before running `yarn start`.

- `PYXIS_GRAPHQL_ENDPOINT` is the Pyxis GraphQL HTTPS URL.
- `PYXIS_CERTIFICATE_FILE` and `PYXIS_KEY_FILE` are the paths to the mounted
  client certificate and private key PEM files.
- `PYXIS_KEY_PASSPHRASE` supplies the secret passphrase for an encrypted private
  key through `pyxis.sources.<sourceInstance>.keyPassphrase`. Leave the variable
  unset for an unencrypted key.
- `PYXIS_CA_FILE` is the optional path to a custom CA bundle. Leave it unset to
  use the backend's default TLS trust store.

The catalog module reports `pyxis-invalid-tls-material` at startup if the
passphrase for an encrypted key is missing or incorrect.

### Catalog identity during upgrades

Keep the deployed Pyxis instance ID in both configuration sections. The example
uses `internal`, which produces the provider ID `pyxis-provider:internal`.
A repository has a catalog reference of the form `resource:pyxis/r-<hash>`. The
entity naming function hashes the instance ID, source kind, and Pyxis record ID.
The Software Index route and frontend OCI image name can change while those
references stay valid. Changing the instance ID gives the same repository a new
reference and requires reconciling existing catalog records and links.

## Verification and delivery

- [Release job for dynamic export, OCI packaging and RHDH installation](plugins/software-index/README.md#release-job)
- [Inventory fixtures](test/fixtures/pyxis/README.md) and [CHI fixtures](test/fixtures/pyxis/chi/README.md)
- [Pyxis read ports](plugins/pyxis-node/src/ports.ts)

`yarn test:acceptance` runs local unit, transport, TLS and catalog tests.
`yarn test:db` requires PostgreSQL 16 in addition to SQLite. Installation smoke
tests require the approved RHDH host image digest and registry artifacts.
`yarn verify:release` requires passing, current evidence for all release checks.
OCI packaging builds local images for separate registry promotion.

Maintainers are listed in [CODEOWNERS](../../.github/CODEOWNERS). Changesets
versions the private packages for OCI delivery. npm publication is disabled.
