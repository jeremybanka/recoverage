import { Octokit } from "octokit"

export function createGitHubClient(auth: string): Octokit {
	return new Octokit({
		auth,
		// Bottleneck's module-global queues share promises between requests.
		// Workers cannot finish queued I/O after its originating request ends;
		// concurrent account-panel refreshes otherwise hang in the runtime.
		throttle: { enabled: false },
		// The retry plugin also uses Bottleneck and emits unhandled rejected jobs
		// for failed auth lookups in Workers. Propagate failure to the request so
		// 401 can prompt sign-in and transient outages can be retried by the user.
		retry: { enabled: false },
	})
}
