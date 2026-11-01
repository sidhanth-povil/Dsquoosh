# Security policy

## Supported versions

Only the **latest release** is supported. Sites update to it automatically
(see [Automatic updates](./readme.md#-automatic-updates)), so fixes ship as a
new release rather than as patches to older versions.

## Reporting a vulnerability

Please **do not open a public issue.** Report it privately instead:
**[Security → Report a vulnerability](https://github.com/sidhanth-povil/Dsquoosh/security/advisories/new)**.

Include the affected version, steps to reproduce, and what an attacker gains.
You'll get a reply as soon as possible, and credit in the release notes if you
want it.

## What's in scope

- The plugin in [`ds-webp-squoosh/`](./ds-webp-squoosh): the vault AJAX
  endpoint, attachment meta, the admin UI, and the self-updater.
- The release pipeline ([`.github/workflows/release.yml`](./.github/workflows/release.yml)),
  because every release installs itself on every site.

The [`dev/`](./dev) harness is local-only test tooling with throwaway
credentials. It is out of scope unless it affects the shipped plugin.

## How releases are protected

- `main` only changes through pull requests; force-pushes and deletion are blocked.
- Only repository admins can create, move or delete `v*` release tags.
- The updater only installs a `ds-webp-squoosh.zip` attached to a release of
  this repository, over HTTPS.
- The release workflow is pinned to commit SHAs and refuses to build when the
  tag and the plugin version disagree.
- Secret scanning and push protection are on.
