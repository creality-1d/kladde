export interface NextcloudAccount {
  /** Server base, e.g. https://cloud.example.org, or "/dav" with the dev proxy. */
  server: string;
  user: string;
  /** A Nextcloud app password (Settings → Security), never the login password. */
  appPassword: string;
  folder: string;
}

export class WebDavError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Plain request/response data, as passed through Electron's context bridge. */
interface NativeRequest {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}
interface NativeResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
}
declare global {
  interface Window {
    inknotesNative?: { request(url: string, init: NativeRequest): Promise<NativeResponse> };
  }
}

/**
 * The fetch used for Nextcloud. The Electron shell performs requests in its main
 * process; Capacitor patches fetch natively. Both avoid browser CORS rules.
 */
const platformFetch: typeof fetch = async (input, init = {}) => {
  const native = window.inknotesNative;
  if (!native) return fetch(input, init);
  const body = typeof init.body === "string" || init.body instanceof Uint8Array ? init.body : undefined;
  const result = await native.request(String(input), {
    method: init.method ?? "GET",
    headers: Object.fromEntries(new Headers(init.headers)),
    body,
  });
  const empty = result.status === 204 || result.status === 304 || result.status === 201 && result.body.length === 0;
  return new Response(empty ? null : result.body, { status: result.status, statusText: result.statusText, headers: result.headers });
};

/** Minimal WebDAV client for the Nextcloud files endpoint. */
export class WebDav {
  constructor(
    private readonly account: NextcloudAccount,
    private readonly fetchImpl: typeof fetch = platformFetch,
  ) {}

  private url(name = ""): string {
    const { server, user, folder } = this.account;
    const base = server.replace(/\/+$/, "");
    const root = base.endsWith("/dav") ? base : `${base}/remote.php/dav`;
    const path = [folder, name].filter(Boolean).map(encodeURIComponent).join("/");
    return `${root}/files/${encodeURIComponent(user)}/${path}`;
  }

  private async request(method: string, name: string, init: RequestInit = {}): Promise<Response> {
    const auth = btoa(`${this.account.user}:${this.account.appPassword}`);
    const response = await this.fetchImpl(this.url(name), {
      ...init,
      method,
      headers: { Authorization: `Basic ${auth}`, ...init.headers },
    });
    if (!response.ok && response.status !== 207) {
      throw new WebDavError(response.status, `${method} ${name || "/"} failed: HTTP ${response.status}`);
    }
    return response;
  }

  async ensureFolder(): Promise<void> {
    try {
      await this.request("MKCOL", "");
    } catch (error) {
      // 405: the folder already exists.
      if (!(error instanceof WebDavError && error.status === 405)) throw error;
    }
  }

  async list(): Promise<string[]> {
    const response = await this.request("PROPFIND", "", {
      headers: { Depth: "1", "Content-Type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
    });
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    return Array.from(xml.getElementsByTagNameNS("DAV:", "href"))
      .map((href) => decodeURIComponent(href.textContent ?? "").split("/").pop() ?? "")
      .filter(Boolean);
  }

  async get(name: string): Promise<string> {
    return (await this.request("GET", name)).text();
  }

  async put(name: string, body: string): Promise<void> {
    await this.request("PUT", name, { body, headers: { "Content-Type": "application/json" } });
  }

  async getBinary(name: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request("GET", name)).arrayBuffer());
  }

  async putBinary(name: string, body: Uint8Array): Promise<void> {
    await this.request("PUT", name, { body: body.slice(), headers: { "Content-Type": "application/octet-stream" } });
  }
}
