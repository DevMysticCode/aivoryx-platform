# Aivoryx Owner / Technical Lead — Pre-Code Checklist

This is your checklist before the first production code is written.

## A. Commercial / ownership

Confirm in writing with the client:
- Aivoryx/development company owns reusable platform IP, subject to the agreed contract.
- Client owns its business data and client-specific content.
- Client controls production cloud/domain/integration accounts where agreed.
- Licensing/white-label/resale rights are explicit.
- Third-party software/API terms remain separate.

Do not rely on verbal agreement for IP ownership.

## B. Client discovery

Collect:
- organization structure
- branches
- departments
- user roles
- employee count
- telecaller count
- field-agent count
- current lead volume/day
- lead source volumes
- current sales stages
- qualification questions
- field survey form
- quotation format
- approval rules
- attendance rules
- leave rules
- expense rules

## C. Existing-system discovery

Obtain exports/API documentation/sample payloads for:
- Zoho Bigin
- Zoho People
- Zoho Inventory
- Zoho Books
- Pabbly workflows
- FieldSense
- Bonvoice

For each integration, document:
- input
- output
- authentication
- frequency
- failure behavior
- record IDs
- attachments
- rate limits
- current business owner

## D. Lead-source samples

Get at least 3–5 real/sanitized examples from:
- Tata
- IndiaMART
- Justdial
- Meta
- Google
- Website

Record what fields arrive and how duplicates are currently detected.

## E. Telephony discovery

Confirm with Bonvoice:
- API/webhook documentation
- click-to-call
- call event webhooks
- recording access
- disposition support
- caller ID
- agent mapping
- authentication
- recording retention

Do not implement against assumptions.

## F. Field discovery

Get the current FieldSense process:
- assignment
- visit scheduling
- GPS
- KM calculation
- check-in/out
- survey fields
- photos
- expenses
- offline behavior
- field-generated leads

## G. HR discovery

Get current Zoho People rules:
- employee fields
- attendance
- geo-fence
- leave types
- approval hierarchy
- holidays
- expense approvals
- salary components
- incentive/commission rules

Payroll can be deferred, but the data model must preserve required inputs.

## H. UX discovery

Ask for:
- screenshots of current Zoho workflows
- current quotation
- current field survey form
- current dashboards
- sample WhatsApp/SMS/email messages
- client branding
- logo/fonts/colors
- mobile devices used by field staff

Do not copy Zoho's UX blindly. Use it only to understand current behavior.

## I. Architecture decisions to freeze

Before business coding, confirm:
- modular monolith
- PostgreSQL
- tenant isolation strategy
- authentication/session approach
- OpenAPI strategy
- PWA strategy
- object storage
- queue/worker strategy
- logging/error correlation
- deployment environments
- backup/restore
- secret management

## J. Repository setup

Create:
- GitHub repository
- branch protection
- issue/project board
- monorepo
- CLAUDE.md
- docs/
- ADR folder
- CI
- dev/staging environments
- database migration system
- `.env.example`
- secret policy

## K. Definition of first client pilot

Do not start implementation until these two journeys are written and approved:

CRM:
Lead → telecaller → qualification → field → survey → quotation → booking.

HR:
Employee → attendance → leave → expense.

## L. Your role during AI development

You remain the final authority.

Claude may implement and recommend.
Claude may not silently decide:
- architecture
- data ownership
- security exceptions
- third-party contract assumptions
- business rules
- scope changes

## M. First-week command

Your first development task to Claude should be:
“Do not build business features. Inspect the repository requirements, create the agreed foundation structure, validate the architecture against CLAUDE.md, and produce a gap report before implementation.”
