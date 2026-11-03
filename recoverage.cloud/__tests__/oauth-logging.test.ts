import { env } from "cloudflare:test"

import app from "../src"
import { GITHUB_CALLBACK_ENDPOINT } from "../src/env"

afterEach(() => {
	vi.restoreAllMocks()
})

const accessToken = `mock-access-token-not-a-real-credential`
const refreshToken = `mock-refresh-token-not-a-real-credential`
const errorDetail = `mock-private-provider-detail`

test.each([
	{
		name: `successful exchange`,
		body: `access_token=${accessToken}&refresh_token=${refreshToken}&scope=user&token_type=bearer`,
		providerStatus: 200,
		expectedStatus: 200,
	},
	{
		name: `OAuth error in a successful HTTP response`,
		body: `error=bad_verification_code&error_description=${errorDetail}`,
		providerStatus: 200,
		expectedStatus: 400,
	},
	{
		name: `failed HTTP response`,
		body: `error=server_error&error_description=${errorDetail}`,
		providerStatus: 502,
		expectedStatus: 400,
	},
])(`OAuth callback does not log the response: $name`, async ({
	body,
	providerStatus,
	expectedStatus,
}) => {
	const consoleSpies = ([`log`, `info`, `warn`, `error`, `debug`] as const).map(
		(method) => vi.spyOn(console, method).mockImplementation(() => {}),
	)
	const fetchSpy = vi
		.spyOn(globalThis, `fetch`)
		.mockResolvedValueOnce(new Response(body, { status: providerStatus }))

	const response = await app.request(
		`${GITHUB_CALLBACK_ENDPOINT}?code=mock-oauth-code`,
		{ method: `GET` },
		env,
	)

	expect(fetchSpy).toHaveBeenCalledOnce()
	expect(response.status).toBe(expectedStatus)
	if (expectedStatus === 200) {
		expect(response.headers.get(`set-cookie`)).toContain(`github-access-token=`)
	} else {
		expect(response.headers.get(`set-cookie`)).toBeNull()
	}

	const output = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))
	expect(output).not.toContain(body)
	for (const privateValue of [accessToken, refreshToken, errorDetail]) {
		expect(output).not.toContain(privateValue)
	}
})
