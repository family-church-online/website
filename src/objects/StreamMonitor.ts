export class StreamMonitor {
	private sessions = new Set<WebSocket>();

	constructor(private state: DurableObjectState) {}

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
			return new Response(null, { status: 101, webSocket: client });
		}

		if (url.pathname.endsWith('/notify') && request.method === 'POST') {
			const data = await request.json();
			this.broadcast(data);
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
