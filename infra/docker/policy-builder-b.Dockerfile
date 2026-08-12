# SPDX-License-Identifier: Apache-2.0
# Reproducible-build check, builder B: Alpine (musl) userland — the native
# home of the pinned compiler artifact. See policy-builder-a.Dockerfile for
# the full rationale, the pinned-digest source, and the WORKDIR constraint
# (must match exactly).
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

# Same pinned digest as builder A: byte-identical rustc/cargo binaries,
# already native to this userland (no loader/libgcc shimming needed here).
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /usr/local/rustup /usr/local/rustup
COPY --from=rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 /usr/local/cargo /usr/local/cargo

RUN apk add --no-cache musl-dev gcc

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
