CREATE TYPE "public"."platform_asset_kind" AS ENUM('logo_light', 'logo_dark', 'mark', 'favicon', 'login_logo', 'apple_touch', 'pwa_192', 'pwa_512');--> statement-breakpoint
CREATE TABLE "platform_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "platform_asset_kind" NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"original_filename" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_assets_kind_uq" UNIQUE("kind"),
	CONSTRAINT "platform_assets_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "platform_assets_size_pos" CHECK ("size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform_branding" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"platform_name" text,
	"tagline" text,
	"theme_preset" text,
	"primary_color" text,
	"secondary_color" text,
	"accent_color" text,
	"login_heading" text,
	"login_text" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_branding_singleton_chk" CHECK ("singleton" = true),
	CONSTRAINT "platform_branding_primary_hex" CHECK ("primary_color" is null or "primary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "platform_branding_secondary_hex" CHECK ("secondary_color" is null or "secondary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "platform_branding_accent_hex" CHECK ("accent_color" is null or "accent_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "platform_branding_theme_preset_chk" CHECK ("theme_preset" is null or "theme_preset" in ('aivoryx-teal','ocean','indigo','emerald','royal','warm','custom')),
	CONSTRAINT "platform_branding_login_heading_len" CHECK ("login_heading" is null or char_length("login_heading") <= 80),
	CONSTRAINT "platform_branding_login_text_len" CHECK ("login_text" is null or char_length("login_text") <= 240)
);
--> statement-breakpoint
ALTER TABLE "platform_branding" ADD CONSTRAINT "platform_branding_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;