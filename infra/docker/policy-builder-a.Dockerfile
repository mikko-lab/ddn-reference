# SPDX-License-Identifier: Apache-2.0
# Reproducible-build check, builder A: Debian (glibc) userland.
# Builder B (policy-builder-b.Dockerfile) uses an Alpine (musl) userland.
# Both COPY the *exact same* rustc/cargo binaries (pinned by digest, below)
# from the official musl-hosted Rust image, so the compiler's own identity
# (rustc -vV's `host:` field) is byte-identical between builders. Only the
# surrounding OS/userland differs. See docs/reproducible-builds.md for why
# this replaces an earlier design that varied the compiler's host build too.
#
# Why musl-hosted (not glibc-hosted) as the pinned compiler:
# running a musl-built binary under a glibc userland only needs musl's own
# small, self-contained dynamic loader plus libgcc_s, placed at the exact
# paths the binaries' own ELF headers already request (see below) — no
# wrapper scripts needed. The reverse (running a glibc-built rustc under
# Alpine) needs a full glibc compatibility layer; `gcompat` is missing
# symbols rustc/cargo require (e.g. `__res_init`), and the only alternative
# glibc package for Alpine has no aarch64 build. The musl-hosted direction
# is the one that is actually portable across both amd64 (CI) and arm64
# (local Apple Silicon dev machines).
#
# We tried Debian's own `musl` + `libgcc-s1` apt packages instead of copying
# these two files from the pinned image. The musl loader itself was fine,
# but Debian's libgcc-s1 build is a different libgcc than the one the
# Alpine/musl rustc was linked against: it's missing `_dl_find_object`,
# which rustc_driver.so needs, and fails at load time. Confirmed by testing,
# not assumed — so both files come from the same pinned digest as the
# compiler itself, which is also the stronger reproducibility property
# (everything compiler-adjacent traces to one source instead of two).
#
# WORKDIR must match policy-builder-b.Dockerfile exactly: `file!()` in Rust
# panic messages embeds the compile-time source path, and it must be
# byte-identical between builders for the outputs to match.
FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

# ca-certificates: needed for cargo's TLS connection to crates.io.
# musl-tools: build scripts (proc-macro2, serde, ...) are compiled for
# rustc's own HOST target, which is aarch64-unknown-linux-musl (rustc's own
# identity, same as the pinned compiler) regardless of this container's
# Debian/glibc userland — so linking them needs a musl-targeting linker,
# not Debian's native glibc gcc. Neither package is compiler-adjacent in the
# sense of docs/reproducible-builds.md: they only affect how incidental
# host-side build-script helper binaries get linked, not the wasm32-target
# crates' own compiled bytes or Cargo's per-crate metadata hash (verified:
# that hash is a function of rustc's own -vV identity + package identity,
# not of which linker built some other, host-target unit).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates musl-tools \
    && rm -rf /var/lib/apt/lists/*
ENV CC_aarch64_unknown_linux_musl=musl-gcc
ENV CC_x86_64_unknown_linux_musl=musl-gcc
# CC_<triple> only affects the `cc` crate (used by some build.rs scripts to
# compile C code); it does not change rustc's own linker choice for the
# final link step. That's a separate setting.
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc

# Pinned by digest: rust:1.94.1-alpine3.20 (multi-arch image index; resolves
# to the correct amd64/arm64 sub-image automatically). This is the single
# canonical compiler artifact both builders use.
#
# rustc/cargo/rustup under /usr/local/cargo/bin are statically linked musl
# binaries (verified: `ldd` reports "Not a valid dynamic program", i.e. no
# dynamic dependencies at all) — they run under any userland unmodified. The
# real per-toolchain binaries under /usr/local/rustup/toolchains/<host>/bin
# are musl-dynamic and declare `PT_INTERP /lib/ld-musl-<arch>.so.1` (checked
# with `readelf -l`); placing the matching loader and libgcc_s.so.1 at that
# exact path is enough for the kernel to resolve them on normal exec, with
# no wrapper scripts or explicit loader invocation required.
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /usr/local/rustup /usr/local/rustup
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /usr/local/cargo /usr/local/cargo
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /lib/ld-musl-*.so.1 /lib/

# libgcc_s.so.1's own DT_NEEDED entry is not "libc.so" but a versioned
# SONAME, libc.musl-<arch>.so.1 (confirmed with readelf -d on the pinned
# source image) — a symlink to the loader binary itself, since musl's
# loader doubles as libc. We only copied the loader under its own filename
# above, not this alias, so it was missing entirely. On arm64 this only
# produced a link-time warning and happened to still run (some fallback in
# musl's loader tolerates it); on amd64, identically missing, it is a
# runtime SIGSEGV in any binary that actually calls into libgcc_s — this
# is what crashed cargo's own build-script-build binaries (proc-macro2
# first, by scheduling, not because it's special) in CI on real amd64
# hardware. Recreated explicitly (rather than relying on COPY to preserve
# a symlink across build stages) so it's correct regardless of BuildKit's
# COPY symlink semantics; verified after the fact with
# `/lib/ld-musl-*.so.1 --list`, not assumed.
RUN ln -sfn "$(basename /lib/ld-musl-*.so.1)" "/lib/libc.musl-$(basename /lib/ld-musl-*.so.1 | sed -E 's/^ld-musl-(.*)\.so\.1$/\1/').so.1"

# libgcc_s.so.1 (runtime, needed by the toolchain's musl-dynamic binaries)
# and libgcc_s.so (a tiny GNU ld script — `GROUP ( libgcc_s.so.1 -lgcc )`,
# not a real library — needed so `-lgcc_s` resolves when rustc links
# build-script/proc-macro cdylibs for the musl host target) both go into
# musl-tools' own per-arch directory (/usr/lib/<triple>-linux-musl/,
# already created by the apt install above), not plain /usr/lib. Confirmed
# by testing, not assumed: musl-gcc's own specs restrict its *link-time*
# search to exactly this directory plus its own gcc dir — deliberately
# excluding plain /usr/lib so it can't accidentally pick up a glibc library
# — so placing our copy in plain /usr/lib is invisible to it. `-lgcc` and
# `-lc` already resolve via musl-tools' own bundled musl runtime in that
# same directory (confirmed: crti.o and -lc resolved fine on their own;
# only libgcc_s.so.1 didn't, because Alpine's rustc/cargo were the only
# source for that file).
RUN MUSLDIR=$(ls -d /usr/lib/*-linux-musl) && echo "$MUSLDIR" > /tmp/musldir
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /usr/lib/libgcc_s.so.1 /tmp/libgcc_s.so.1
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /usr/lib/libgcc_s.so /tmp/libgcc_s.so
RUN MUSLDIR=$(cat /tmp/musldir) \
    && cp /tmp/libgcc_s.so.1 "$MUSLDIR/libgcc_s.so.1" \
    && cp /tmp/libgcc_s.so "$MUSLDIR/libgcc_s.so"

# Same reasoning as the link-time fix above, for the *runtime* loader:
# without Debian's own `musl` apt package (deliberately not used — see the
# libgcc-s1 note above), there is no /etc/ld-musl-<arch>.path file, and
# musl's loader has no built-in default search path at all — it only
# searches DT_RPATH ($ORIGIN/../lib, which doesn't contain libgcc_s.so.1),
# LD_LIBRARY_PATH, and whatever this config file lists. Confirmed by
# testing, not assumed: cargo fails to load libgcc_s.so.1 without this file
# present, and succeeds once it points at the directory holding it — this is
# musl's own proper mechanism for the loader's search path, so it's what we
# install rather than setting LD_LIBRARY_PATH (which would paper over the
# missing config rather than fix it). Pointed at the same musl-tools
# directory as the link-time fix above, rather than a second location.
RUN cat /tmp/musldir > "/etc/ld-musl-$(basename /lib/ld-musl-*.so.1 | sed -E 's/^ld-musl-(.*)\.so\.1$/\1/').path"

ENV PATH=/usr/local/cargo/bin:$PATH
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV CARGO_INCREMENTAL=0
WORKDIR /build

RUN rustup target add wasm32-unknown-unknown

COPY Cargo.toml Cargo.lock ./
COPY packages/canonical-json/rust packages/canonical-json/rust
COPY packages/crypto/rust packages/crypto/rust
COPY policies/negotiation-v1 policies/negotiation-v1
COPY apps/validator apps/validator

RUN cargo build --locked --release --target wasm32-unknown-unknown -p ddn-negotiation-v1

CMD ["sha256sum", "target/wasm32-unknown-unknown/release/ddn_negotiation_v1.wasm"]
