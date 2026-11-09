import type { SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient | null;
			supabaseUser: User | null;
			owner: User | null;
			supabaseConfigured: boolean;
			ownerConfigured: boolean;
		}
	}
}

export {};
