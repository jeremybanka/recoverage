import Stripe from "stripe"

export function createStripeClient(secretKey: string): Stripe {
	return new Stripe(secretKey, {
		apiVersion: `2026-04-22.dahlia`,
		appInfo: {
			name: `recoverage.cloud`,
			url: `https://recoverage.cloud`,
		},
		typescript: true,
	})
}

export function createSupporterCheckoutSessionParams({
	customerId,
	origin,
	priceId,
	userId,
}: {
	customerId: string
	origin: string
	priceId: string
	userId: number
}): Stripe.Checkout.SessionCreateParams {
	const successUrl = new URL(`/`, origin)
	successUrl.searchParams.set(`billing`, `success`)
	const cancelUrl = new URL(`/`, origin)
	cancelUrl.searchParams.set(`billing`, `cancel`)
	const metadata = {
		recoveragePlan: `supporter`,
		recoverageUserId: String(userId),
	}

	return {
		client_reference_id: String(userId),
		customer: customerId,
		line_items: [
			{
				price: priceId,
				quantity: 1,
			},
		],
		metadata,
		mode: `subscription`,
		subscription_data: { metadata },
		success_url: successUrl.toString(),
		cancel_url: cancelUrl.toString(),
	}
}

export async function retrieveStripeSubscription(
	stripe: Stripe,
	subscriptionId: string,
): Promise<Stripe.Subscription> {
	return stripe.subscriptions.retrieve(subscriptionId, {
		expand: [`customer`, `latest_invoice`],
	})
}
