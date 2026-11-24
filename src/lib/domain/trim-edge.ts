/** Remove only the selected leading/trailing characters in linear time. */
export function trimEdgeCharacters(value: string, characters: string): string {
	let start = 0;
	let end = value.length;
	while (start < end && characters.includes(value[start]!)) start += 1;
	while (end > start && characters.includes(value[end - 1]!)) end -= 1;
	return value.slice(start, end);
}
