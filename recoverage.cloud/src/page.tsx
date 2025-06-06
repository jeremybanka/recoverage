import { css, Style } from "hono/css"
import type { PropsWithChildren } from "hono/jsx"
import type { HtmlEscapedString } from "hono/utils/html"

import { GITHUB_CALLBACK_ENDPOINT } from "./env"
import type { Loadable } from "./loadable"
import * as Script from "./scripts.gen"
import { when } from "./when"

export function Page(
	props: PropsWithChildren & { reload?: boolean },
): Loadable<HtmlEscapedString> {
	const { reload } = props
	return (
		<html lang="en">
			<head>
				{when(
					reload,
					<>
						<meta http-equiv="refresh" content="0; url=/" />
						<script>location.href = "/"</script>
					</>,
				)}
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				{/* <link rel="preload" href="/noise.svg" as="image" type="image/svg+xml" /> */}
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: This is a trusted script
					dangerouslySetInnerHTML={{ __html: JSON.parse(Script.htmxMinJS) }}
				/>
				<title>Recoverage</title>
				<link type="text/css" rel="/assets/theme.css" />
				<Style />
			</head>
			<body
				class={css`
					background: url(/assets/dots.svg) repeat;
					background-size: 4px 4px;
					background-position: 0px -100px; /* Offset to create overlap */
					background-blend-mode: overlay;
					background-color: var(--color-bg);
					position: relative;
					display: flex;
					margin: 0px;
					padding: 5px;
					box-sizing: border-box;
					flex-direction: column;
					min-height: 100svh;
					font-family: sans-serif;
					justify-items: center;
					color: var(--color-fg);
					--hyperlink: #0ff;
					--hyperlink-active: #f80;
					--hyperlink-visited: #f5f;
					--success: #0f0;
					--color-fg: white;
					--color-fg-light: #777;
					--color-fg-superlight: #666;
					--color-fg-faint: #555;
					--color-bg-s2: #050505;
					--color-bg-s1: #121212;
					--color-bg:	#222;
					--color-bg-t1: #2a2a2a;	
					--color-bg-t2: #353535;
					--color-bg-t3: #424242;
					@media (prefers-color-scheme: light) {
						--hyperlink: #00f;
						--hyperlink-active: #f00;
						--hyperlink-visited: #a0a;
						--success: #080;
						--color-fg: black;
						--color-fg-light: #888;
						--color-fg-superlight: #aaa;
						--color-fg-faint: #ddd;
						--color-bg-s2: #eee;
						--color-bg-s1: #f3f3f3;
						--color-bg:	#f6f6f6;
						--color-bg-t1: #f8f8f8;	
						--color-bg-t2: #fbfbfb;
						--color-bg-t3: #fff;
					}
        `}
			>
				<main
					class={css`
						box-sizing: border-box;
						background: var(--color-bg-t1);
						border: 1px solid var(--color-fg-light);
						padding: 40px 15px 20px;
						flex-grow: 0;
						display: flex;
						position: relative;
						flex-direction: column;
						max-width: 630px;
						width: 100%;
						margin: auto;
						min-height: 500px;
						box-shadow: 0 4px 0 -2px #0003;
      		`}
				>
					{props.children}
				</main>
			</body>
		</html>
	)
}

export type SplashPageProps = {
	githubClientId: string
	currentUrl: URL
}
export function SplashPage({
	githubClientId,
	currentUrl,
}: SplashPageProps): Loadable<HtmlEscapedString> {
	const { origin } = currentUrl
	const callbackUrl = new URL(GITHUB_CALLBACK_ENDPOINT, origin)
	return (
		<Page>
			<h1>Recoverage</h1>
			<p>A micro-platform for storing your coverage reports.</p>
			<div class={css`flex-grow: 1;`} />
			<a
				class={css`
					color: var(--hyperlink);
					&:visited {
						color: var(--hyperlink-visited);
					}
					&:active, &:visited:active {
						color: var(--hyperlink-active);
					}
				`}
				href={`https://github.com/login/oauth/authorize?client_id=${githubClientId}&redirect_uri=${callbackUrl.toString()}&scope=user`}
			>
				Login with GitHub
			</a>
		</Page>
	)
}
