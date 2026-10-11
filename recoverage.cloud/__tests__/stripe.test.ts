import { createSupporterCheckoutSessionParams } from "../src/stripe"

test(`creates Supporter Checkout Session params`, () => {
	const params = createSupporterCheckoutSessionParams({
		customerId: `cus_test`,
		origin: `https://recoverage.cloud`,
		priceId: `price_supporter`,
		userId: 8570459,
	})

	expect(params).toMatchObject({
		client_reference_id: `8570459`,
		customer: `cus_test`,
		line_items: [{ price: `price_supporter`, quantity: 1 }],
		metadata: {
			recoveragePlan: `supporter`,
			recoverageUserId: `8570459`,
		},
		mode: `subscription`,
		subscription_data: {
			metadata: {
				recoveragePlan: `supporter`,
				recoverageUserId: `8570459`,
			},
		},
		success_url: `https://recoverage.cloud/?billing=success`,
		cancel_url: `https://recoverage.cloud/?billing=cancel`,
	})
})
