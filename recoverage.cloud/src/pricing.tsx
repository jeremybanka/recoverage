import { css } from "hono/css"
import type { HtmlEscapedString } from "hono/utils/html"

import type { Loadable } from "./loadable"
import {
	hostedReportsAllowed,
	projectsAllowed,
	reportBytesAllowed,
	type Role,
	tokensAllowed,
} from "./roles-permissions"

function roleLabel(role: Role): string {
	switch (role) {
		case `free`:
			return `Free`
		case `supporter`:
			return `Supporter`
		case `admin`:
			return `Admin`
	}
}

function bytesLabel(bytes: number): string {
	const megabytes = bytes / (1024 * 1024)
	return `${megabytes} MB`
}

function roleBadgeStyle(role: Role): string {
	return [
		`border: 1px solid ${
			role === `supporter`
				? `color-mix(in srgb, var(--hyperlink) 45%, white 20%)`
				: `var(--color-fg-faint)`
		}`,
		`background: ${
			role === `supporter`
				? `linear-gradient(180deg, color-mix(in srgb, var(--hyperlink) 10%, var(--color-bg-t3)), var(--color-bg-t2))`
				: `linear-gradient(180deg, var(--color-bg-t3), var(--color-bg-t2))`
		}`,
		`color: ${role === `supporter` ? `var(--hyperlink)` : `var(--color-fg)`}`,
	].join(`; `)
}

function pricingCardStyle({
	accent,
	highlighted,
}: {
	accent: string
	highlighted: boolean
}): string {
	return [
		`border: 1px solid ${
			highlighted
				? `color-mix(in srgb, ${accent} 55%, var(--color-fg-faint))`
				: `var(--color-fg-light)`
		}`,
		`background: linear-gradient(180deg, color-mix(in srgb, ${accent} 6%, var(--color-bg-t3)), var(--color-bg-t2))`,
		`border-radius: ${highlighted ? `0 16px 4px 4px` : `4px 4px 0 16px`}`,
	].join(`; `)
}

export function RoleBadge({
	href,
	role,
}: {
	href: string
	role: Role
}): Loadable<HtmlEscapedString> {
	return (
		<a
			href={href}
			style={roleBadgeStyle(role)}
			class={css`
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 3px 9px 4px;
				box-shadow:
					inset 0 1px 0 #fff1,
					0 4px 0 -2px #0003;
				text-decoration: none;
				font-size: 13px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0;
				&:visited {
					color: inherit;
				}
				&:hover {
					filter: brightness(1.08);
				}
				&:active {
					transform: translateY(1px);
					box-shadow:
						inset 0 1px 0 #fff1,
						0 2px 0 -1px #0003;
				}
			`}
		>
			[{roleLabel(role)}]
		</a>
	)
}

function PricingCard({
	accent,
	callToAction,
	description,
	highlighted = false,
	role,
}: {
	accent: string
	callToAction?: Loadable<HtmlEscapedString>
	description: string
	highlighted?: boolean
	role: Role
}): Loadable<HtmlEscapedString> {
	return (
		<section
			style={pricingCardStyle({ accent, highlighted })}
			class={css`
				display: flex;
				flex-direction: column;
				gap: 14px;
				padding: 16px 16px 18px;
				box-shadow:
					inset 0 1px 0 #fff1,
					0 8px 20px #00000024,
					0 4px 0 -2px #0003;
			`}
		>
			<header
				class={css`
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					gap: 12px;
					flex-wrap: wrap;
				`}
			>
				<div
					class={css`
						display: flex;
						flex-direction: column;
						gap: 6px;
					`}
				>
					<span
						class={css`
							font-size: 13px;
							font-weight: 700;
							text-transform: uppercase;
							color: ${accent};
						`}
					>
						{roleLabel(role)}
					</span>
					<h3
						class={css`
							margin: 0;
							font-size: 28px;
						`}
					>
						{role === `free` ? `$0` : `$1`}
						<span
							class={css`
								font-size: 15px;
								font-weight: 400;
								color: var(--color-fg-light);
							`}
						>
							/mo
						</span>
					</h3>
				</div>
				{callToAction}
			</header>
			<p
				class={css`
					margin: 0;
					color: var(--color-fg-light);
				`}
			>
				{description}
			</p>
			<ul
				class={css`
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
					gap: 10px 14px;
					list-style: none;
					margin: 0;
					padding: 0;
				`}
			>
				<li>{projectsAllowed.get(role)} projects</li>
				<li>{hostedReportsAllowed.get(role)} hosted reports</li>
				<li>{tokensAllowed.get(role)} tokens per project</li>
				<li>{bytesLabel(reportBytesAllowed.get(role))} per report</li>
			</ul>
		</section>
	)
}

export function PricingPage({
	currentRole,
}: {
	currentRole: Role
}): Loadable<HtmlEscapedString> {
	return (
		<>
			<h1>Upgrade</h1>
			<p
				class={css`
					margin-top: 0;
					color: var(--color-fg-light);
					max-width: 40ch;
				`}
			>
				Keep the free tier generous, and step up to Supporter when you want a lot
				more room for hosted reports.
			</p>
			<div
				class={css`
					display: flex;
					flex-direction: column;
					gap: 14px;
					margin-top: 6px;
				`}
			>
				{PricingCard({
					accent: `var(--color-fg)`,
					description: `A lightweight setup for a few active reports and routine work.`,
					role: `free`,
				})}
				{PricingCard({
					accent: `var(--hyperlink)`,
					callToAction:
						currentRole === `supporter` || currentRole === `admin` ? (
							<span
								class={css`
									display: inline-flex;
									align-items: center;
									padding: 7px 12px 8px;
									border: 1px solid var(--color-fg-faint);
									background: var(--color-bg-t3);
									box-shadow:
										inset 0 1px 0 #fff1,
										0 4px 0 -2px #0003;
									color: var(--success);
									font-size: 13px;
									font-weight: 700;
								`}
							>
								Current plan
							</span>
						) : (
							<form method="post" action="/billing/checkout">
								<button
									type="submit"
									class={css`
										cursor: pointer;
										border: 1px solid color-mix(in srgb, var(--hyperlink) 45%, white 20%);
										background: linear-gradient(
											180deg,
											color-mix(in srgb, var(--hyperlink) 18%, var(--color-bg-t3)),
											color-mix(in srgb, var(--hyperlink) 8%, var(--color-bg-t2))
										);
										box-shadow:
											inset 0 1px 0 #fff1,
											0 4px 0 -2px #0003;
										color: white;
										padding: 8px 14px 9px;
										font-size: 14px;
										font-weight: 700;
									`}
								>
									Upgrade to Supporter
								</button>
							</form>
						),
					description: `Built for the in-between shape: plenty of room whether you spread reports across repos or stack them inside a monorepo.`,
					highlighted: true,
					role: `supporter`,
				})}
			</div>
			<p
				class={css`
					margin-top: 18px;
					font-size: 13px;
					color: var(--color-fg-light);
				`}
			>
				Checkout happens in Stripe and returns you here when it completes or is
				cancelled.
			</p>
		</>
	)
}
