import type { OkResponse } from '../common.js';
import type { ArtifactKind, ArtifactManifest } from './artifacts.js';

export type ProjectFileKind =
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'text'
  | 'code'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'binary';

// Surfaced when the daemon's stub-guard runs in `warn` mode and detects a
// likely regression (the agent emitted a placeholder body that is much
// smaller than a prior artifact sharing the same `metadata.identifier`).
// In `reject` mode the daemon returns `422 ARTIFACT_REGRESSION` instead and
// no `ProjectFile` is produced.
export interface ProjectFileStubGuardWarning {
  code: 'ARTIFACT_REGRESSION';
  message: string;
  identifier: string;
  newSize: number;
  priorSize: number;
  priorName: string;
}

export interface ProjectFile {
  name: string;
  path?: string;
  type?: 'file' | 'dir';
  size: number;
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
  artifactKind?: ArtifactKind;
  artifactManifest?: ArtifactManifest;
  stubGuardWarning?: ProjectFileStubGuardWarning;
}

export interface ProjectFilesResponse {
  files: ProjectFile[];
}

export interface ProjectFileResponse {
  file: ProjectFile;
}

export interface UploadProjectFilesResponse extends ProjectFilesResponse {}

export interface DeleteProjectFileResponse extends OkResponse {}

export interface RenameProjectFileRequest {
  from: string;
  to: string;
}

export interface RenameProjectFileResponse {
  file: ProjectFile;
  oldName: string;
  newName: string;
}

// Hierarchical view of a project's files. Used by the Explorer sidebar.
// Paths are forward-slash, relative to the project root. A directory's
// `children` is omitted (not present in JSON at all) when the node is
// known to be a directory but its contents have not been loaded yet —
// callers should treat that state as "expandable but unloaded".
export interface ProjectTreeNode {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  mtime?: number;
  fileKind?: ProjectFileKind;
  mime?: string;
  children?: ProjectTreeNode[];
  /** Number of children inside a directory, including hidden ones — useful
   * for showing a hint when the directory was elided (e.g. node_modules
   * collapsed by default). */
  childCount?: number;
}

export interface ProjectTreeResponse {
  /** The path the tree was rooted at, relative to project root.
   * Empty string means project root. */
  root: string;
  nodes: ProjectTreeNode[];
}
