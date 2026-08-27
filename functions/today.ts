interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

export const onRequest: (ctx: { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void }) => Promise<Response> =
  async ({ request, env, waitUntil }) => {
    // Today's date in SA time (UTC+2)
    const saNow   = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const dateKey = saNow.toISOString().split('T')[0]; // "YYYY-MM-DD"

    const cache    = caches.default;
    const cacheKey = new Request(`https://cache.local/devotion/today?date=${dateKey}`);

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    // Fetch the pre-built static page for this SA date
    const url = new URL(request.url);
    url.pathname = `/devotion/${dateKey}`;
    const staticPage = await env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));

    if (!staticPage.ok) {
      // No devotion built for today yet — return the static today.astro fallback
      return env.ASSETS.fetch(request);
    }

    // TTL = seconds until next midnight SA (22:00 UTC)
    const [y, mo, d] = dateKey.split('-').map(Number);
    const midnightSaUtc = Date.UTC(y, mo - 1, d, 22, 0, 0);
    const ttl = Math.max(60, Math.floor((midnightSaUtc - Date.now()) / 1000));

    const headers = new Headers(staticPage.headers);
    headers.set('Cache-Control', `public, max-age=3600, s-maxage=${ttl}`);

    const toCache = new Response(staticPage.body, { status: staticPage.status, headers });
    waitUntil(cache.put(cacheKey, toCache.clone()));
    return toCache;
  };
