CREATE TYPE "public"."hr_attendance_source" AS ENUM('WEB', 'MOBILE', 'ADMIN', 'IMPORT', 'INTEGRATION');--> statement-breakpoint
CREATE TYPE "public"."hr_attendance_status" AS ENUM('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'EARLY_DEPARTURE', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."hr_compensation_status" AS ENUM('ACTIVE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."hr_employee_status" AS ENUM('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."hr_employment_change_type" AS ENUM('DEPARTMENT', 'DESIGNATION', 'MANAGER', 'LOCATION', 'EMPLOYMENT_TYPE', 'STATUS', 'SCHEDULE', 'COMPENSATION');--> statement-breakpoint
CREATE TYPE "public"."hr_employment_type" AS ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY');--> statement-breakpoint
CREATE TYPE "public"."hr_expense_claim_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSEMENT_PENDING', 'REIMBURSED', 'REIMBURSEMENT_FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."hr_half_day_period" AS ENUM('FIRST_HALF', 'SECOND_HALF');--> statement-breakpoint
CREATE TYPE "public"."hr_payment_method" AS ENUM('BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."hr_incentive_status" AS ENUM('DRAFT', 'APPROVED', 'REJECTED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."hr_leave_approver_strategy" AS ENUM('REPORTING_MANAGER', 'HR', 'DESIGNATED_APPROVER', 'TENANT_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."hr_leave_balance_txn_kind" AS ENUM('OPENING', 'ACCRUAL', 'CONSUMPTION', 'ADJUSTMENT', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."hr_leave_request_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."hr_org_unit_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."hr_pay_frequency" AS ENUM('MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL');--> statement-breakpoint
CREATE TYPE "public"."hr_payroll_payment_status" AS ENUM('PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."hr_payroll_period_status" AS ENUM('DRAFT', 'PROCESSING', 'FINALIZED', 'PAYMENT_PROCESSING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."hr_performance_goal_status" AS ENUM('OPEN', 'ACHIEVED', 'MISSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."hr_performance_period_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."hr_performance_review_status" AS ENUM('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."hr_reimbursement_status" AS ENUM('PENDING', 'PAID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."hr_salary_component_kind" AS ENUM('EARNING', 'DEDUCTION', 'INCENTIVE', 'REIMBURSEMENT');--> statement-breakpoint
ALTER TYPE "public"."audit_module" ADD VALUE 'hr';--> statement-breakpoint
CREATE TABLE "hr_attendance_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attendance_record_id" uuid NOT NULL,
	"field" text NOT NULL,
	"original_value" jsonb,
	"corrected_value" jsonb,
	"reason" text NOT NULL,
	"corrected_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_attendance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" "hr_attendance_status" DEFAULT 'PRESENT' NOT NULL,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone,
	"check_in_lat" numeric(9, 6),
	"check_in_lng" numeric(9, 6),
	"check_in_accuracy_m" numeric(9, 2),
	"check_out_lat" numeric(9, 6),
	"check_out_lng" numeric(9, 6),
	"check_out_accuracy_m" numeric(9, 2),
	"gps_distance_m" numeric(12, 2),
	"source" "hr_attendance_source" DEFAULT 'WEB' NOT NULL,
	"notes" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_attendance_records_emp_date_uq" UNIQUE("tenant_id","employee_id","work_date"),
	CONSTRAINT "hr_attendance_records_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_attendance_records_checkout_after_checkin" CHECK ("check_out_at" is null or ("check_in_at" is not null and "check_out_at" >= "check_in_at"))
);
--> statement-breakpoint
CREATE TABLE "hr_compensation_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"compensation_profile_id" uuid NOT NULL,
	"kind" "hr_salary_component_kind" NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_compensation_components_amount_nonneg" CHECK ("amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hr_compensation_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"pay_frequency" "hr_pay_frequency" DEFAULT 'MONTHLY' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"base_salary" numeric(18, 2) NOT NULL,
	"status" "hr_compensation_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_compensation_profiles_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_compensation_profiles_emp_date_uq" UNIQUE("tenant_id","employee_id","effective_date"),
	CONSTRAINT "hr_compensation_profiles_base_nonneg" CHECK ("base_salary" >= 0),
	CONSTRAINT "hr_compensation_profiles_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_departments_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "hr_departments_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "hr_designations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_designations_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "hr_designations_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "hr_employee_bank_details" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"account_holder_name" text NOT NULL,
	"bank_name" text,
	"account_number" text NOT NULL,
	"branch" text,
	"bank_identifier" text,
	"swift_bic" text,
	"preferred_method" "hr_payment_method" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employee_bank_details_employee_uq" UNIQUE("tenant_id","employee_id"),
	CONSTRAINT "hr_employee_bank_details_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "hr_employee_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_filename" text,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employee_documents_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "hr_employee_documents_size_pos" CHECK ("size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"display_name" text NOT NULL,
	"work_email" text,
	"personal_email" text,
	"phone" text,
	"address_line" text,
	"city" text,
	"region" text,
	"country" text,
	"postal_code" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relation" text,
	"joining_date" date NOT NULL,
	"status" "hr_employee_status" DEFAULT 'ACTIVE' NOT NULL,
	"employment_type" "hr_employment_type" DEFAULT 'FULL_TIME' NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"work_location_id" uuid,
	"manager_id" uuid,
	"schedule_id" uuid,
	"category" text,
	"probation_end_date" date,
	"membership_id" uuid,
	"photo_object_key" text,
	"notes" text,
	"terminated_at" timestamp with time zone,
	"termination_reason" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employees_tenant_number_uq" UNIQUE("tenant_id","employee_number"),
	CONSTRAINT "hr_employees_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_employees_tenant_membership_uq" UNIQUE("tenant_id","membership_id"),
	CONSTRAINT "hr_employees_self_manager" CHECK ("manager_id" is null or "manager_id" <> "id")
);
--> statement-breakpoint
CREATE TABLE "hr_employment_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"change_type" "hr_employment_change_type" NOT NULL,
	"effective_date" date NOT NULL,
	"from_value" jsonb,
	"to_value" jsonb,
	"reason" text,
	"changed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_expense_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"default_mileage_rate" numeric(12, 4),
	"requires_receipt" boolean DEFAULT true NOT NULL,
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_expense_categories_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "hr_expense_categories_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "hr_expense_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"claim_date" date NOT NULL,
	"expense_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"description" text,
	"merchant" text,
	"project_ref" uuid,
	"visit_ref" uuid,
	"distance_km" numeric(9, 2),
	"mileage_rate" numeric(12, 4),
	"reimbursement_amount" numeric(18, 2),
	"approved_amount" numeric(18, 2),
	"receipt_object_key" text,
	"notes" text,
	"status" "hr_expense_claim_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approver_membership_id" uuid,
	"decided_by_membership_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_expense_claims_tenant_number_uq" UNIQUE("tenant_id","claim_number"),
	CONSTRAINT "hr_expense_claims_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_expense_claims_amount_pos" CHECK ("amount" > 0),
	CONSTRAINT "hr_expense_claims_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "hr_expense_reimbursements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_claim_id" uuid NOT NULL,
	"reimbursed_amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payment_date" date,
	"payment_method" "hr_payment_method",
	"payment_reference" text,
	"transaction_ref" text,
	"status" "hr_reimbursement_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"processed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_expense_reimbursements_claim_uq" UNIQUE("tenant_id","expense_claim_id"),
	CONSTRAINT "hr_expense_reimbursements_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_expense_reimbursements_amount_nonneg" CHECK ("reimbursed_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hr_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"prefix" text NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_counters_tenant_kind_uq" UNIQUE("tenant_id","kind")
);
--> statement-breakpoint
CREATE TABLE "hr_incentives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"source_ref" text,
	"status" "hr_incentive_status" DEFAULT 'DRAFT' NOT NULL,
	"payroll_period_id" uuid,
	"approved_by_membership_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_incentives_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_incentives_amount_pos" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "hr_leave_balance_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"kind" "hr_leave_balance_txn_kind" NOT NULL,
	"amount" numeric(9, 2) NOT NULL,
	"leave_request_id" uuid,
	"reason" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"opening" numeric(9, 2) DEFAULT '0' NOT NULL,
	"accrued" numeric(9, 2) DEFAULT '0' NOT NULL,
	"consumed" numeric(9, 2) DEFAULT '0' NOT NULL,
	"adjusted" numeric(9, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(9, 2) GENERATED ALWAYS AS ("opening" + "accrued" + "adjusted" - "consumed") STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_leave_balances_uq" UNIQUE("tenant_id","employee_id","leave_type_id","year"),
	CONSTRAINT "hr_leave_balances_consumed_nonneg" CHECK ("consumed" >= 0 and "accrued" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hr_leave_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"annual_quota" numeric(9, 2) DEFAULT '0' NOT NULL,
	"approver_strategy" "hr_leave_approver_strategy" DEFAULT 'REPORTING_MANAGER' NOT NULL,
	"designated_approver_membership_id" uuid,
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_leave_policies_tenant_type_uq" UNIQUE("tenant_id","leave_type_id"),
	CONSTRAINT "hr_leave_policies_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_leave_policies_quota_nonneg" CHECK ("annual_quota" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hr_leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"half_day_period" "hr_half_day_period",
	"total_days" numeric(6, 2) NOT NULL,
	"reason" text,
	"notes" text,
	"status" "hr_leave_request_status" DEFAULT 'PENDING' NOT NULL,
	"attachment_object_key" text,
	"approver_membership_id" uuid,
	"decided_by_membership_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_leave_requests_tenant_number_uq" UNIQUE("tenant_id","request_number"),
	CONSTRAINT "hr_leave_requests_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_leave_requests_dates" CHECK ("end_date" >= "start_date"),
	CONSTRAINT "hr_leave_requests_days_pos" CHECK ("total_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "hr_leave_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"allow_negative_balance" boolean DEFAULT false NOT NULL,
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_leave_types_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "hr_leave_types_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"employee_name" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"base_earnings" numeric(18, 2) DEFAULT '0' NOT NULL,
	"allowances_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"incentives_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reimbursements_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deductions_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gross_pay" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(18, 2) DEFAULT '0' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_status" "hr_payroll_payment_status" DEFAULT 'PENDING' NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_payroll_entries_period_emp_uq" UNIQUE("tenant_id","payroll_period_id","employee_id"),
	CONSTRAINT "hr_payroll_entries_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_payroll_entries_paid_nonneg" CHECK ("paid_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_entry_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_entry_id" uuid NOT NULL,
	"kind" "hr_salary_component_kind" NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"source" text DEFAULT 'compensation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_entry_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"payment_method" "hr_payment_method" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"payment_date" date NOT NULL,
	"payment_reference" text,
	"transaction_ref" text,
	"status" "hr_reimbursement_status" DEFAULT 'PAID' NOT NULL,
	"failure_reason" text,
	"processed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_payroll_payments_amount_pos" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "hr_payroll_period_status" DEFAULT 'DRAFT' NOT NULL,
	"gross_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deduction_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"incentive_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reimbursement_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by_membership_id" uuid,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_payroll_periods_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "hr_payroll_periods_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_payroll_periods_dates" CHECK ("period_end" >= "period_start"),
	CONSTRAINT "hr_payroll_periods_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "hr_performance_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"performance_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"weight" integer,
	"status" "hr_performance_goal_status" DEFAULT 'OPEN' NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_performance_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "hr_performance_period_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_performance_periods_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "hr_performance_periods_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_performance_periods_dates" CHECK ("period_end" >= "period_start")
);
--> statement-breakpoint
CREATE TABLE "hr_performance_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"performance_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reviewer_membership_id" uuid,
	"overall_rating" integer,
	"manager_comments" text,
	"employee_comments" text,
	"status" "hr_performance_review_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_performance_reviews_period_emp_uq" UNIQUE("tenant_id","performance_period_id","employee_id"),
	CONSTRAINT "hr_performance_reviews_rating" CHECK ("overall_rating" is null or ("overall_rating" between 1 and 5))
);
--> statement-breakpoint
CREATE TABLE "hr_work_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address_line" text,
	"city" text,
	"region" text,
	"country" text,
	"postal_code" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_work_locations_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "hr_work_locations_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "hr_work_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"working_days_mask" integer DEFAULT 31 NOT NULL,
	"grace_minutes" integer DEFAULT 0 NOT NULL,
	"location_id" uuid,
	"status" "hr_org_unit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_work_schedules_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "hr_work_schedules_time_fmt" CHECK ("start_time" ~ '^\d{2}:\d{2}$' and "end_time" ~ '^\d{2}:\d{2}$'),
	CONSTRAINT "hr_work_schedules_grace_nonneg" CHECK ("grace_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "hr_attendance_corrections" ADD CONSTRAINT "hr_attendance_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance_corrections" ADD CONSTRAINT "hr_attendance_corrections_record_fk" FOREIGN KEY ("attendance_record_id","tenant_id") REFERENCES "public"."hr_attendance_records"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance_records" ADD CONSTRAINT "hr_attendance_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance_records" ADD CONSTRAINT "hr_attendance_records_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_compensation_components" ADD CONSTRAINT "hr_compensation_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_compensation_components" ADD CONSTRAINT "hr_compensation_components_profile_fk" FOREIGN KEY ("compensation_profile_id","tenant_id") REFERENCES "public"."hr_compensation_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_compensation_profiles" ADD CONSTRAINT "hr_compensation_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_compensation_profiles" ADD CONSTRAINT "hr_compensation_profiles_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_bank_details" ADD CONSTRAINT "hr_employee_bank_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_bank_details" ADD CONSTRAINT "hr_employee_bank_details_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_department_fk" FOREIGN KEY ("department_id","tenant_id") REFERENCES "public"."hr_departments"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_designation_fk" FOREIGN KEY ("designation_id","tenant_id") REFERENCES "public"."hr_designations"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_location_fk" FOREIGN KEY ("work_location_id","tenant_id") REFERENCES "public"."hr_work_locations"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_manager_fk" FOREIGN KEY ("manager_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_schedule_fk" FOREIGN KEY ("schedule_id","tenant_id") REFERENCES "public"."hr_work_schedules"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_membership_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employment_history" ADD CONSTRAINT "hr_employment_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employment_history" ADD CONSTRAINT "hr_employment_history_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_expense_categories" ADD CONSTRAINT "hr_expense_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_expense_claims" ADD CONSTRAINT "hr_expense_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_expense_claims" ADD CONSTRAINT "hr_expense_claims_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_expense_claims" ADD CONSTRAINT "hr_expense_claims_category_fk" FOREIGN KEY ("category_id","tenant_id") REFERENCES "public"."hr_expense_categories"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_expense_reimbursements" ADD CONSTRAINT "hr_expense_reimbursements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_expense_reimbursements" ADD CONSTRAINT "hr_expense_reimbursements_claim_fk" FOREIGN KEY ("expense_claim_id","tenant_id") REFERENCES "public"."hr_expense_claims"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_counters" ADD CONSTRAINT "hr_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_incentives" ADD CONSTRAINT "hr_incentives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_incentives" ADD CONSTRAINT "hr_incentives_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balance_transactions" ADD CONSTRAINT "hr_leave_balance_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balance_transactions" ADD CONSTRAINT "hr_leave_balance_txn_request_fk" FOREIGN KEY ("leave_request_id","tenant_id") REFERENCES "public"."hr_leave_requests"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_type_fk" FOREIGN KEY ("leave_type_id","tenant_id") REFERENCES "public"."hr_leave_types"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_policies" ADD CONSTRAINT "hr_leave_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_policies" ADD CONSTRAINT "hr_leave_policies_type_fk" FOREIGN KEY ("leave_type_id","tenant_id") REFERENCES "public"."hr_leave_types"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_policies" ADD CONSTRAINT "hr_leave_policies_approver_fk" FOREIGN KEY ("designated_approver_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_type_fk" FOREIGN KEY ("leave_type_id","tenant_id") REFERENCES "public"."hr_leave_types"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_entries" ADD CONSTRAINT "hr_payroll_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_entries" ADD CONSTRAINT "hr_payroll_entries_period_fk" FOREIGN KEY ("payroll_period_id","tenant_id") REFERENCES "public"."hr_payroll_periods"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_entries" ADD CONSTRAINT "hr_payroll_entries_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_entry_components" ADD CONSTRAINT "hr_payroll_entry_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_entry_components" ADD CONSTRAINT "hr_payroll_entry_components_entry_fk" FOREIGN KEY ("payroll_entry_id","tenant_id") REFERENCES "public"."hr_payroll_entries"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_payments" ADD CONSTRAINT "hr_payroll_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_payments" ADD CONSTRAINT "hr_payroll_payments_entry_fk" FOREIGN KEY ("payroll_entry_id","tenant_id") REFERENCES "public"."hr_payroll_entries"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_periods" ADD CONSTRAINT "hr_payroll_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_goals" ADD CONSTRAINT "hr_performance_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_goals" ADD CONSTRAINT "hr_performance_goals_period_fk" FOREIGN KEY ("performance_period_id","tenant_id") REFERENCES "public"."hr_performance_periods"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_goals" ADD CONSTRAINT "hr_performance_goals_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_periods" ADD CONSTRAINT "hr_performance_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_reviews" ADD CONSTRAINT "hr_performance_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_reviews" ADD CONSTRAINT "hr_performance_reviews_period_fk" FOREIGN KEY ("performance_period_id","tenant_id") REFERENCES "public"."hr_performance_periods"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_performance_reviews" ADD CONSTRAINT "hr_performance_reviews_employee_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."hr_employees"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_locations" ADD CONSTRAINT "hr_work_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_schedules" ADD CONSTRAINT "hr_work_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_schedules" ADD CONSTRAINT "hr_work_schedules_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."hr_work_locations"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_attendance_corrections_rec_idx" ON "hr_attendance_corrections" USING btree ("tenant_id","attendance_record_id");--> statement-breakpoint
CREATE INDEX "hr_attendance_records_tenant_date_idx" ON "hr_attendance_records" USING btree ("tenant_id","work_date");--> statement-breakpoint
CREATE INDEX "hr_attendance_records_emp_idx" ON "hr_attendance_records" USING btree ("tenant_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "hr_compensation_components_profile_idx" ON "hr_compensation_components" USING btree ("tenant_id","compensation_profile_id");--> statement-breakpoint
CREATE INDEX "hr_compensation_profiles_emp_idx" ON "hr_compensation_profiles" USING btree ("tenant_id","employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "hr_departments_tenant_idx" ON "hr_departments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hr_designations_tenant_idx" ON "hr_designations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hr_employee_documents_emp_idx" ON "hr_employee_documents" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_employees_tenant_status_idx" ON "hr_employees" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "hr_employees_tenant_dept_idx" ON "hr_employees" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "hr_employees_tenant_manager_idx" ON "hr_employees" USING btree ("tenant_id","manager_id");--> statement-breakpoint
CREATE INDEX "hr_employment_history_emp_idx" ON "hr_employment_history" USING btree ("tenant_id","employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "hr_expense_categories_tenant_idx" ON "hr_expense_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hr_expense_claims_emp_idx" ON "hr_expense_claims" USING btree ("tenant_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "hr_expense_claims_queue_idx" ON "hr_expense_claims" USING btree ("tenant_id","status","claim_date");--> statement-breakpoint
CREATE INDEX "hr_expense_claims_visit_idx" ON "hr_expense_claims" USING btree ("tenant_id","visit_ref");--> statement-breakpoint
CREATE INDEX "hr_incentives_emp_idx" ON "hr_incentives" USING btree ("tenant_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "hr_leave_balance_txn_idx" ON "hr_leave_balance_transactions" USING btree ("tenant_id","employee_id","leave_type_id");--> statement-breakpoint
CREATE INDEX "hr_leave_balances_emp_idx" ON "hr_leave_balances" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_emp_idx" ON "hr_leave_requests" USING btree ("tenant_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_queue_idx" ON "hr_leave_requests" USING btree ("tenant_id","status","start_date");--> statement-breakpoint
CREATE INDEX "hr_leave_types_tenant_idx" ON "hr_leave_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hr_payroll_entries_emp_idx" ON "hr_payroll_entries" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_payroll_entry_components_entry_idx" ON "hr_payroll_entry_components" USING btree ("tenant_id","payroll_entry_id");--> statement-breakpoint
CREATE INDEX "hr_payroll_payments_entry_idx" ON "hr_payroll_payments" USING btree ("tenant_id","payroll_entry_id");--> statement-breakpoint
CREATE INDEX "hr_payroll_periods_tenant_status_idx" ON "hr_payroll_periods" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "hr_performance_goals_idx" ON "hr_performance_goals" USING btree ("tenant_id","performance_period_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_performance_reviews_emp_idx" ON "hr_performance_reviews" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_work_locations_tenant_idx" ON "hr_work_locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hr_work_schedules_tenant_idx" ON "hr_work_schedules" USING btree ("tenant_id");
--> statement-breakpoint
-- ============================================================================
-- HR & Workforce — Row-Level Security (Phase 12, ADR 0041).
--
-- Every HR table is tenant-owned: ENABLE + FORCE RLS with a single
-- tenant-isolation policy on the per-transaction app.tenant_id GUC (USING +
-- WITH CHECK), so a missing tenant context fails closed and a cross-tenant
-- read/insert/update/delete is impossible. Sensitive tables
-- (hr_employee_bank_details, hr_compensation_*) rely on this boundary PLUS a
-- dedicated narrow permission and masked DTOs at the application layer.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_counters" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_counters_tenant_isolation" ON "hr_counters";--> statement-breakpoint
CREATE POLICY "hr_counters_tenant_isolation" ON "hr_counters"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_departments" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_departments_tenant_isolation" ON "hr_departments";--> statement-breakpoint
CREATE POLICY "hr_departments_tenant_isolation" ON "hr_departments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_designations" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_designations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_designations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_designations_tenant_isolation" ON "hr_designations";--> statement-breakpoint
CREATE POLICY "hr_designations_tenant_isolation" ON "hr_designations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_work_locations" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_work_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_work_locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_work_locations_tenant_isolation" ON "hr_work_locations";--> statement-breakpoint
CREATE POLICY "hr_work_locations_tenant_isolation" ON "hr_work_locations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_work_schedules" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_work_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_work_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_work_schedules_tenant_isolation" ON "hr_work_schedules";--> statement-breakpoint
CREATE POLICY "hr_work_schedules_tenant_isolation" ON "hr_work_schedules"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_employees" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_employees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_employees_tenant_isolation" ON "hr_employees";--> statement-breakpoint
CREATE POLICY "hr_employees_tenant_isolation" ON "hr_employees"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_employment_history" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_employment_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_employment_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_employment_history_tenant_isolation" ON "hr_employment_history";--> statement-breakpoint
CREATE POLICY "hr_employment_history_tenant_isolation" ON "hr_employment_history"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_employee_bank_details" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_employee_bank_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_employee_bank_details" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_employee_bank_details_tenant_isolation" ON "hr_employee_bank_details";--> statement-breakpoint
CREATE POLICY "hr_employee_bank_details_tenant_isolation" ON "hr_employee_bank_details"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_employee_documents" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_employee_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_employee_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_employee_documents_tenant_isolation" ON "hr_employee_documents";--> statement-breakpoint
CREATE POLICY "hr_employee_documents_tenant_isolation" ON "hr_employee_documents"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_attendance_records" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_attendance_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_attendance_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_attendance_records_tenant_isolation" ON "hr_attendance_records";--> statement-breakpoint
CREATE POLICY "hr_attendance_records_tenant_isolation" ON "hr_attendance_records"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_attendance_corrections" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_attendance_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_attendance_corrections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_attendance_corrections_tenant_isolation" ON "hr_attendance_corrections";--> statement-breakpoint
CREATE POLICY "hr_attendance_corrections_tenant_isolation" ON "hr_attendance_corrections"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_leave_types" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_leave_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_leave_types_tenant_isolation" ON "hr_leave_types";--> statement-breakpoint
CREATE POLICY "hr_leave_types_tenant_isolation" ON "hr_leave_types"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_leave_policies" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_leave_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_leave_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_leave_policies_tenant_isolation" ON "hr_leave_policies";--> statement-breakpoint
CREATE POLICY "hr_leave_policies_tenant_isolation" ON "hr_leave_policies"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_leave_balances" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_leave_balances_tenant_isolation" ON "hr_leave_balances";--> statement-breakpoint
CREATE POLICY "hr_leave_balances_tenant_isolation" ON "hr_leave_balances"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_leave_requests" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_leave_requests_tenant_isolation" ON "hr_leave_requests";--> statement-breakpoint
CREATE POLICY "hr_leave_requests_tenant_isolation" ON "hr_leave_requests"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_leave_balance_transactions" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_leave_balance_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_leave_balance_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_leave_balance_transactions_tenant_isolation" ON "hr_leave_balance_transactions";--> statement-breakpoint
CREATE POLICY "hr_leave_balance_transactions_tenant_isolation" ON "hr_leave_balance_transactions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_expense_categories" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_expense_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_expense_categories_tenant_isolation" ON "hr_expense_categories";--> statement-breakpoint
CREATE POLICY "hr_expense_categories_tenant_isolation" ON "hr_expense_categories"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_expense_claims" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_expense_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_expense_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_expense_claims_tenant_isolation" ON "hr_expense_claims";--> statement-breakpoint
CREATE POLICY "hr_expense_claims_tenant_isolation" ON "hr_expense_claims"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_expense_reimbursements" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_expense_reimbursements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_expense_reimbursements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_expense_reimbursements_tenant_isolation" ON "hr_expense_reimbursements";--> statement-breakpoint
CREATE POLICY "hr_expense_reimbursements_tenant_isolation" ON "hr_expense_reimbursements"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_compensation_profiles" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_compensation_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_compensation_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_compensation_profiles_tenant_isolation" ON "hr_compensation_profiles";--> statement-breakpoint
CREATE POLICY "hr_compensation_profiles_tenant_isolation" ON "hr_compensation_profiles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_compensation_components" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_compensation_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_compensation_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_compensation_components_tenant_isolation" ON "hr_compensation_components";--> statement-breakpoint
CREATE POLICY "hr_compensation_components_tenant_isolation" ON "hr_compensation_components"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_incentives" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_incentives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_incentives" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_incentives_tenant_isolation" ON "hr_incentives";--> statement-breakpoint
CREATE POLICY "hr_incentives_tenant_isolation" ON "hr_incentives"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_payroll_periods" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_payroll_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_payroll_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_payroll_periods_tenant_isolation" ON "hr_payroll_periods";--> statement-breakpoint
CREATE POLICY "hr_payroll_periods_tenant_isolation" ON "hr_payroll_periods"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_payroll_entries" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_payroll_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_payroll_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_payroll_entries_tenant_isolation" ON "hr_payroll_entries";--> statement-breakpoint
CREATE POLICY "hr_payroll_entries_tenant_isolation" ON "hr_payroll_entries"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_payroll_entry_components" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_payroll_entry_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_payroll_entry_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_payroll_entry_components_tenant_isolation" ON "hr_payroll_entry_components";--> statement-breakpoint
CREATE POLICY "hr_payroll_entry_components_tenant_isolation" ON "hr_payroll_entry_components"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_payroll_payments" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_payroll_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_payroll_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_payroll_payments_tenant_isolation" ON "hr_payroll_payments";--> statement-breakpoint
CREATE POLICY "hr_payroll_payments_tenant_isolation" ON "hr_payroll_payments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_performance_periods" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_performance_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_performance_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_performance_periods_tenant_isolation" ON "hr_performance_periods";--> statement-breakpoint
CREATE POLICY "hr_performance_periods_tenant_isolation" ON "hr_performance_periods"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_performance_goals" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_performance_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_performance_goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_performance_goals_tenant_isolation" ON "hr_performance_goals";--> statement-breakpoint
CREATE POLICY "hr_performance_goals_tenant_isolation" ON "hr_performance_goals"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_performance_reviews" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "hr_performance_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_performance_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "hr_performance_reviews_tenant_isolation" ON "hr_performance_reviews";--> statement-breakpoint
CREATE POLICY "hr_performance_reviews_tenant_isolation" ON "hr_performance_reviews"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
