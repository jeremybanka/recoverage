import { css } from "hono/css"
import type { HtmlEscapedString } from "hono/utils/html"

import { type BillingConfig, checkoutEnabled } from "./billing-config"
import * as button from "./button"
import type { Loadable } from "./loadable"
import { navigation, panel } from "./presentation"
import {
	hostedReportsAllowed,
	projectsAllowed,
	type Role,
	tokensAllowed,
} from "./roles-permissions"
import { BillingSupport } from "./support"
import { StorageHelp } from "./usage"

export function roleLabel(role: Role): string {
	switch (role) {
		case `free`:
			return `Free`
		case `supporter`:
			return `Supporter`
		case `admin`:
			return `Admin`
	}
}

function roleBadgeStyle(role: Role): string {
	return [
		`border: 1px solid var(--color-fg-light)`,
		`color: ${role === `supporter` ? `var(--hyperlink)` : `var(--color-fg)`}`,
	].join(`; `)
}

function pricingCardStyle(highlighted: boolean): string {
	return [
		`border-color: ${highlighted ? `var(--color-fg)` : `var(--color-fg-light)`}`,
		`margin: 0`,
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
				background: var(--color-bg-t3);
				box-shadow: 0 3px 0 -2px #0003;
				border-radius: 5px 0 5px 0;
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
					background: var(--color-bg-s2);
					box-shadow: inset 0 1px 0 1px #0002;
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
		<section style={pricingCardStyle(highlighted)} class={panel}>
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
								color: var(--color-fg);
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
					color: var(--color-fg);
				`}
			>
				{description}
			</p>
			<ul
				class={css`
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
					gap: 10px;
					list-style: none;
					margin: 0;
					padding: 0;
				`}
			>
				<li>{projectsAllowed.get(role)} projects</li>
				<li>{hostedReportsAllowed.get(role)} hosted reports</li>
				<li>{tokensAllowed.get(role)} tokens per project</li>
			</ul>
		</section>
	)
}

export function PricingPage({
	currentRole,
	config,
	hasExistingSubscription = false,
}: {
	currentRole: Role
	config: BillingConfig
	hasExistingSubscription?: boolean
}): Loadable<HtmlEscapedString> {
	return (
		<>
			<h1>Plans</h1>
			<p class={navigation}>
				<a href="/ui/billing">Plan and billing</a>
			</p>
			<p
				class={css`
					margin-top: 0;
					color: var(--color-fg);
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
					gap: 10px;
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
									padding: 5px 10px;
									border: 1px solid var(--color-fg-faint);
									background: var(--color-bg-t1);
									box-shadow: inset 0 1px 0 1px #0002;
									flex-wrap: wrap;
									gap: 5px;
									color: var(--success);
									font-size: 13px;
									font-weight: 700;
								`}
							>
								Current plan — <a href="/ui/billing">Manage billing</a>
							</span>
						) : hasExistingSubscription ? (
							<a href="/ui/billing">Manage your existing subscription</a>
						) : !checkoutEnabled(config) ? (
							<p>New subscriptions are currently unavailable.</p>
						) : (
							<form method="post" action="/billing/checkout">
								<button.submit>Upgrade to Supporter</button.submit>
							</form>
						),
					description: `Built for the in-between shape: plenty of room whether you spread reports across repos or stack them inside a monorepo.`,
					highlighted: true,
					role: `supporter`,
				})}
			</div>
			<StorageHelp />
			<BillingSupport config={config} />
			<p
				class={css`
					margin-top: 18px;
					font-size: 13px;
					color: var(--color-fg);
				`}
			>
				Checkout happens in Stripe and returns you here when it completes or is
				cancelled.
			</p>
		</>
	)
}
