import { OfflineError, type DriveChange, type DriveItem, type DrivePort } from "./types";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FIELDS = "id,name,mimeType,size,modifiedTime,appProperties,parents,trashed";
const FOLDER = "application/vnd.google-apps.folder";
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000];

type Raw = { id: string; name: string; mimeType: string; size?: string; modifiedTime: string; appProperties?: Record<string, string>; parents?: string[]; trashed?: boolean };
const item = (r: Raw): DriveItem => ({
  id: r.id, name: r.name, isFolder: r.mimeType === FOLDER, size: Number(r.size ?? 0), modifiedTime: r.modifiedTime,
  appProperties: r.appProperties ?? {}, parentId: r.parents?.[0] ?? null, trashed: !!r.trashed,
});

export class DriveHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Drive ${status}: ${body.slice(0, 200)}`);
  }
}

const retryable = (status: number, body: string) =>
  status === 429 || status >= 500 || (status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(body));

/** Drive REST over `fetchFn` (plugin-http in the app). `token()` returns a fresh access token. 14.7 backoff included. */
export function createDrive(o: { token: () => Promise<string>; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> }): DrivePort {
  const f = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function req(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await o.token()}` } });
      } catch (e) {
        if (e instanceof TypeError || (e instanceof Error && /network|fetch|connect/i.test(e.message))) throw new OfflineError(e.message);
        throw e;
      }
      if (res.ok) return res;
      const body = await res.text();
      const wait = BACKOFF_MS[attempt];
      if (!retryable(res.status, body) || wait === undefined) throw new DriveHttpError(res.status, body);
      await sleep(wait);
    }
  }
  const json = async <T>(url: string, init?: RequestInit) => (await req(url, init)).json() as Promise<T>;
  const q = (p: Record<string, string | number | boolean>) => new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
  const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return {
    async findRoot() {
      const r = await json<{ files: Raw[] }>(
        `${API}/files?${q({ q: "appProperties has { key='shalavRoot' and value='1' } and mimeType='application/vnd.google-apps.folder' and trashed=false", orderBy: "createdTime", fields: "files(id)", spaces: "drive" })}`,
      );
      return r.files[0]?.id ?? null;
    },
    async createFolder(name, parentId, props) {
      const r = await json<Raw>(`${API}/files?${q({ fields: "id" })}`, jsonInit("POST", { name, mimeType: FOLDER, appProperties: props, ...(parentId ? { parents: [parentId] } : {}) }));
      return r.id;
    },
    async listChildren(folderId) {
      const out: DriveItem[] = [];
      let pageToken = "";
      do {
        const r = await json<{ files: Raw[]; nextPageToken?: string }>(
          `${API}/files?${q({ q: `'${folderId}' in parents and trashed=false`, pageSize: 1000, fields: `nextPageToken,files(${FIELDS})`, ...(pageToken ? { pageToken } : {}) })}`,
        );
        out.push(...r.files.map(item));
        pageToken = r.nextPageToken ?? "";
      } while (pageToken);
      return out;
    },
    async upload({ name, parentId, props, bytes, existingId }) {
      const meta = { name, appProperties: props, ...(existingId ? {} : { parents: [parentId] }) };
      const url = existingId ? `${UPLOAD}/files/${existingId}` : `${UPLOAD}/files`;
      const method = existingId ? "PATCH" : "POST";
      if (bytes.length > 5 * 1024 * 1024) {
        // ponytail: one PUT to the resumable session, no chunk resume; add chunking if big uploads fail on flaky links.
        const start = await req(`${url}?${q({ uploadType: "resumable", fields: FIELDS })}`, jsonInit(method, meta));
        const loc = start.headers.get("Location");
        if (!loc) throw new Error("Drive: no resumable session URL");
        return item(await json<Raw>(loc, { method: "PUT", body: bytes as BodyInit }));
      }
      const boundary = `shalav${Math.random().toString(36).slice(2)}`;
      const enc = new TextEncoder();
      const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const tail = enc.encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head);
      body.set(bytes, head.length);
      body.set(tail, head.length + bytes.length);
      return item(await json<Raw>(`${url}?${q({ uploadType: "multipart", fields: FIELDS })}`, { method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: body as BodyInit }));
    },
    async download(fileId) {
      return new Uint8Array(await (await req(`${API}/files/${fileId}?alt=media`)).arrayBuffer());
    },
    async trash(fileId) {
      await req(`${API}/files/${fileId}?${q({ fields: "id" })}`, jsonInit("PATCH", { trashed: true }));
    },
    async startPageToken() {
      return (await json<{ startPageToken: string }>(`${API}/changes/startPageToken`)).startPageToken;
    },
    async changes(token) {
      const out: DriveChange[] = [];
      let t = token;
      for (;;) {
        const r = await json<{ nextPageToken?: string; newStartPageToken?: string; changes: { fileId: string; removed?: boolean; file?: Raw }[] }>(
          `${API}/changes?${q({ pageToken: t, includeRemoved: true, pageSize: 1000, fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))` })}`,
        );
        out.push(...r.changes.map((c) => ({ fileId: c.fileId, removed: !!c.removed, file: c.file ? item(c.file) : undefined })));
        if (r.nextPageToken) t = r.nextPageToken;
        else return { changes: out, newToken: r.newStartPageToken ?? t };
      }
    },
  };
}
