export namespace Json {
	export type primitive = boolean | number | string | null
	export type Arr = Array<Arr | Obj | primitive>
	export type Obj = { [key: keyof any]: Arr | Obj | primitive }
	export type Val = Arr | Obj | primitive
	export type Compatible<J> = { toJSON(): J }
	export type stringified<J> = string & {
		json?: J extends Compatible<infer C> ? C : J
	}
}

export function stringify<C extends Json.Compatible<any>>(
	value: C,
): Json.stringified<C>
export function stringify<J>(value: J): Json.stringified<J>
export function stringify(value: unknown): Json.stringified<Json.Val> {
	return JSON.stringify(value)
}

export function parse<J>(stringified: Json.stringified<J>): J {
	return JSON.parse(stringified)
}
