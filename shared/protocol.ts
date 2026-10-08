/** Types shared by the server and the browser client. */

export interface VaultEntry {
  /** Vault-relative path with forward slashes, e.g. `Projects/Plan.md`. */
  path: string
  kind: 'file' | 'folder'
  size: number
  mtime: number
  /** When the file was created. */
  ctime: number
}

export type RemoteEvent = { type: 'upsert'; entry: VaultEntry } | { type: 'delete'; path: string }

export interface ExternalPluginInfo {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
}
