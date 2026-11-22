import { pgTable, uuid, text, integer, timestamp, unique, jsonb } from 'drizzle-orm/pg-core';
import { users, missionaries, admins, letters } from './schema';
export const submitterAssignments = pgTable('mc_submitter_assignments', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  missionaryId: uuid('missionary_id').notNull().references(() => missionaries.id),
  editorAdminId: uuid('editor_admin_id').notNull().references(() => admins.id),
  expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(),
  revokedAt: timestamp('revoked_at',{withTimezone:true}),
});
export const memberSubmissions = pgTable('mc_member_submissions', {
  letterId: uuid('letter_id').primaryKey().references(() => letters.id),
  userId: uuid('user_id').notNull().references(() => users.id),
});
export const adminUserLinks = pgTable('mc_admin_user_links', {
  adminId: uuid('admin_id').primaryKey().references(() => admins.id),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
});
export const operations = pgTable('mc_operations', {
  requestId: uuid('request_id').primaryKey(), actorId: uuid('actor_id').notNull(),
  action: text().notNull(), inputHash: text('input_hash').notNull(), result: jsonb().notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const deliveryUsage = pgTable('mc_delivery_usage', {
  month: text().primaryKey(), reserved: integer().notNull().default(0),
});
export const deliveryRecipients = pgTable('mc_delivery_recipients', {
  id: uuid().primaryKey().defaultRandom(), letterId: uuid('letter_id').notNull().references(() => letters.id),
  userId: uuid('user_id').notNull().references(() => users.id),
}, t => [unique().on(t.letterId,t.userId)]);
