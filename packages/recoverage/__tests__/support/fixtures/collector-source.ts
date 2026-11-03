export function value(publicCall: boolean): string {
	if (publicCall) return `public`
	return `unit`
}
