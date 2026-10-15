DROP TABLE "document_downloads" CASCADE;--> statement-breakpoint
DROP TABLE "client_document_categories" CASCADE;--> statement-breakpoint
ALTER TABLE "document_index_syncs" ADD COLUMN "source" text DEFAULT 'keystone' NOT NULL;