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

export type RemoteEvent =
  | { type: 'upsert'; entry: VaultEntry }
  | { type: 'delete'; path: string }
  /** The server switched to another vault; pages must start over. */
  | { type: 'vault' }

/** A folder the user has opened as a vault. */
export interface VaultInfo {
  /** Absolute path on disk. */
  path: string
  name: string
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
