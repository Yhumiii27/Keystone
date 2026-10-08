import 'server-only';
// Read-only access to the prototype data set (design file lines 3095–3762, evaluated to JSON by
// design/_extracted). Seeders read from here; screens must go through the DAL (src/server/dal), which
// may read from here only for modules that are not yet modelled in the database (mark those TODO(db)).
import data from './prototype-data.json';
import generated from './prototype-generated.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PROTO = data as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PROTO_GEN = generated as { initialProjects: any[]; projectData: Record<string, any>; genPOs: Record<string, any>; nextProjectId: string };
