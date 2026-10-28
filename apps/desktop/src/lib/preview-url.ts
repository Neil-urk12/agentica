import { isSupportedPreviewUrl } from "@agentica/protocol";

export const PREVIEW_URL_ERROR =
  "Use an HTTP(S) URL on localhost or 127.0.0.1 that is not an Agentica endpoint. IPv6 previews are not supported.";

/** Check the current frontend and runtime endpoints again when displaying a saved URL. */
export function previewUrlAllowed(value: string, endpoints: string[]): boolean {
  if (!isSupportedPreviewUrl(value)) return false;
  const target = new URL(value);
  const port = (url: URL) =>
    url.port || (url.protocol === "https:" ? "443" : "80");
  return endpoints.every((endpoint) => {
    try {
      const app = new URL(endpoint);
      return app.protocol !== target.protocol || port(app) !== port(target);
    } catch {
      return true;
    }
  });
}
