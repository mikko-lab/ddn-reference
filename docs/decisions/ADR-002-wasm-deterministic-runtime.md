# ADR-002: WASM deterministic runtime

## Status

Accepted

## Context

DDN's core claim depends on multiple separately instantiated validators executing the
*same* policy against the *same* input and reaching the *same* output.
Ordinary native code execution is not a safe basis for this: floating-point
behavior, memory layout, syscalls, threading, and the host OS/CPU can all
introduce non-determinism between operators running on different
infrastructure. This ADR treats deterministic WebAssembly as a bounded,
repeatable execution environment and one of DDN's load-bearing building
blocks.

## Decision

Every policy runs inside a sandboxed, deterministic WASM runtime
(Wasmtime), never as native code. The runtime is pinned to an exact
version and configured with fuel-based interruption, a fixed fuel limit, no
WASI, no network access, no filesystem access, no environment variables, no
system clock, no RNG, no threads, and explicit memory/output size limits.
Policies may only use integers, booleans, UTF-8 strings, bounded lists, and
bounded maps in their first version — no IEEE floats in money or
consensus-affecting calculations.

## Consequences

- Every validator's execution environment must conform to the same
  `ExecutionProfile`; the profile itself is hashed and becomes part
  of `executionHash`, so a mismatched runtime configuration is detectable,
  not just assumed away.
- Policies are written against a deliberately restricted capability set —
  this rules out entire classes of policy bugs (no I/O, no clock, no RNG)
  at the runtime level, not just by convention.
- Determinism testing becomes a first-class, repeated CI activity:
  the same test vector must produce identical output across processes,
  containers, and CPU architectures.
