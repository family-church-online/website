export interface EventContext<Env = Record<string, string>> {
	request: Request;
	env: Env;
	params: Record<string, string | string[]>;
	next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
	waitUntil: (promise: Promise<unknown>) => void;
	passThroughOnException: () => void;
}

export type PagesFunction<Env = Record<string, string>> = (
	context: EventContext<Env>,
) => Response | Promise<Response>;
