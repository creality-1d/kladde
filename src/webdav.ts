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

/** Minimal WebDAV client for the Nextcloud files endpoint. */
export class WebDav {
  constructor(private readonly account: NextcloudAccount) {}

  private url(name = ""): string {
    const { server, user, folder } = this.account;
    const base = server.replace(/\/+$/, "");
    const root = base.endsWith("/dav") ? base : `${base}/remote.php/dav`;
    const path = [folder, name].filter(Boolean).map(encodeURIComponent).join("/");
    return `${root}/files/${encodeURIComponent(user)}/${path}`;
  }

  private async request(method: string, name: string, init: RequestInit = {}): Promise<Response> {
    const auth = btoa(`${this.account.user}:${this.account.appPassword}`);
    const response = await fetch(this.url(name), {
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
      .filter((name) => name.endsWith(".inknote.json"));
  }

  async get(name: string): Promise<string> {
    return (await this.request("GET", name)).text();
  }

  async put(name: string, body: string): Promise<void> {
    await this.request("PUT", name, { body, headers: { "Content-Type": "application/json" } });
  }
}
