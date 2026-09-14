export class StreamMonitor {
	private sessions = new Set<WebSocket>();
	private reports: Array<{ button: string; timestamp: string }> = [];

	constructor(private state: DurableObjectState) {}

	private pruneReports() {
		const cutoff = Date.now() - 60 * 60 * 1000;
		this.reports = this.reports.filter(r => new Date(r.timestamp).getTime() >= cutoff);
	}

	private currentCounts(): Record<string, number> {
		const counts: Record<string, number> = {};
		for (const r of this.reports) {
			counts[r.button] = (counts[r.button] ?? 0) + 1;
		}
		return counts;
	}

	private latestTimestamps(): Record<string, string> {
		const latest: Record<string, string> = {};
		for (const r of this.reports) {
			if (!latest[r.button] || r.timestamp > latest[r.button]) {
				latest[r.button] = r.timestamp;
			}
		}
		return latest;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.endsWith('/ws')) {
			if (request.headers.get('Upgrade') !== 'websocket') {
				return new Response('Expected WebSocket', { status: 426 });
			}
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as WebSocket[];
			server.accept();
			this.sessions.add(server);
			server.addEventListener('close', () => this.sessions.delete(server));
			server.addEventListener('error', () => this.sessions.delete(server));

			// Send current state immediately so the dashboard doesn't need to HTTP-poll
			this.pruneReports();
			try {
				server.send(JSON.stringify({
					type: 'sync',
					counts: this.currentCounts(),
					lastTimestamps: this.latestTimestamps(),
				}));
			} catch { /* ignore */ }

			return new Response(null, { status: 101, webSocket: client });
		}

		if (url.pathname.endsWith('/notify') && request.method === 'POST') {
			const data = await request.json() as { type?: string; button?: string; timestamp?: string };

			if (data.button && data.timestamp) {
				this.reports.push({ button: data.button, timestamp: data.timestamp });
				this.pruneReports();
			}

			// Include authoritative counts so the dashboard never needs to poll KV
			this.broadcast({ ...data, counts: this.currentCounts() });
			return new Response('ok');
		}

		return new Response('Not found', { status: 404 });
	}

	private broadcast(data: unknown) {
		const msg = JSON.stringify(data);
		for (const ws of this.sessions) {
			try {
				ws.send(msg);
			} catch {
				this.sessions.delete(ws);
			}
		}
	}
}
