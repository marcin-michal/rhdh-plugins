# Product Portfolio

Catalog-native frontend for Backstage 1.49.4 / RHDH 1.10.3. Load the default
`/alpha` export in the new frontend system. The dedicated route is
`/product-portfolio`; entity navigation uses the standard catalog routes.

The host must run `app-next` with `ENABLE_STANDARD_MODULE_FEDERATION=true`.
Merge `app-config.yaml` to exclude Catalog Overview from managed Pyxis entities.
Other installed unconditional entity tabs need the equivalent host predicate.

Accepts `spec.pyxis` version 1 and `spec.pyxisChi` schema 2. Images mean the
latest selected image per configured stream and architecture, not full history.
All browser reads use the catalog API and its permissions. Source credentials
belong exclusively in backend configuration.

Release acceptance and immutable OCI installation evidence are required before
handoff. NFS is Developer Preview in the target RHDH release.

## Local development

From the workspace root, install with `YARN_ENABLE_SCRIPTS=false yarn install --immutable`.

- `yarn start` starts the frontend (port 3000) and catalog/auth backend (port 7007).
  Open `http://localhost:3000/product-portfolio`. Development guest sign-in issues
  a real Backstage token; the built-in Catalog API queries the backend.
- `yarn workspace app start` starts only the frontend when your backend is already running.
- `yarn start:demo` starts only the frontend with synthetic data and a visible
  demo notice. It deliberately omits `app-config.local.yaml`, makes no backend
  requests, and does not need source credentials. Add `?fixtureCount=10000` on
  initial load to exercise the large fixture set.

For live data, keep the Pyxis source and provider configuration in
`app-config.local.yaml`, following the
[backend example](../catalog-backend-module-pyxis/app-config.dynamic.yaml).
The certificate, key and CA paths are read only by the backend. Inventory appears
once the provider has completed a scan and catalog processing has finished.
Without a configured provider the catalog is empty; errors never trigger a mock
fallback. Enable provider `chi.enabled` if you also want live container-health
collection. Source publication state, suppression and vendor policy can affect
which records or health evidence are available, independently of authentication.

The local backend binds to loopback and enables the development guest provider.
Keep `backend.auth.dangerouslyDisableDefaultAuthPolicy` absent or `false` in local
configuration; it is not needed for development. If you previously accepted a
legacy guest-token fallback in this browser, clear that choice and sign in again
with the backend running. Real hosts retain their own authentication providers.
The development app and its demo configuration are excluded from release artifacts.

Run the scoped frontend tests with:

```sh
yarn workspace @red-hat-developer-hub/backstage-plugin-product-portfolio test --runInBand --watch=false
```

Playwright and automated browser accessibility checks are deferred by user
request. No Playwright installation or browser download is required.

## Release job

Run this job from the workspace root on Node 24, with an additional Node 22
unit/component/typecheck CI lane. Preserve logs as build artifacts.

1. Install with scripts disabled and `--immutable`; run `yarn dedupe --check`,
   `yarn fix --check`, `yarn tsc:full`, `yarn lint:all --max-warnings 0`,
   `yarn prettier:check`, `yarn build:all`, and
   `yarn build:api-reports:only --ci`.
2. Run `yarn test:acceptance` and the existing database acceptance job.
3. Run `yarn export-dynamic`, `yarn test:export`, and
   `yarn test:export:frontend`. The CLI is pinned at 1.10.8. Frontend common
   runtime code is bundled; the type-only portfolio common library erases.
   Frontend exports include Module Federation `./alpha` and the installation
   fragment; no legacy mount configuration is supplied.
4. Set distinct `PYXIS_OCI_TAG` and `PRODUCT_PORTFOLIO_FRONTEND_OCI_TAG` values
   and the approved shared `PYXIS_TARGET_PLATFORM`; run `yarn package:oci`.
   This creates two local images and `release-evidence/release-pair.json`.
   Nothing is pushed. Record the package paths from each image's actual
   `io.backstage.dynamic-packages` metadata, not from naming assumptions.
5. Have the release operator promote the verified pair and record the
   registry-confirmed platform manifest digests. Never substitute an index
   digest or a mutable tag for an installed platform digest. Store
   `release-evidence/registry-pair.json` with `sourceHash`, `platform`, and
   `backend`/`frontend` objects containing `confirmed: true`, `ref`,
   `platformDigest`, `packagePath`, and optional `indexDigest`. The release
   gate compares these with the built images and actually installed refs.
6. On the approved isolated RHDH 1.10.3 host, supply the current/previous
   backend and frontend immutable refs (including `!package-path`), approved
   image digest, platform, config path, and installer/start argument arrays.
   `scripts/smoke-rhdh.mjs` retains the backend baseline, upgrade, restart,
   pause, failed-fetch preservation, and rollback checks and installs the
   paired frontend in `app-next` with standard Module Federation.
7. Record the manual frontend acceptance in
   `release-evidence/frontend-host-manual.json`: `sourceHash`, `image`,
   `frontend`, `backend`, `passed`, `entityContentInventory` (all installed
   entity-content IDs and predicates), and boolean `checks` for `entity-links`,
   `pagination`, `team-user-data`, `tab-inventory`, `overview-exclusion`,
   `restart`, `upgrade`, and `rollback`. Record only checks actually observed.
   `yarn verify:release` rejects absent or stale evidence.

Operator inputs are intentionally not defaulted. Without registry and host
access, local implementation can be evaluated but a release cannot be accepted.

Upgrade backend first and wait for catalog processing, then frontend. Roll
back to the previous tested frontend pair/config, followed by its backend if
contracts changed; rerun smoke checks. Do not delete provider-owned catalog
entities during rollback. Frontend accepts projection v1 and CHI schema 2.
