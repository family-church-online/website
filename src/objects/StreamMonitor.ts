export class StreamMonitor {
	private sessions = new Set<WebSocket>();
	private reports: Array<{ button: string; timestamp: string; city?: string | null }> = [];

	constructor(private state: DurableObjectState) {
		// Restore reports after hibernation so the sync message on WS connect
		// reflects real history instead of wiping the dashboard blank.
		this.state.blockConcurrencyWhile(async () => {
			try {
				const stored = await this.state.storage.get<Array<{ button: string; timestamp: string; city?: string | null }>>('reports');
				if (stored) {
					this.reports = stored;
					this.pruneReports();
				}
			} catch (err) {
				console.error('[StreamMonitor] storage.get failed on init:', err);
				// Start with empty reports — in-memory only for this instance lifetime
			}
		});
	}

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

	private latestCities(): Record<string, string> {
		const seen: Record<string, string> = {};
		const cities: Record<string, string> = {};
		for (const r of this.reports) {
			if (!seen[r.button] || r.timestamp > seen[r.button]) {
				seen[r.button] = r.timestamp;
				if (r.city) cities[r.button] = r.city;
			}
		}
		return cities;
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
					lastCities: this.latestCities(),
				}));
			} catch { /* ignore */ }

			return new Response(null, { status: 101, webSocket: client });
		}

		if (url.pathname.endsWith('/notify') && request.method === 'POST') {
			const data = await request.json() as { type?: string; button?: string; timestamp?: string; city?: string | null };

			if (data.button && data.timestamp) {
				this.reports.push({ button: data.button, timestamp: data.timestamp, city: data.city });
				this.pruneReports();
			}

			// Broadcast first — storage failure must never block the dashboard update
			this.broadcast({ ...data, counts: this.currentCounts() });

			// Persist so reports survive hibernation — non-fatal if storage unavailable
			if (data.button && data.timestamp) {
				try {
					await this.state.storage.put('reports', this.reports);
				} catch (err) {
					console.error('[StreamMonitor] storage.put failed:', err);
				}
			}

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
