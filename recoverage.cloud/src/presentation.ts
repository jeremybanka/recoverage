import { css } from "hono/css"

// Match the existing project cards: raised tints, crisp edges, and opposing corners.
export const panel = css`
	box-sizing: border-box;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px 10px 12px;
	margin-block: 10px;
	background: var(--color-bg-t2);
	color: var(--color-fg);
	border: 1px solid var(--color-fg-light);
	border-radius: 10px 0 10px 0;
	box-shadow: 0 4px 0 -2px #0003;
	overflow-wrap: anywhere;
	& > p, & > h2, & > form {
		margin: 0;
	}
	& > h2 {
		font-size: 18px;
	}
	& a {
		color: var(--hyperlink);
	}
	& a:visited {
		color: var(--hyperlink-visited);
	}
	& a:active, & a:visited:active {
		color: var(--hyperlink-active);
	}
`

// Insets hold explanatory/status information; raised panels hold the controls.
export const inset = css`
	box-sizing: border-box;
	padding: 10px;
	margin-block: 10px;
	background: var(--color-bg);
	color: var(--color-fg);
	border: 1px solid var(--color-fg-faint);
	box-shadow: inset 0 1px 0 1px #0002;
	font-size: 14px;
	line-height: 1.5;
	overflow-wrap: anywhere;
`

export const navigation = css`
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin-top: 0;
	line-height: 1.5;
	& a {
		white-space: nowrap;
		color: var(--hyperlink);
	}
	& a:visited {
		color: var(--hyperlink-visited);
	}
	& a:active, & a:visited:active {
		color: var(--hyperlink-active);
	}
`
