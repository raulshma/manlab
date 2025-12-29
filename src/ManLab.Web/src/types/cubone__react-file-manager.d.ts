// Minimal typings for @cubone/react-file-manager.
// The package currently ships JS without TypeScript declarations.

declare module "@cubone/react-file-manager" {
  export type FileManagerLayout = "list" | "grid" | string;

  export type FileManagerPermissions = {
    create?: boolean;
    upload?: boolean;
    move?: boolean;
    copy?: boolean;
    rename?: boolean;
    delete?: boolean;
    download?: boolean;
  };

  export type FileManagerFileLike = {
    name?: string;
    path?: string;
    isDirectory?: boolean;
    size?: number;
    updatedAt?: string | Date;
    // Allow extra fields coming from the backend/app.
    [key: string]: unknown;
  };

  export type FileManagerProps<TFile extends FileManagerFileLike = FileManagerFileLike> = {
    files: TFile[];
    isLoading?: boolean;
    initialPath?: string;
    onFolderChange?: (path: string) => void;
    onFileOpen?: (file: TFile) => void;
    onRefresh?: () => void;
    onDownload?: (items: TFile[]) => void;
    permissions?: FileManagerPermissions;
    enableFilePreview?: boolean;
    layout?: FileManagerLayout;
    height?: number | string;
    width?: number | string;
  };

  export const FileManager: <TFile extends FileManagerFileLike = FileManagerFileLike>(
    props: FileManagerProps<TFile>
  ) => import("react").ReactElement | null;
}
