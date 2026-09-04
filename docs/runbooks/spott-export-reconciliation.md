# Spott export reservation and recovery

Production export stays disabled until an explicit write client, real company/stage mapping, and the provider contract have been verified. Setting `SPOTT_LIVE=1` does not wire a write client into the production registry. Fixtures belong in explicit test dependencies. This runbook does not authorize production writes or historical crosswalk cleanup.

## Effect lifecycle

The durable effect key is `(scopeId, target, canonicalVacancyId, actionType)`. It is independent of the snapshot, so approving a new snapshot cannot bypass an existing reservation. Every invocation, including readback retries, must pass the current snapshot/approval and capability authorization checks.

| Durable state | Meaning | Next permitted action |
| --- | --- | --- |
| No reservation | No create has been reserved locally | Atomically reserve before calling the provider. Only the insert winner may POST. |
| `reserved`, no external ID | Create may be in flight, may have succeeded, or may never have started | Keep the reservation. Repeated calls must not POST. Investigate using the protocol below. |
| `external_id_acquired` | The external ID is durably known; confirmation is pending | GET that same ID. A failed GET, timeout, 404, or mismatched ID cannot authorize another POST. |
| `confirmed` | Readback matched the stored external ID | Return the persisted outcome or a truthful skip receipt. Never create again for this scoped key. |

An external ID is saved before confirmation. Confirmed finalization persists the crosswalk, attempt, receipt, and effect state transactionally. A newly finalized create requires matching readback. Replay skip receipts reuse existing crosswalk evidence and do not establish fresh provider confirmation; legacy crosswalk provenance requires separate investigation. An unconfirmed receipt means that confirmation was not established; it does not prove the remote create failed.

Attempt/result status describes the current invocation. A concurrent caller that encounters a reservation with no ID records a `failed` invocation and an unconfirmed receipt because it cannot proceed, even while the winning provider request is still running. The effect itself stays `reserved` with a pending or uncertain outcome. Neither the failed-attempt count nor that receipt authorizes a new create. Once the original caller saves the ID, a subsequent approved invocation can resume readback normally.

There is no reservation expiry, automatic release, or retry-POST policy. A crash after reservation but before POST deliberately favors preventing a duplicate over automatically recovering availability. A database failure after a successful POST may leave only the reservation: if the ID was committed, readback can resume; otherwise the outcome needs investigation.

## Unknown outcome without an external ID

1. Keep export disabled for the affected key and preserve its reservation and all attempts/receipts. Do not delete the row, change the scope/key, approve a new snapshot to bypass it, or retry POST based on elapsed time or an HTTP error.
2. Gather the scoped key, reservation and attempt timestamps, approval/snapshot IDs, and sanitized request/response evidence from the authorized environment. Do not copy credentials, vacancy payloads, or personal data into git or public evidence.
3. Check the current official provider contract and obtain provider-side evidence for the original request. A matching title or a list result alone is not a unique correlation. Do not assume an undocumented idempotency header, or treat an empty list/404 as proof that create never happened.
4. If the original external ID is established unambiguously, obtain a separately authorized, reviewed reconciliation action that binds that ID to the existing reservation with `manual_evidence` provenance. Preserve a reference to the evidence outside sensitive payloads. The store must reject a conflicting replacement ID. This internal operation does not itself create a confirmed receipt.
5. Retry the normal approved export path to GET the bound ID. Only matching readback may finalize the effect. If no ID can be established, leave the reservation blocked and escalate to the provider. This release supplies no reset or re-create operation for that case.

Production remediation is a separate change with read-only evidence and explicit authorization. Historical synthetic crosswalks must be investigated separately; this migration does not delete or reinterpret them.

## Public provider contract check

Checked on 2026-09-05 using the official [OpenAPI document](https://docs.spott.io/api-reference/openapi.json), **Spott API Reference 0.1**, and [API overview](https://docs.spott.io/docs/developers/api-overview.md). The downloaded OpenAPI SHA-256 was `750f32373626811966021fed21e308b3906789361b13dd5bd9e596b86143bff4`.

`POST /vacancies` declares no parameters, and `CreateVacancyDto` declares no external correlation key or idempotency key. The published OpenAPI contains no idempotency guarantee or external-key lookup contract. `GET /vacancies/{id}` documents a successful vacancy response and a 404, with no stated consistency window. These observations describe the published contract, not every behavior the provider might support privately.

Consequently this implementation sends no invented idempotency header and never treats an unknown result as safe to repeat. Provider support must establish the original ID or supply a separately reviewed recovery contract. Public schema inspection alone does not verify tenant credentials, company/stage mapping, sandbox behavior, or production readiness.

The current live schema also needs a separate adapter review before enabling writes: the mapper covers the documented required create fields, but uses fixture company/stage IDs and hardcoded business values with unverified tenant semantics. GET nests name, description, stage, and client data differently from the local DTO. Custom attributes are written after an ID is known, so they do not solve the ambiguous-create window. This safety repair intentionally leaves those integration prerequisites open.

## Verification boundaries

Pure regressions use explicit synthetic clients and stores. Database concurrency, transaction rollback, and migration tests require a disposable database after the RJC-425 guard is present. Full gates run in CI with at most two workers. No fixture receipt, local test, or successful migration establishes a live provider contract or production export readiness.
