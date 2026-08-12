# Dependency license review

This review applies to the source-only `ddn-reference` snapshot selected by
`public-snapshot-manifest.json`. It is not approval to redistribute generated
application bundles, containers, native binaries or `node_modules` without a
new artifact-level license review.

## Evidence model

- npm production-license groups come from `pnpm licenses list --prod` against
  the committed lockfile.
- Cargo licenses come from locally available crate manifests. For target-
  specific sources absent from the local cache, exact name/version/license/
  checksum records are pinned in `dependency-license-evidence.json` from the
  official crates.io version API. The report generator rejects a checksum that
  does not match `Cargo.lock`.
- `forge-std` is vendored from commit
  `c179529c064588ede54a0661ec3cc98219460d07`; its MIT and Apache-2.0 license
  files remain in the vendored directory.

No Cargo package remains `UNRESOLVED` or `UNLICENSED`. SPDX alternatives such
as `MIT OR Apache-2.0`, `Apache-2.0 WITH LLVM-exception`, BSD, Zlib and
`Unlicense OR MIT` are compatible with distributing this Apache-2.0-licensed
source snapshot when their own notices and license texts remain available from
the dependency packages. This project does not relicense third-party code.

## caniuse-lite / CC-BY-4.0

Pinned package: `caniuse-lite@1.0.30001806`, reached through `next@16.3.0` in
the explorer and negotiation-reference applications. Its installed package
declares `CC-BY-4.0` and contains the Creative Commons Attribution 4.0 license.

The allowlisted source snapshot does not contain `node_modules`, copy the
caniuse dataset, or distribute a generated browser bundle. `caniuse-lite` is
therefore recorded as an install/build dependency, not relicensed or vendored
content. If a later release distributes generated assets containing that data,
the release owner must preserve appropriate credit, the CC-BY-4.0 license link
and change indication before shipping the artifact.

## sharp-libvips / LGPL-3.0-or-later

Pinned package in the audited Linux/arm64 install: `@img/sharp-libvips-linux-arm64@1.3.2`, an optional platform
package reached through `sharp@0.35.3` and `next@16.3.0`. It declares
`LGPL-3.0-or-later`; its README lists the bundled native libraries and their
individual licenses. The package contains a prebuilt dynamic library, but that
binary and all of `node_modules` are excluded from the source snapshot.

The dependency is acceptable for this source-only snapshot because no LGPL
binary is redistributed by it. A container, desktop bundle, prebuilt server or
other binary distribution that contains libvips remains **NO-GO** until an
artifact-specific review preserves the LGPL notices and satisfies the
corresponding-source and relinking requirements for the exact shipped binary.

## Release rule

Any lockfile change, newly unresolved license, missing attribution file,
vendored-source drift, or change from source-only distribution reopens this
review and blocks release.
