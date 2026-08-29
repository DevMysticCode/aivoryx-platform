# Aivoryx Architecture

## Objective

Deliver the first client's business system quickly while preserving reusable module boundaries for later Aivoryx SaaS expansion.

## Architecture style

**Modular monolith + event-driven internal integration + external integration adapters.**

This is intentionally not microservices.

### Why

The team is small, the first client needs a stable system quickly, and operational complexity must remain low. Module boundaries are enforced in code so extraction into services remains possible later.

## High-level layers

1. Presentation
2. API/application
3. Domain modules
4. Shared platform services
5. Persistence/infrastructure
6. External integrations

## Core modules

- Identity
- Tenancy
- Organization
- RBAC
- Audit
- Documents
- Notifications
- Workflow
- Integration
- Jobs

## Business modules

- CRM
- HR
- Sales
- Field
- Projects
- Procurement
- Inventory
- Finance
- Service
- Solar EPC

## Key rule

Business modules must not depend on another module's database tables directly. Use module application services, contracts, and events.

## First business path

Lead Source → Lead Ingestion → Normalize → Deduplicate → Assign → Telecalling → Qualification → Field → Survey → Design/BOQ → Quotation → Approval → Booking.

## HR parallel path

Tenant → Employee → Role/Manager → Attendance → Leave → Expenses.

## Future productization

The client is the first implementation. Generic capabilities should be configurable, not tenant-hard-coded. Client-specific behavior belongs in configuration or a clearly isolated vertical extension.
