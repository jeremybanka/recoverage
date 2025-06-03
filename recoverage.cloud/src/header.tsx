import { css } from "hono/css"
import type { HtmlEscapedString } from "hono/utils/html"

import type { Loadable } from "./loadable"

export type MiniHeaderProps = {
	children: string
}
export function mini(props: MiniHeaderProps): Loadable<HtmlEscapedString> {
	return (
		<header
			class={css`
        font-size: 9px;
        letter-spacing: 0.15em;
        text-transform: uppercase;
      `}
		>
			{props.children}
		</header>
	)
}
