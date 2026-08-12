# SPDX-License-Identifier: Apache-2.0
# Runtime image for Milestone 3 hardening's two-clean-environment replay
# proof (scripts/validator-replay-two-environments.sh). Builds the
# ddn-validator CLI once; two separate `docker run` containers from the
# resulting image then play the roles of Environment A (executes and
# signs) and Environment B (replay-verifies only -- no private key, no
# shared filesystem state with A).
#
# This is NOT a reproducible-build check itself (that's Milestone 2's
# infra/docker/policy-builder-{a,b}.Dockerfile / scripts/policy-
# reproducibility.sh) -- it only needs a working Rust toolchain to build
# the validator binary. Reuses the same pinned compiler image as those
# Dockerfiles purely for supply-chain consistency (one already-vetted
# digest, not a second one to track).
FROM rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35 AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY packages/canonical-json/rust packages/canonical-json/rust
COPY packages/crypto/rust packages/crypto/rust
COPY policies/negotiation-v1 policies/negotiation-v1
COPY apps/validator apps/validator
RUN cargo build --release --locked -p ddn-validator

# Alpine (not Debian): the builder stage's rustc/cargo are already
# Alpine/musl-native here, so the compiled ddn-validator binary is a
# normal musl-dynamic binary that runs unmodified under a matching Alpine
# base -- no cross-userland loader/libgcc_s ceremony needed (that ceremony
# in policy-builder-a.Dockerfile exists only because it deliberately runs
# an Alpine-built compiler under a *Debian/glibc* userland; this image
# doesn't cross that boundary).
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
COPY --from=builder /build/target/release/ddn-validator /usr/local/bin/ddn-validator
WORKDIR /work
ENTRYPOINT ["ddn-validator"]
