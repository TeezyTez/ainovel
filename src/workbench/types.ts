export type ArtifactStage =
  | 'queued' | 'understanding' | 'generating' | 'building' | 'checking'
  | 'repairing' | 'ready' | 'failed' | 'cancelled';

export interface ArtifactRevision {
  id: string;
  title?: string;
  reason?: string;
  createdAt?: string;
}

export interface ArtifactWorkbenchProps {
  title?: string;
  summary?: string;
  /** Trusted host-rendered legacy markup. Model source must remain in its sandbox. */
  html?: string;
  busy?: boolean;
  stage?: ArtifactStage | string;
  error?: string | null;
  revisions?: readonly ArtifactRevision[];
  currentRevision?: string | null;
  onRestore?: (revisionId: string) => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onExport?: () => void | Promise<void>;
  onImport?: (file: File) => void | Promise<void>;
  /** Called after changed markup is installed. Return cleanup for bound controls. */
  onContentMount?: (island: HTMLDivElement) => void | (() => void);
}

export interface ArtifactWorkbenchHandle {
  update(props: ArtifactWorkbenchProps): void;
  dispose(): void;
}
