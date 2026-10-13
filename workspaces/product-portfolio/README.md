# Product Portfolio — Pyxis consumer

Read-only Pyxis inventory ingestion for RHDH 1.10.3 / Backstage 1.49.4. The
workspace contains four private packages and a local catalog backend harness:

- `product-portfolio-common`: neutral source identities, read envelopes and associations.
- `pyxis-common`: source projections, admission, roster and host-binding contracts.
- `pyxis-node`: verified mTLS transport, validated GraphQL reads, bounded pagination,
  normalization and the restricted inventory port.
- `catalog-backend-module-pyxis`: catalog provider, relationship processor, guarded
  reconciliation, scheduling and host OpenTelemetry instrumentation.

The module imports source listings and repositories as Resources, teams as Groups,
and member references as isolated Users in the `pyxis` namespace. Repository
ownership comes from one `team_id`. Only direct listing repository IDs establish
`pyxisHasRepository` / `pyxisRepositoryOf` relationships. This slice has no Product
System, image inventory, CHI evaluation, email, Konflux, frontend or MCP runtime.

Provider `vendorPolicy` defaults to `redhat-only`: only exact `redhat` records
qualify. Set `redhat-or-unlabeled` to also admit null or missing labels. Malformed
labels remain unresolved in both modes; other strings are excluded. A GraphQL
null still does **not** prove a stored explicit null. Switching back to strict
mode preserves already admitted unlabeled entities.
Required read failures prevent the entire source-instance mutation. Catalog
updates use deltas; scan absence and unpublished records never imply deletion.

## Development

Use Node 22 or 24 and repository Yarn 4.17.1. Target export and installation
acceptance use Node 24. Initial dependency versions and shared framework
resolutions are pinned; the lockfile is authoritative.

```sh
yarn install --immutable
yarn fix --check
yarn tsc:full
yarn lint:all --max-warnings 0
yarn prettier:check
yarn test:acceptance
yarn build:all
yarn build:api-reports:only --ci
```

`yarn start` starts the development catalog backend. No provider is registered
without configuration. Add a local `app-config.local.yaml` using the module's
[configuration example](plugins/catalog-backend-module-pyxis/app-config.dynamic.yaml).
The example uses environment variables for mounted mTLS paths, never secret values.
Root dependency installation is separate; workspace postinstall only invokes it
when explicitly requested through `PYXIS_INSTALL_REPOSITORY_ROOT=true`.

## Verification and delivery

- [Test harness and required acceptance gates](docs/testing.md)
- [Configuration, identity and operational runbook](docs/operations.md)
- [Dynamic OCI export, exact-host smoke and DevHub handoff](docs/delivery.md)
- [Public ports and later consumer contracts](docs/contracts.md)

Unit, transport, real TLS and real catalog tests are runnable locally. Database
acceptance also requires PostgreSQL 16; exact-host installation requires the
approved host image digest and registry artifacts. A successful local suite or
export does not replace `verify:release`. That command rejects missing, skipped,
failed or stale required evidence. OCI packaging never pushes an image.

Inherited [CODEOWNERS](../../.github/CODEOWNERS) and repository
[contribution guidance](../../CONTRIBUTING.md) continue to apply. Packages remain
private and Changesets versions them for OCI delivery; npm publication is disabled.
