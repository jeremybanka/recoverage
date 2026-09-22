import { Octokit } from "octokit"

export function createGitHubClient(auth: string): Octokit {
	return new Octokit({
		auth,
		// Bottleneck's module-global queues share promises between requests.
		// Workers cannot finish queued I/O after its originating request ends;
		// concurrent account-panel refreshes otherwise hang in the runtime.
		throttle: { enabled: false },
	})
}
