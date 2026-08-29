# Claude Development Protocol

## Before every task

Claude must:
1. Read CLAUDE.md.
2. Read the relevant architecture docs.
3. Inspect existing code before proposing new code.
4. Identify reusable components/services.
5. Restate acceptance criteria.
6. List expected files to change.
7. Identify security and tenant-isolation implications.

## During implementation

- Make the smallest coherent change.
- Keep module boundaries.
- Do not introduce a new library without approval.
- Do not modify unrelated files.
- Write tests with the feature.
- Update OpenAPI/contracts.
- Use existing UI components.
- Preserve loading/empty/error states.

## After implementation

Run:
- formatter
- lint
- typecheck
- relevant tests
- Playwright for critical UI paths

Then:
- review git diff
- check for accidental secrets
- update docs if behavior/architecture changed
- report exact results

## If blocked

Do not guess when a business rule or external API behavior is unknown.
Record the blocker and ask the technical lead.

## Task sizing

Prefer tasks that can be completed and reviewed independently:
- employee create
- employee list
- lead create
- lead assignment
- call disposition
- field check-in
- survey submission
- quotation creation

Avoid “build CRM” or “build HR” as single tasks.
