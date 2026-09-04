# Business Workflows

## Lead to Booking

1. Lead arrives from a source through the Lead Ingestion Engine:
   Connector → Adapter → Mapping → Canonical Event (`raw_events` +
   `canonical_lead_events` persisted).
2. Validate (schema + tenant rules); invalid events are dead-lettered, not
   dropped.
3. Deduplicate against existing leads/customers by the source's match policy.
4. Create or merge the lead; `LeadCreated`/`LeadUpdated` is emitted on the
   transactional outbox and consumed by the CRM assignment engine, which
   assigns a telecaller using configured rules.
5. Create SLA/call task.
6. Telecaller calls through Bonvoice.
7. Store call metadata/disposition/follow-up.
8. Qualify or route to nurture/lost.
9. Qualified lead assigned to field agent.
10. Visit scheduled.
11. Field agent checks in.
12. GPS/KM captured.
13. Survey completed with photos/documents.
14. Survey reviewed/accepted.
15. Design/BOQ prepared.
16. Quotation generated.
17. Approval workflow.
18. Quotation sent.
19. Customer accepts/booking created.
20. Downstream project workflow starts.

## HR

Employee created → onboarding tasks → attendance account → attendance → leave → expenses → manager approvals → HR/finance processing.

Payroll is not part of the first CRM pilot but must be architecturally compatible with employee, attendance, incentive and expense data.

## Failure paths

Every major workflow needs explicit:

- retry
- manual intervention
- rejected/lost
- cancellation
- duplicate
- unavailable assignee
- invalid external event
  states.
