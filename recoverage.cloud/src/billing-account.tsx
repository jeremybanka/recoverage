import { Temporal } from "@js-temporal/polyfill"
import { eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { HtmlEscapedString } from "hono/utils/html"

import { deriveRole } from "./billing"
import { checkoutEnabled } from "./billing-config"
import type { Loadable } from "./loadable"
import { type PortalConfig, portalEnabled } from "./portal-config"
import { roleLabel } from "./pricing"
import type { Role } from "./roles-permissions"
import * as schema from "./schema"
import { BillingSupport } from "./support"
import { instantFromSQLTimestamp } from "./temporal"

type Subscription = typeof schema.stripeSubscriptions.$inferSelect
export type BillingAccount = {
	role: Role
	manualRoleOverride: Role | null
	hasCustomer: boolean
	subscriptions: Subscription[]
}

export async function billingAccount(
	db: DrizzleD1Database<typeof schema>,
	userId: number,
	role: Role,
): Promise<BillingAccount> {
	const user = await db.query.users.findFirst({
		where: eq(schema.users.id, userId),
		columns: { manualRoleOverride: true },
	})
	const customer = await db.query.stripeCustomers.findFirst({
		where: eq(schema.stripeCustomers.userId, userId),
		columns: { stripeCustomerId: true },
	})
	const subscriptions = await db.query.stripeSubscriptions.findMany({
		where: eq(schema.stripeSubscriptions.userId, userId),
	})
	return {
		role,
		manualRoleOverride: user?.manualRoleOverride ?? null,
		hasCustomer: !!customer,
		subscriptions,
	}
}

export function confirmedSupporterSubscription(
	account: BillingAccount,
	config: PortalConfig,
	now = Temporal.Now.instant(),
): boolean {
	return (
		deriveRole({
			manualRoleOverride: null,
			now,
			stripeSupporterPriceId: config.STRIPE_SUPPORTER_PRICE_ID,
			subscriptions: account.subscriptions,
		}) === `supporter`
	)
}

export function BillingReturnNotice({
	state,
	account,
	config,
}: {
	state: string | null | undefined
	account: BillingAccount
	config: PortalConfig
}): Loadable<HtmlEscapedString> | null {
	if (state === `success`) {
		return (
			<p role="status">
				{confirmedSupporterSubscription(account, config)
					? `Your account has a confirmed paid Supporter subscription.`
					: `We have not confirmed a paid Supporter subscription yet. Refresh this page shortly, or contact billing support if confirmation does not arrive. Do not purchase again while waiting.`}
			</p>
		)
	}
	if (state === `cancel`) {
		return (
			<p role="status">
				You returned from Checkout. Leaving Checkout does not change your plan.
				Your current account status is shown below.
			</p>
		)
	}
	return null
}

function subscriptionDescription(
	subscription: Subscription,
	config: PortalConfig,
	now: Temporal.Instant,
): string {
	const end = instantFromSQLTimestamp(subscription.currentPeriodEnd)
	const date =
		new Date(end.epochMilliseconds).toLocaleDateString(`en-US`, {
			timeZone: `UTC`,
			month: `long`,
			day: `numeric`,
			year: `numeric`,
		}) + ` (UTC)`
	if (subscription.priceId !== config.STRIPE_SUPPORTER_PRICE_ID)
		return `A subscription with a different price is on this account. Manage billing or contact support to review it.`
	switch (subscription.status) {
		case `active`:
			if (!subscription.latestInvoicePaidAt)
				return `Payment confirmation is pending. Supporter access requires a paid current invoice.`
			if (Temporal.Instant.compare(end, now) <= 0)
				return `The last confirmed paid period ended on ${date}. We are waiting for a confirmed renewal; contact support if you have already paid.`
			return subscription.cancelAtPeriodEnd
				? `Cancellation scheduled. Your paid period ends on ${date}. You can undo cancellation in Manage billing before it takes effect.`
				: `Paid subscription active. Next renewal: ${date}.`
		case `past_due`:
			return `Payment is past due. Open Manage billing to update your payment method or pay the invoice. Supporter access resumes after payment is confirmed.`
		case `unpaid`:
			return `The subscription is unpaid. Open Manage billing to review the invoice, or contact billing support for recovery.`
		case `incomplete`:
			return `The first payment is incomplete. Open Manage billing to review the invoice. Do not start another subscription while payment is pending.`
		case `trialing`:
			return `The subscription is trialing. Supporter access requires an active subscription with a paid current invoice.`
		case `paused`:
			return `The subscription is paused. Contact billing support to resume billing.`
		case `canceled`:
			return `The subscription has ended. You can subscribe again when purchases are available.`
		case `incomplete_expired`:
			return `The first payment was not completed and the subscription expired. You can try subscribing again.`
	}
}

export function BillingAccountPage({
	account,
	config,
	returnState,
}: {
	account: BillingAccount
	config: PortalConfig
	returnState?: string | undefined
}): Loadable<HtmlEscapedString> {
	const now = Temporal.Now.instant()
	const current = account.subscriptions.filter(
		(subscription) =>
			subscription.status !== `canceled` &&
			subscription.status !== `incomplete_expired`,
	)
	const latest = [...account.subscriptions].sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	)[0]
	const displayed = current.length ? current : latest ? [latest] : []
	return (
		<>
			<h1>Plan and billing</h1>
			<p>
				<a href="/">Back to your projects</a> ·{` `}
				<a href="/ui/upgrade">Compare plans</a>
			</p>
			<BillingReturnNotice
				state={returnState}
				account={account}
				config={config}
			/>
			<h2>Current plan: {roleLabel(account.role)}</h2>
			{returnState === `success` ? (
				<p>
					<a href="/ui/billing?billing=success">Refresh status</a>
				</p>
			) : null}
			{account.manualRoleOverride ? (
				<p>
					Your plan is assigned by a maintainer. It is separate from the
					subscription status below; changing or canceling billing does not
					remove this assignment.
				</p>
			) : null}
			{displayed.length ? (
				displayed.map((subscription) => (
					<p key={subscription.stripeSubscriptionId}>
						{subscriptionDescription(subscription, config, now)}
					</p>
				))
			) : (
				<p>No subscription has been confirmed for this account.</p>
			)}
			{current.length > 1 ? (
				<p>
					Multiple subscriptions are on this account. Contact billing support to
					review them before making another purchase.
				</p>
			) : null}
			{account.hasCustomer ? (
				portalEnabled(config) ? (
					<>
						<form method="post" action="/billing/portal">
							<button type="submit">Manage billing</button>
						</form>
						<p>
							Update your payment method, view invoices, or schedule cancellation
							in Stripe. Cancellation can be undone before the paid period ends.
						</p>
					</>
				) : (
					<p>
						Billing management is temporarily unavailable.{` `}
						<a href="/support">Contact billing support</a> for help.
					</p>
				)
			) : null}
			{!current.length &&
			!account.manualRoleOverride &&
			returnState !== `success` ? (
				checkoutEnabled(config) ? (
					<p>
						<a href="/ui/upgrade">
							{latest ? `Subscribe again` : `Upgrade to Supporter`}
						</a>
					</p>
				) : (
					<p>New subscriptions are currently unavailable.</p>
				)
			) : null}
			<p>
				Your existing projects, reports, and tokens are retained after a
				downgrade. Existing reports remain readable and replaceable. Creating new
				items is restricted when you reach your current plan’s limits.
			</p>
			<BillingSupport config={config} />
		</>
	)
}
