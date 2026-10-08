// Project operations (docs/spec/11 §3.7): the interface register (07 §2.5). Punch list, ITP and commissioning
// will join this file when their screens are built.
import { date, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { InterfaceStatus, KeystoneSide } from '../codes';
import { id, timestamps } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/**
 * Interfaces owed by the client or third parties (INTERFACES 3719: HLT-026 × 7). The stored status is open /
 * received / frozen; "Late" is derived (open and needed before the prototype's now, PG_NOW).
 */
export const projectInterfaces = pgTable(
  'project_interfaces',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "IF-02" (per project; added interfaces IF-10…). */
    number: text('number').notNull(),
    title: text('title').notNull(),
    keystoneSide: text('keystone_side').$type<KeystoneSide>().notNull(),
    /** "Client · port authority", "Navis · third party". */
    otherParty: text('other_party').notNull(),
    dataExpected: text('data_expected').notNull(),
    /** "15 Oct" → 2026-10-15 (2026 assumed, as the prototype). */
    neededBy: date('needed_by', { mode: 'string' }).notNull(),
    /** Provided date; "Mark received" does not stamp it (OPEN QUESTION Q-4). */
    providedOn: date('provided_on', { mode: 'string' }),
    status: text('status').$type<InterfaceStatus>().notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    ownerName: text('owner_name').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);
