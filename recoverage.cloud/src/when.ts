import type { HtmlEscapedString } from "hono/utils/html"

import type { Loadable } from "./loadable"

export function when(
	condition: unknown,
	children: Loadable<HtmlEscapedString>,
): HtmlEscapedString | Promise<HtmlEscapedString> | null {
	return condition ? children : null
}
