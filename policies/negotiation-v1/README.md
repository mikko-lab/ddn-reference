# negotiation-v1

DDN's first policy: a deterministic ACCEPT/COUNTER/REJECT/ESCALATE decision
over a synthetic vehicle-sale negotiation, used to prove out DDN's
canonical-data, crypto, and deterministic-execution core (Milestone 1-2).

**Policy on tekninen testipolicy, eikä se sisällä tuotannon
jälleenmyyjäkohtaisia hinnoittelusääntöjä.**

This is a technical demo/reference policy. It is **not** a production pricing
policy: it contains no real floor/target prices, reseller-specific data or
other content from a production sales system. Its test vectors
(`packages/test-vectors/vectors/negotiation-v1.json`)
are entirely synthetic/invented for this repository.

See `docs/negotiation-policy-v1.md` for the full rule table and rationale and
`docs/execution-profile-v1.md` for the constraints this policy must honor (no
clock, no randomness, no I/O, no floating point, no global mutable state).
