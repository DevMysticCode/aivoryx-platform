# ADR 0001 — Modular Monolith

Status: Accepted

## Context
A small development team needs to deliver the first client's integrated business platform quickly and reliably.

## Decision
Use a modular monolith initially, with explicit module boundaries and domain/application events.

## Consequences
Lower operational complexity now. Future service extraction remains possible if a real scaling or team boundary justifies it.
