// SPDX-License-Identifier: Apache-2.0
//! `ddn-negotiation-v1`: a synthetic, technical demo negotiation policy for
//! DDN. This is **not** a production pricing policy — no
//! real floor/target prices, reseller data, or other production content
//! code or data from a production sales system is used here or in its test vectors.
//! See `docs/negotiation-policy-v1.md`.
//!
//! The policy is a pure function: no system clock, no randomness, no
//! network, no filesystem, no environment variables, no floating point, no
//! global mutable state, no locale-dependent logic. See
//! `docs/negotiation-policy-v1.md` and `docs/execution-profile-v1.md`.

use serde::{Deserialize, Serialize};
use std::fmt;

pub const PACKAGE_NAME: &str = "ddn-negotiation-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NegotiationDecision {
    #[serde(rename = "ACCEPT")]
    Accept,
    #[serde(rename = "COUNTER")]
    Counter,
    #[serde(rename = "REJECT")]
    Reject,
    #[serde(rename = "ESCALATE")]
    Escalate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NegotiationReasonCode {
    #[serde(rename = "OFFER_AT_OR_ABOVE_LIST")]
    OfferAtOrAboveList,
    #[serde(rename = "OFFER_AT_OR_ABOVE_FLOOR")]
    OfferAtOrAboveFloor,
    #[serde(rename = "OFFER_BELOW_FLOOR")]
    OfferBelowFloor,
    #[serde(rename = "FINAL_COUNTER_AVAILABLE")]
    FinalCounterAvailable,
    #[serde(rename = "OFFER_LIMIT_REACHED")]
    OfferLimitReached,
    #[serde(rename = "CONDITION_REPORT_NOT_ACKNOWLEDGED")]
    ConditionReportNotAcknowledged,
    #[serde(rename = "INVALID_PRICE_RELATION")]
    InvalidPriceRelation,
    #[serde(rename = "POLICY_NOT_EFFECTIVE")]
    PolicyNotEffective,
    #[serde(rename = "HUMAN_REVIEW_REQUIRED")]
    HumanReviewRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NegotiationInputV1 {
    pub schema_version: String,
    pub tenant_id: String,
    pub vehicle_id: String,
    pub session_id: String,
    pub list_price_cents: i64,
    pub floor_price_cents: i64,
    pub customer_offer_cents: i64,
    pub offer_number: i64,
    pub max_offers: i64,
    pub condition_report_acknowledged: bool,
    pub policy_effective_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NegotiationOutputV1 {
    pub schema_version: String,
    pub decision: NegotiationDecision,
    pub counter_offer_cents: Option<i64>,
    pub reason_codes: Vec<NegotiationReasonCode>,
    pub human_review_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    /// Reachable only via malformed/adversarial construction outside the
    /// schema-validated path; `evaluate` never returns this for any input
    /// reachable through `@ddn/schemas`' `validateNegotiationInputV1`.
    UnsupportedSchemaVersion(String),
}

impl fmt::Display for PolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PolicyError::UnsupportedSchemaVersion(v) => {
                write!(f, "unsupported schemaVersion: {v}")
            }
        }
    }
}

impl std::error::Error for PolicyError {}

const SUPPORTED_SCHEMA_VERSION: &str = "1.0.0";

/// Evaluates a negotiation decision. Pure and total over any
/// `NegotiationInputV1` with a supported `schemaVersion`: every branch below
/// is reachable and every input either matches rule A-F or falls through to
/// the last (F). See `docs/negotiation-policy-v1.md` for the rule table.
pub fn evaluate(input: &NegotiationInputV1) -> Result<NegotiationOutputV1, PolicyError> {
    if input.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(PolicyError::UnsupportedSchemaVersion(
            input.schema_version.clone(),
        ));
    }

    // Rule A: condition report not acknowledged.
    if !input.condition_report_acknowledged {
        return Ok(NegotiationOutputV1 {
            schema_version: SUPPORTED_SCHEMA_VERSION.to_string(),
            decision: NegotiationDecision::Escalate,
            counter_offer_cents: None,
            reason_codes: vec![
                NegotiationReasonCode::ConditionReportNotAcknowledged,
                NegotiationReasonCode::HumanReviewRequired,
            ],
            human_review_required: true,
        });
    }

    // Rule B: invalid price relation (defense-in-depth; schema validation
    // should already reject floorPriceCents > listPriceCents).
    if input.floor_price_cents > input.list_price_cents {
        return Ok(NegotiationOutputV1 {
            schema_version: SUPPORTED_SCHEMA_VERSION.to_string(),
            decision: NegotiationDecision::Escalate,
            counter_offer_cents: None,
            reason_codes: vec![
                NegotiationReasonCode::InvalidPriceRelation,
                NegotiationReasonCode::HumanReviewRequired,
            ],
            human_review_required: true,
        });
    }

    // Rule C: offer at or above list price.
    if input.customer_offer_cents >= input.list_price_cents {
        return Ok(NegotiationOutputV1 {
            schema_version: SUPPORTED_SCHEMA_VERSION.to_string(),
            decision: NegotiationDecision::Accept,
            counter_offer_cents: None,
            reason_codes: vec![NegotiationReasonCode::OfferAtOrAboveList],
            human_review_required: false,
        });
    }

    // Rule D: offer at or above floor price.
    if input.customer_offer_cents >= input.floor_price_cents {
        return Ok(NegotiationOutputV1 {
            schema_version: SUPPORTED_SCHEMA_VERSION.to_string(),
            decision: NegotiationDecision::Accept,
            counter_offer_cents: None,
            reason_codes: vec![NegotiationReasonCode::OfferAtOrAboveFloor],
            human_review_required: false,
        });
    }

    // Rule E: below floor, offers remain.
    if input.offer_number < input.max_offers {
        return Ok(NegotiationOutputV1 {
            schema_version: SUPPORTED_SCHEMA_VERSION.to_string(),
            decision: NegotiationDecision::Counter,
            counter_offer_cents: Some(input.floor_price_cents),
            reason_codes: vec![
                NegotiationReasonCode::OfferBelowFloor,
                NegotiationReasonCode::FinalCounterAvailable,
            ],
            human_review_required: false,
        });
    }

    // Rule F: below floor, no offers remain.
    Ok(NegotiationOutputV1 {
        schema_version: SUPPORTED_SCHEMA_VERSION.to_string(),
        decision: NegotiationDecision::Reject,
        counter_offer_cents: None,
        reason_codes: vec![
            NegotiationReasonCode::OfferBelowFloor,
            NegotiationReasonCode::OfferLimitReached,
        ],
        human_review_required: false,
    })
}

// ---------------------------------------------------------------------------
// WASM entrypoint. See docs/execution-profile-v1.md for the full ABI.
//
// A minimal byte-in/byte-out ABI, not wasm-bindgen or a component-model
// interface: the entrypoint takes ownership of an input buffer (UTF-8
// canonical JSON `NegotiationInputV1`) and returns a packed pointer+length
// pointing at a freshly allocated output buffer (UTF-8 canonical JSON,
// either a `NegotiationOutputV1` or a `{"error": {...}}` envelope — see
// `wasm_abi::run` below). Errors never panic/trap: the policy is expected to
// run inside a fuel-limited, WASI-disabled Wasmtime sandbox where a trap
// would surface as an opaque host-side failure instead of a deterministic,
// inspectable JSON error.
// ---------------------------------------------------------------------------
#[cfg(target_arch = "wasm32")]
mod wasm_abi {
    use super::*;
    use std::alloc::{Layout, alloc, dealloc};

    #[unsafe(no_mangle)]
    pub extern "C" fn ddn_alloc(len: usize) -> *mut u8 {
        if len == 0 {
            return std::ptr::null_mut();
        }
        let layout = Layout::from_size_align(len, 1).expect("valid layout");
        unsafe { alloc(layout) }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn ddn_dealloc(ptr: *mut u8, len: usize) {
        if ptr.is_null() || len == 0 {
            return;
        }
        let layout = Layout::from_size_align(len, 1).expect("valid layout");
        unsafe { dealloc(ptr, layout) }
    }

    /// Reads a UTF-8 canonical JSON `NegotiationInputV1` from
    /// `ptr`/`len`, evaluates it, and returns a packed
    /// `(output_ptr << 32) | output_len` pointing at a freshly `ddn_alloc`-ed
    /// UTF-8 canonical JSON output buffer.
    #[unsafe(no_mangle)]
    pub extern "C" fn ddn_evaluate(ptr: *mut u8, len: usize) -> u64 {
        let input_bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        let output_bytes = run(input_bytes);
        let out_len = output_bytes.len();
        let out_ptr = ddn_alloc(out_len);
        unsafe {
            std::ptr::copy_nonoverlapping(output_bytes.as_ptr(), out_ptr, out_len);
        }
        ((out_ptr as u64) << 32) | (out_len as u64)
    }

    fn run(input_bytes: &[u8]) -> Vec<u8> {
        let result: Result<Vec<u8>, String> = (|| {
            let input_text = std::str::from_utf8(input_bytes)
                .map_err(|e| format!("invalid UTF-8 input: {e}"))?;
            let (value, _) = ddn_canonical_json::parse_and_canonicalize(input_text)
                .map_err(|e| e.to_string())?;
            let input: NegotiationInputV1 = serde_json::from_value(value)
                .map_err(|e| format!("input does not match NegotiationInputV1: {e}"))?;
            let output = evaluate(&input).map_err(|e| e.to_string())?;
            let output_value = serde_json::to_value(&output).map_err(|e| e.to_string())?;
            let canonical =
                ddn_canonical_json::canonicalize(&output_value).map_err(|e| e.to_string())?;
            Ok(canonical.into_bytes())
        })();

        match result {
            Ok(bytes) => bytes,
            Err(message) => {
                let error_value = serde_json::json!({
                    "error": { "code": "POLICY_EXECUTION_ERROR", "message": message }
                });
                ddn_canonical_json::canonicalize(&error_value)
                    .expect("error envelope is always canonicalizable")
                    .into_bytes()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> NegotiationInputV1 {
        NegotiationInputV1 {
            schema_version: "1.0.0".to_string(),
            tenant_id: "tenant-synthetic-01".to_string(),
            vehicle_id: "vehicle-synthetic-01".to_string(),
            session_id: "session-synthetic-01".to_string(),
            list_price_cents: 2_500_000,
            floor_price_cents: 2_300_000,
            customer_offer_cents: 2_200_000,
            offer_number: 1,
            max_offers: 4,
            condition_report_acknowledged: true,
            policy_effective_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn scaffold_exports_its_own_package_name() {
        assert_eq!(PACKAGE_NAME, "ddn-negotiation-v1");
    }

    #[test]
    fn accepts_offer_at_list_price() {
        let mut input = base_input();
        input.customer_offer_cents = input.list_price_cents;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Accept);
        assert_eq!(output.counter_offer_cents, None);
        assert_eq!(
            output.reason_codes,
            vec![NegotiationReasonCode::OfferAtOrAboveList]
        );
    }

    #[test]
    fn accepts_offer_above_list_price() {
        let mut input = base_input();
        input.customer_offer_cents = input.list_price_cents + 1;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Accept);
        assert_eq!(
            output.reason_codes,
            vec![NegotiationReasonCode::OfferAtOrAboveList]
        );
    }

    #[test]
    fn accepts_offer_at_floor_price() {
        let mut input = base_input();
        input.customer_offer_cents = input.floor_price_cents;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Accept);
        assert_eq!(
            output.reason_codes,
            vec![NegotiationReasonCode::OfferAtOrAboveFloor]
        );
    }

    #[test]
    fn counters_one_cent_below_floor_with_offers_remaining() {
        let mut input = base_input();
        input.customer_offer_cents = input.floor_price_cents - 1;
        input.offer_number = 1;
        input.max_offers = 4;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Counter);
        assert_eq!(output.counter_offer_cents, Some(input.floor_price_cents));
        assert_eq!(
            output.reason_codes,
            vec![
                NegotiationReasonCode::OfferBelowFloor,
                NegotiationReasonCode::FinalCounterAvailable
            ]
        );
    }

    #[test]
    fn counters_on_third_of_four_offers() {
        let mut input = base_input();
        input.customer_offer_cents = input.floor_price_cents - 500;
        input.offer_number = 3;
        input.max_offers = 4;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Counter);
    }

    #[test]
    fn rejects_low_offer_on_final_round() {
        let mut input = base_input();
        input.customer_offer_cents = input.floor_price_cents - 100_000;
        input.offer_number = 4;
        input.max_offers = 4;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Reject);
        assert_eq!(output.counter_offer_cents, None);
        assert_eq!(
            output.reason_codes,
            vec![
                NegotiationReasonCode::OfferBelowFloor,
                NegotiationReasonCode::OfferLimitReached
            ]
        );
    }

    #[test]
    fn escalates_when_condition_report_not_acknowledged() {
        let mut input = base_input();
        input.condition_report_acknowledged = false;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Escalate);
        assert!(output.human_review_required);
        assert_eq!(
            output.reason_codes,
            vec![
                NegotiationReasonCode::ConditionReportNotAcknowledged,
                NegotiationReasonCode::HumanReviewRequired
            ]
        );
    }

    #[test]
    fn escalates_on_invalid_price_relation() {
        let mut input = base_input();
        input.floor_price_cents = input.list_price_cents + 1;
        let output = evaluate(&input).unwrap();
        assert_eq!(output.decision, NegotiationDecision::Escalate);
        assert!(output.human_review_required);
        assert_eq!(
            output.reason_codes,
            vec![
                NegotiationReasonCode::InvalidPriceRelation,
                NegotiationReasonCode::HumanReviewRequired
            ]
        );
    }

    #[test]
    fn condition_report_check_takes_priority_over_price_relation() {
        let mut input = base_input();
        input.condition_report_acknowledged = false;
        input.floor_price_cents = input.list_price_cents + 1;
        let output = evaluate(&input).unwrap();
        assert_eq!(
            output.reason_codes,
            vec![
                NegotiationReasonCode::ConditionReportNotAcknowledged,
                NegotiationReasonCode::HumanReviewRequired
            ]
        );
    }
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    fn arb_input() -> impl Strategy<Value = NegotiationInputV1> {
        (
            0i64..=100_000_000,
            0i64..=100_000_000,
            0i64..=100_000_000,
            1i64..=20,
            1i64..=20,
            any::<bool>(),
        )
            .prop_map(
                |(
                    list_price_cents,
                    floor_price_cents,
                    customer_offer_cents,
                    offer_number,
                    max_offers,
                    ack,
                )| {
                    NegotiationInputV1 {
                        schema_version: "1.0.0".to_string(),
                        tenant_id: "tenant-proptest".to_string(),
                        vehicle_id: "vehicle-proptest".to_string(),
                        session_id: "session-proptest".to_string(),
                        list_price_cents,
                        floor_price_cents,
                        customer_offer_cents,
                        offer_number,
                        max_offers,
                        condition_report_acknowledged: ack,
                        policy_effective_at: "2026-01-01T00:00:00Z".to_string(),
                    }
                },
            )
    }

    proptest! {
        #[test]
        fn counter_price_never_below_floor(input in arb_input()) {
            let output = evaluate(&input).unwrap();
            if output.decision == NegotiationDecision::Counter {
                prop_assert!(output.counter_offer_cents.unwrap() >= input.floor_price_cents);
            }
        }

        #[test]
        fn counter_price_never_above_list(input in arb_input()) {
            let output = evaluate(&input).unwrap();
            if output.decision == NegotiationDecision::Counter {
                prop_assert!(output.counter_offer_cents.unwrap() <= input.list_price_cents);
            }
        }

        #[test]
        fn accept_has_no_counter_price(input in arb_input()) {
            let output = evaluate(&input).unwrap();
            if output.decision == NegotiationDecision::Accept {
                prop_assert_eq!(output.counter_offer_cents, None);
            }
        }

        #[test]
        fn reject_has_no_counter_price(input in arb_input()) {
            let output = evaluate(&input).unwrap();
            if output.decision == NegotiationDecision::Reject {
                prop_assert_eq!(output.counter_offer_cents, None);
            }
        }

        #[test]
        fn escalate_always_sets_human_review_required(input in arb_input()) {
            let output = evaluate(&input).unwrap();
            if output.decision == NegotiationDecision::Escalate {
                prop_assert!(output.human_review_required);
            }
        }

        #[test]
        fn same_input_produces_same_output(input in arb_input()) {
            let a = evaluate(&input).unwrap();
            let b = evaluate(&input).unwrap();
            prop_assert_eq!(a, b);
        }

        #[test]
        fn reason_codes_have_no_duplicates(input in arb_input()) {
            use std::collections::HashSet;
            let output = evaluate(&input).unwrap();
            let unique: HashSet<_> = output.reason_codes.iter().map(|c| format!("{c:?}")).collect();
            prop_assert_eq!(unique.len(), output.reason_codes.len());
        }

        #[test]
        fn reason_code_order_is_stable(input in arb_input()) {
            let a = evaluate(&input).unwrap();
            let b = evaluate(&input).unwrap();
            prop_assert_eq!(a.reason_codes, b.reason_codes);
        }

        #[test]
        fn evaluate_never_panics_on_any_valid_shaped_input(input in arb_input()) {
            let _ = evaluate(&input);
        }
    }
}
