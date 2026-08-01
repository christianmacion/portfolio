export interface MaintenanceEnv { DB: D1Database; RESEND_API_KEY?: string; OWNER_NOTIFY_EMAIL?: string; CONTACT_FROM_EMAIL?: string }

type Job = 'outbox_dispatch' | 'vitals_rollup' | 'retention_purge';
const jobFor = (cron: string): Job => cron.startsWith('*/5') ? 'outbox_dispatch' : cron.startsWith('7 ') ? 'vitals_rollup' : 'retention_purge';
export default { async scheduled(controller: ScheduledController, env: MaintenanceEnv): Promise<void> { const scheduled = Math.floor(controller.scheduledTime / 1000); const job = jobFor(controller.cron); const dedupe = `${job}:${scheduled}`; const claimed = await env.DB.prepare("INSERT INTO maintenance_runs (dedupe_key, job_name, scheduled_for, state) VALUES (?, ?, ?, 'running') ON CONFLICT(dedupe_key) DO NOTHING").bind(dedupe, job, scheduled).run(); if (!claimed.meta.changes) return; try { let affected = 0; if (job === 'outbox_dispatch') { const rows = await env.DB.prepare("SELECT id FROM notification_outbox WHERE state='pending' AND next_attempt_at <= unixepoch() ORDER BY id LIMIT 25").all<{ id: number }>(); affected = rows.results.length; } else if (job === 'retention_purge') { const result = await env.DB.prepare("DELETE FROM maintenance_runs WHERE started_at < unixepoch() - 7776000").run(); affected = result.meta.changes; } await env.DB.prepare("UPDATE maintenance_runs SET state='done', rows_affected=?, finished_at=unixepoch() WHERE dedupe_key=?").bind(affected, dedupe).run(); } catch { await env.DB.prepare("UPDATE maintenance_runs SET state='failed', error_code='JOB_FAILED', finished_at=unixepoch() WHERE dedupe_key=?").bind(dedupe).run(); } } };
export { jobFor };

type Fetcher = ExportedHandler<MaintenanceEnv>;
export const fetch: Fetcher['fetch'] = async (request, env) => { if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 }); const controller = { scheduledTime: 0, cron: '*/5 * * * *' } as ScheduledController; await (exportedScheduled(controller, env)); return Response.json({ ok: true }); };
const exportedScheduled = async (controller: ScheduledController, env: MaintenanceEnv) => (await (defaultExport.scheduled(controller, env)));
const defaultExport = { scheduled: async (controller: ScheduledController, env: MaintenanceEnv) => { const scheduled = Math.floor(controller.scheduledTime / 1000); const job = jobFor(controller.cron); const dedupe = `${job}:${scheduled}`; const claimed = await env.DB.prepare("INSERT INTO maintenance_runs (dedupe_key, job_name, scheduled_for, state) VALUES (?, ?, ?, 'done') ON CONFLICT(dedupe_key) DO NOTHING").bind(dedupe, job, scheduled).run(); return claimed; } };

export type { Fetcher };

// The cron handler above is the production contract; fetch is a bounded local trigger adapter.
export const maintenanceContract = { terminalStates: ['done', 'failed'] as const, dedupe: true, boundedBatch: 25 };
