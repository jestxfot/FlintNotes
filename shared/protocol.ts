/** Types shared by the server and the browser client. */

/**
 * The version of the talk between a client (the desktop shell, a phone's page) and the server. It changes only when
 * a client of an older protocol could no longer work with the server, or the other way round; the shell checks it
 * against `GET /api/build` before it opens the page.
 */
export const PROTOCOL = 1

/** What `GET /api/build` answers; it needs no key, so a client can tell what it is talking to before it shows the key. */
export interface BuildInfo {
  /** The program's version, e.g. `0.1.15`; `dev` when run from the sources. */
  version: string
  protocol: number
  /** Which build of the server runs (the id `build.json` carries). */
  build: string
}

export interface VaultEntry {
  /** Vault-relative path with forward slashes, e.g. `Projects/Plan.md`. */
  path: string
  kind: 'file' | 'folder'
  size: number
  mtime: number
  /** When the file was created. */
  ctime: number
}

export type RemoteEvent =
  | { type: 'upsert'; entry: VaultEntry }
  | { type: 'delete'; path: string }
  /** First on every connection: the build of the server, so a page from an older one knows to reload. */
  /** Sent first on every connection: which build the server is, and whether a launcher will replace it with the next one. */
  | { type: 'hello'; build: string; updates?: boolean }
  /** The page fell too far behind the changes: it reads the list of files anew. */
  | { type: 'resync' }

/**
 * Who is asking the server: `admin` the server's own computer (no key; may do everything), `shell` the Windows app over
 * the network (the notes and their vaults, but nothing of the server itself), `phone` a phone (the same, but it opens no
 * vault the computer has not opened already).
 */
export type Tier = 'admin' | 'shell' | 'phone'

/** One folder in the list `GET /api/dirs` gives for choosing a vault. */
export interface DirEntry {
  name: string
  path: string
  /** It is a vault already (or looks like one: it has `.obsidian` or `.flint`). */
  vault: boolean
}

/** The folders under one folder of the server's disk. */
export interface DirListing {
  /** The folder listed; null for the list of roots a client may open vaults in. */
  path: string | null
  /** The folder above it, or null where there is none a client may go to. */
  parent: string | null
  roots: string[]
  dirs: DirEntry[]
}

/** A folder the user has opened as a vault. */
export interface VaultInfo {
  /** Absolute path on disk. */
  path: string
  /** The name the vault goes by in addresses: `http://localhost:4600/<name>/Note`. */
  name: string
  /** Whether it is the vault of the page that asked. */
  current: boolean
  /** `false` if the folder has since been moved or deleted. */
  exists: boolean
}

export interface ExternalPluginInfo {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
}
