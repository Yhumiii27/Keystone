CREATE TABLE "machine_type_pack_families" (
	"machine_type_code" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer NOT NULL,
	"min_expected" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_type_pack_families_machine_type_code_family_pk" PRIMARY KEY("machine_type_code","family"),
	CONSTRAINT "machine_type_pack_families_family_check" CHECK ("machine_type_pack_families"."family" in ('pid', 'bom', 'layout', 'electrique', 'analyse_fonctionnelle')),
	CONSTRAINT "machine_type_pack_families_weight_check" CHECK ("machine_type_pack_families"."weight" between 0 and 100),
	CONSTRAINT "machine_type_pack_families_min_expected_check" CHECK ("machine_type_pack_families"."min_expected" between 0 and 99)
);
--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN "pack_family" text;--> statement-breakpoint
ALTER TABLE "machine_type_pack_families" ADD CONSTRAINT "machine_type_pack_families_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_pack_family_check" CHECK ("document_types"."pack_family" is null or "document_types"."pack_family" in ('pid', 'bom', 'layout', 'electrique', 'analyse_fonctionnelle'));