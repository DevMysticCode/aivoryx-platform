# Integration Engine

## Goal

Replace the current Pabbly role gradually without building a full Zapier/Pabbly clone.

## Architecture

External provider → adapter/webhook endpoint → raw event store → normalization → validation → deduplication/idempotency → domain action → audit/result.

## V1 capabilities

- Generic inbound webhook
- Generic REST API connector
- Authentication/secret storage
- Field mapping
- Conditions
- Actions
- Retry policy
- Failed event queue
- Replay
- Logs
- Correlation IDs

## Initial provider integrations

1. Website
2. Pabbly bridge
3. Meta
4. Google
5. IndiaMART
6. Justdial
7. Tata
8. Bonvoice

Provider capability must be verified before implementation. Do not assume a provider supports a specific webhook/API.

## Pabbly migration

Stage 1: Pabbly → Aivoryx.
Stage 2: direct provider → Aivoryx for proven providers.
Stage 3: remove Pabbly.

Keep raw external IDs and payload references for reconciliation.
