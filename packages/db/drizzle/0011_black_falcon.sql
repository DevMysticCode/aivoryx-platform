CREATE TYPE "public"."credit_note_status" AS ENUM('DRAFT', 'ISSUED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."invoice_source" AS ENUM('manual', 'quotation', 'project');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."line_discount_type" AS ENUM('AMOUNT', 'PERCENT');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('RECORDED', 'REVERSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid,
	"project_id" uuid,
	"status" "credit_note_status" DEFAULT 'DRAFT' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"issue_date" date,
	"reason" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"notes" text,
	"issued_at" timestamp with time zone,
	"issued_by_membership_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_membership_id" uuid,
	"cancel_reason" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "credit_notes_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "credit_notes_amount_pos" CHECK ("amount" > 0),
	CONSTRAINT "credit_notes_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "finance_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"prefix" text NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_counters_tenant_kind_uq" UNIQUE("tenant_id","kind")
);
--> statement-breakpoint
CREATE TABLE "finance_idempotency" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"result_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_idempotency_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"reference" text,
	"description" text NOT NULL,
	"unit_label" text,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_type" "line_discount_type" DEFAULT 'AMOUNT' NOT NULL,
	"discount_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_name" text,
	"tax_rate" numeric(9, 6) DEFAULT '0' NOT NULL,
	"line_subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_taxable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_tenant_invoice_line_uq" UNIQUE("tenant_id","invoice_id","line_no"),
	CONSTRAINT "invoice_lines_qty_nonneg" CHECK ("quantity" >= 0),
	CONSTRAINT "invoice_lines_money_nonneg" CHECK ("unit_price" >= 0 and "discount_value" >= 0 and "tax_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid,
	"quotation_id" uuid,
	"source" "invoice_source" DEFAULT 'manual' NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"notes" text,
	"reference" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_credited" numeric(18, 2) DEFAULT '0' NOT NULL,
	"issued_at" timestamp with time zone,
	"issued_by_membership_id" uuid,
	"overdue_notified_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_membership_id" uuid,
	"cancel_reason" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "invoices_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "invoices_money_nonneg" CHECK ("subtotal" >= 0 and "tax_total" >= 0 and "grand_total" >= 0),
	CONSTRAINT "invoices_paid_nonneg" CHECK ("amount_paid" >= 0 and "amount_credited" >= 0),
	CONSTRAINT "invoices_not_overpaid" CHECK ("amount_paid" + "amount_credited" <= "grand_total"),
	CONSTRAINT "invoices_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_tenant_pay_inv_uq" UNIQUE("tenant_id","payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount_pos" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"method" "payment_method" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"reference" text,
	"notes" text,
	"status" "payment_status" DEFAULT 'RECORDED' NOT NULL,
	"provider_reference" text,
	"allocated_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by_membership_id" uuid,
	"reversal_reason" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "payments_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "payments_amount_pos" CHECK ("amount" > 0),
	CONSTRAINT "payments_allocated_range" CHECK ("allocated_amount" >= 0 and "allocated_amount" <= "amount"),
	CONSTRAINT "payments_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customers"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_fk" FOREIGN KEY ("invoice_id","tenant_id") REFERENCES "public"."invoices"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_fk" FOREIGN KEY ("issued_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_cancelled_by_fk" FOREIGN KEY ("cancelled_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_counters" ADD CONSTRAINT "finance_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_idempotency" ADD CONSTRAINT "finance_idempotency_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("invoice_id","tenant_id") REFERENCES "public"."invoices"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customers"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quotation_fk" FOREIGN KEY ("quotation_id","tenant_id") REFERENCES "public"."quotations"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_fk" FOREIGN KEY ("issued_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_fk" FOREIGN KEY ("cancelled_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("payment_id","tenant_id") REFERENCES "public"."payments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_fk" FOREIGN KEY ("invoice_id","tenant_id") REFERENCES "public"."invoices"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customers"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_fk" FOREIGN KEY ("reversed_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_status_idx" ON "credit_notes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_customer_idx" ON "credit_notes" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_invoice_idx" ON "credit_notes" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "finance_idempotency_tenant_created_idx" ON "finance_idempotency" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_project_idx" ON "invoices" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_due_idx" ON "invoices" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "payment_allocations_tenant_invoice_idx" ON "payment_allocations" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_tenant_payment_idx" ON "payment_allocations" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_status_idx" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payments_tenant_customer_idx" ON "payments" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_date_idx" ON "payments" USING btree ("tenant_id","payment_date");
--> statement-breakpoint
-- Row-Level Security for the Phase 9 finance tables (ADR 0038, following the
-- ADR 0027 / 0030 pattern): non-privileged app-role grants, ENABLE + FORCE RLS,
-- and a tenant-isolation policy matching the per-transaction app.tenant_id GUC.
-- USING + WITH CHECK both fail closed when no tenant context is set.

GRANT SELECT, INSERT, UPDATE, DELETE ON "finance_counters" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "finance_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finance_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "finance_counters_tenant_isolation" ON "finance_counters";--> statement-breakpoint
CREATE POLICY "finance_counters_tenant_isolation" ON "finance_counters"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "finance_idempotency" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "finance_idempotency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finance_idempotency" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "finance_idempotency_tenant_isolation" ON "finance_idempotency";--> statement-breakpoint
CREATE POLICY "finance_idempotency_tenant_isolation" ON "finance_idempotency"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "invoices_tenant_isolation" ON "invoices";--> statement-breakpoint
CREATE POLICY "invoices_tenant_isolation" ON "invoices"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "invoice_lines" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "invoice_lines_tenant_isolation" ON "invoice_lines";--> statement-breakpoint
CREATE POLICY "invoice_lines_tenant_isolation" ON "invoice_lines"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "payments" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "payments_tenant_isolation" ON "payments";--> statement-breakpoint
CREATE POLICY "payments_tenant_isolation" ON "payments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_allocations" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "payment_allocations_tenant_isolation" ON "payment_allocations";--> statement-breakpoint
CREATE POLICY "payment_allocations_tenant_isolation" ON "payment_allocations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_notes" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "credit_notes_tenant_isolation" ON "credit_notes";--> statement-breakpoint
CREATE POLICY "credit_notes_tenant_isolation" ON "credit_notes"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
