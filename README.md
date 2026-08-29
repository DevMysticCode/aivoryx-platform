# Aivoryx Platform — Client #1 Foundation

This repository documentation defines the architecture and execution rules for the first production implementation of the Aivoryx Business Operating Platform.

## Immediate business priority

1. Shared platform foundation
2. CRM / lead management — highest business priority
3. HR — developed in parallel
4. Lead integrations and telephony
5. Field sales + survey
6. Quotation + booking
7. EPC project operations
8. Procurement + inventory + logistics
9. Finance + accounts
10. Service / AMC

The product is intentionally implemented for the first client first, while preserving reusable platform boundaries for future Aivoryx SaaS expansion.

## Golden first journey

Lead source → ingestion → deduplication → assignment → telecaller → call/disposition → qualification → field assignment → site visit → survey → BOQ/design → quotation → approval → booking.

## Non-goals for the first release

- Native mobile applications
- Full Pabbly/Zapier clone
- AI chatbot
- Generic multi-industry productization before client validation
- Microservices/Kubernetes
- Advanced BI/data warehouse

See `CLAUDE.md` and `docs/` before coding.
