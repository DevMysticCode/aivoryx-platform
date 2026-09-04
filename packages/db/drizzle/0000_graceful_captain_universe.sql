CREATE TABLE "system_probe" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note" text DEFAULT 'phase-1 infra probe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
