/** Normalize PostgREST relations that may be represented as a singular row or a collection. */
export function firstRelation<T>(value: T | T[] | null | undefined): T | null {
	if (value == null) return null;
	return (Array.isArray(value) ? value[0] : value) ?? null;
}
