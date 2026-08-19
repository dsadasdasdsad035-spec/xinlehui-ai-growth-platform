// Cloudflare Sites entrypoint for the static Vite trial build. The deployment
// bundle places browser files under dist/client, matching the Sites runtime.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || !url.pathname.includes('.')) url.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(url, request));
  },
};
