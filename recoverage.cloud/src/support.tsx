import type { HtmlEscapedString } from "hono/utils/html"

import type { BillingConfig } from "./billing-config"
import type { Loadable } from "./loadable"

export function BillingSupport({
	config,
}: {
	config: BillingConfig
}): Loadable<HtmlEscapedString> {
	return (
		<aside aria-label="Billing support">
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
