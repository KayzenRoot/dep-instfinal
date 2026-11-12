import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireOwner } from '#lib/server/owner.js';

export function ownerDatabase(event: RequestEvent) {
	const owner = requireOwner(event);
	if (!event.locals.supabase) error(503, 'Supabase database is not configured.');
	return { owner, db: event.locals.supabase };
}

export function readFormText(form: FormData, key: string): string {
	const value = form.get(key);
	return typeof value === 'string' ? value : '';
}
