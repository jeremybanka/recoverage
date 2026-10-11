import type { HtmlEscapedString } from "hono/utils/html"

import type { BillingConfig } from "./billing-config"
import type { Loadable } from "./loadable"
import { panel } from "./presentation"

export function BillingSupport({
	config,
}: {
	config: BillingConfig
}): Loadable<HtmlEscapedString> {
	return (
		<aside aria-label="Billing support" class={panel}>
			<p>
				Canceling a subscription stops future renewals; it does not request a
				refund. For missing paid access, an unexpected charge, or a refund
				request, contact billing support with your GitHub username. Do not send
				card details or passwords.
			</p>
			{config.BILLING_SUPPORT_EMAIL ? (
				<p>
					Billing support:{` `}
					<a href={`mailto:${config.BILLING_SUPPORT_EMAIL}`}>
						{config.BILLING_SUPPORT_EMAIL}
					</a>
				</p>
			) : null}
			{config.BILLING_REFUND_POLICY ? (
				<p>{config.BILLING_REFUND_POLICY}</p>
			) : null}
		</aside>
	)
}
