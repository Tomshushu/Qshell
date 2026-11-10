import { describe, it, expect } from "vitest";
import type { SyncFileItem } from "@/services/api/types";
import type {
  SyncDirection,
  SyncCompareMode,
  DiffCategory,
  SyncAction,
} from "../directory-sync-wizard-dialog";

function normalizeRelativePath(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function joinRelativePath(base: string, relativePath: string): string {
  if (!base) return relativePath;
  const isWindows = base.includes("\\") || /^[a-zA-Z]:/.test(base);
  const sep = isWindows ? "\\" : "/";
  const normalizedBase = isWindows ? base.replace(/\//g, "\\") : base.replace(/\\/g, "/");
  const normalizedRel = isWindows
    ? relativePath.replace(/\//g, "\\")
    : relativePath.replace(/\\/g, "/");
  const trimmed = normalizedBase.endsWith(sep)
    ? normalizedBase.slice(0, -1)
    : normalizedBase;
  return `${trimmed}${sep}${normalizedRel}`;
}

function getRelativeParent(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

interface ComputeDiffOptions {
  sourceFiles: SyncFileItem[];
  targetFiles: SyncFileItem[];
  direction: SyncDirection;
  compareMode: SyncCompareMode;
  mirrorDelete: boolean;
}

function computeDiffItems(opts: ComputeDiffOptions) {
  const srcMap = new Map<string, SyncFileItem>();
  opts.sourceFiles.forEach((item) => {
    const norm = normalizeRelativePath(item.relativePath);
    if (norm) srcMap.set(norm, item);
  });

  const tgtMap = new Map<string, SyncFileItem>();
  opts.targetFiles.forEach((item) => {
    const norm = normalizeRelativePath(item.relativePath);
    if (norm) tgtMap.set(norm, item);
  });

  const allKeys = new Set<string>([...srcMap.keys(), ...tgtMap.keys()]);
  const result: Array<{
    id: string;
    relativePath: string;
    name: string;
    isDirectory: boolean;
    category: DiffCategory;
    action: SyncAction;
    selected: boolean;
  }> = [];

  allKeys.forEach((key) => {
    const src = srcMap.get(key);
    const tgt = tgtMap.get(key);
    const name = (src || tgt)?.name || key.split("/").pop() || "";
    const isDirectory = Boolean((src || tgt)?.isDirectory);

    let category: DiffCategory = "identical";
    let action: SyncAction = "none";

    if (src && !tgt) {
      category = "only_in_source";
      action = "copy_to_target";
    } else if (!src && tgt) {
      category = "only_in_target";
      if (opts.direction === "bidirectional") {
        action = "copy_to_source";
      } else if (opts.mirrorDelete) {
        action = "delete_from_target";
      } else {
        action = "none";
      }
    } else if (src && tgt) {
      if (src.isDirectory !== tgt.isDirectory) {
        category = "type_mismatch";
        action = "update_target";
      } else if (src.isDirectory && tgt.isDirectory) {
        category = "identical";
        action = "none";
      } else {
        const sizeMatch = src.size === tgt.size;
        const srcTime = src.modifiedTime ? new Date(src.modifiedTime).getTime() : 0;
        const tgtTime = tgt.modifiedTime ? new Date(tgt.modifiedTime).getTime() : 0;
        const timeMatch = Math.abs(srcTime - tgtTime) <= 2000;

        if (!sizeMatch) {
          category = "size_mismatch";
          if (opts.direction === "bidirectional") {
            action = srcTime >= tgtTime ? "update_target" : "update_source";
          } else {
            action = "update_target";
          }
        } else if (opts.compareMode === "size_and_mtime" && !timeMatch) {
          category = "time_mismatch";
          if (opts.direction === "bidirectional") {
            action = srcTime >= tgtTime ? "update_target" : "update_source";
          } else {
            action = "update_target";
          }
        } else {
          category = "identical";
          action = "none";
        }
      }
    }

    const selected = action !== "none";
    result.push({
      id: key,
      relativePath: key,
      name,
      isDirectory,
      category,
      action,
      selected,
    });
  });

  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

describe("Directory Sync Wizard Logic", () => {
  describe("Path Normalization & Resolution", () => {
    it("normalizes POSIX and Windows relative paths correctly", () => {
      expect(normalizeRelativePath("foo\\bar\\baz.txt")).toBe("foo/bar/baz.txt");
      expect(normalizeRelativePath("/foo/bar/baz.txt/")).toBe("foo/bar/baz.txt");
      expect(normalizeRelativePath("\\foo\\bar\\baz.txt\\")).toBe("foo/bar/baz.txt");
      expect(normalizeRelativePath("single.txt")).toBe("single.txt");
    });

    it("joins relative paths properly for Windows base paths", () => {
      expect(joinRelativePath("C:\\workspace\\project", "src/index.ts")).toBe(
        "C:\\workspace\\project\\src\\index.ts"
      );
      expect(joinRelativePath("D:/data", "images/logo.png")).toBe(
        "D:\\data\\images\\logo.png"
      );
    });

    it("joins relative paths properly for POSIX remote base paths", () => {
      expect(joinRelativePath("/var/www/html", "dist/bundle.js")).toBe(
        "/var/www/html/dist/bundle.js"
      );
      expect(joinRelativePath("/var/www/html/", "dist/bundle.js")).toBe(
        "/var/www/html/dist/bundle.js"
      );
    });

    it("extracts parent directory from relative path", () => {
      expect(getRelativeParent("a/b/c.txt")).toBe("a/b");
      expect(getRelativeParent("single.txt")).toBe("");
      expect(getRelativeParent("dir/subdir/")).toBe("dir");
    });
  });

  describe("Diff Calculation - Source to Target (Incremental Deploy)", () => {
    const sourceFiles: SyncFileItem[] = [
      {
        relativePath: "new-file.txt",
        name: "new-file.txt",
        isDirectory: false,
        size: 1024,
        modifiedTime: "2026-11-09T10:00:00Z",
      },
      {
        relativePath: "common.txt",
        name: "common.txt",
        isDirectory: false,
        size: 2048,
        modifiedTime: "2026-11-09T12:00:00Z",
      },
      {
        relativePath: "same.txt",
        name: "same.txt",
        isDirectory: false,
        size: 512,
        modifiedTime: "2026-11-09T10:00:00Z",
      },
    ];

    const targetFiles: SyncFileItem[] = [
      {
        relativePath: "common.txt",
        name: "common.txt",
        isDirectory: false,
        size: 1024, // size differs!
        modifiedTime: "2026-11-09T08:00:00Z",
      },
      {
        relativePath: "same.txt",
        name: "same.txt",
        isDirectory: false,
        size: 512, // size matches
        modifiedTime: "2026-11-09T10:00:00Z", // time matches
      },
      {
        relativePath: "orphan-target.txt",
        name: "orphan-target.txt",
        isDirectory: false,
        size: 4096,
        modifiedTime: "2026-11-09T09:00:00Z",
      },
    ];

    it("identifies new, modified, identical and ignored orphan files without mirror delete", () => {
      const diff = computeDiffItems({
        sourceFiles,
        targetFiles,
        direction: "source_to_target",
        compareMode: "size_and_mtime",
        mirrorDelete: false,
      });

      const newFile = diff.find((d) => d.relativePath === "new-file.txt");
      expect(newFile?.category).toBe("only_in_source");
      expect(newFile?.action).toBe("copy_to_target");
      expect(newFile?.selected).toBe(true);

      const modified = diff.find((d) => d.relativePath === "common.txt");
      expect(modified?.category).toBe("size_mismatch");
      expect(modified?.action).toBe("update_target");
      expect(modified?.selected).toBe(true);

      const same = diff.find((d) => d.relativePath === "same.txt");
      expect(same?.category).toBe("identical");
      expect(same?.action).toBe("none");
      expect(same?.selected).toBe(false);

      const orphan = diff.find((d) => d.relativePath === "orphan-target.txt");
      expect(orphan?.category).toBe("only_in_target");
      expect(orphan?.action).toBe("none");
      expect(orphan?.selected).toBe(false);
    });

    it("marks orphan files for deletion when mirrorDelete is enabled", () => {
      const diff = computeDiffItems({
        sourceFiles,
        targetFiles,
        direction: "source_to_target",
        compareMode: "size_and_mtime",
        mirrorDelete: true,
      });

      const orphan = diff.find((d) => d.relativePath === "orphan-target.txt");
      expect(orphan?.category).toBe("only_in_target");
      expect(orphan?.action).toBe("delete_from_target");
      expect(orphan?.selected).toBe(true);
    });

    it("ignores timestamp difference when compareMode is size_only", () => {
      const srcWithDiffTime: SyncFileItem[] = [
        {
          relativePath: "doc.pdf",
          name: "doc.pdf",
          isDirectory: false,
          size: 1000,
          modifiedTime: "2026-11-09T14:00:00Z",
        },
      ];
      const tgtWithDiffTime: SyncFileItem[] = [
        {
          relativePath: "doc.pdf",
          name: "doc.pdf",
          isDirectory: false,
          size: 1000,
          modifiedTime: "2026-11-08T14:00:00Z", // 1 day earlier
        },
      ];

      // In size_only mode -> identical
      const diffSizeOnly = computeDiffItems({
        sourceFiles: srcWithDiffTime,
        targetFiles: tgtWithDiffTime,
        direction: "source_to_target",
        compareMode: "size_only",
        mirrorDelete: false,
      });
      expect(diffSizeOnly[0].category).toBe("identical");
      expect(diffSizeOnly[0].action).toBe("none");

      // In size_and_mtime mode -> time_mismatch -> update_target
      const diffWithTime = computeDiffItems({
        sourceFiles: srcWithDiffTime,
        targetFiles: tgtWithDiffTime,
        direction: "source_to_target",
        compareMode: "size_and_mtime",
        mirrorDelete: false,
      });
      expect(diffWithTime[0].category).toBe("time_mismatch");
      expect(diffWithTime[0].action).toBe("update_target");
    });
  });

  describe("Diff Calculation - Bidirectional Sync", () => {
    it("resolves newer file to overwrite older file and pulls orphan files to source", () => {
      const sourceFiles: SyncFileItem[] = [
        {
          relativePath: "fileA.txt",
          name: "fileA.txt",
          isDirectory: false,
          size: 100,
          modifiedTime: "2026-11-09T14:00:00Z", // Newer on Source
        },
        {
          relativePath: "fileB.txt",
          name: "fileB.txt",
          isDirectory: false,
          size: 100,
          modifiedTime: "2026-11-09T10:00:00Z", // Older on Source
        },
        {
          relativePath: "source-only.txt",
          name: "source-only.txt",
          isDirectory: false,
          size: 50,
          modifiedTime: "2026-11-09T12:00:00Z",
        },
      ];

      const targetFiles: SyncFileItem[] = [
        {
          relativePath: "fileA.txt",
          name: "fileA.txt",
          isDirectory: false,
          size: 200,
          modifiedTime: "2026-11-09T12:00:00Z", // Older on Target
        },
        {
          relativePath: "fileB.txt",
          name: "fileB.txt",
          isDirectory: false,
          size: 200,
          modifiedTime: "2026-11-09T15:00:00Z", // Newer on Target
        },
        {
          relativePath: "target-only.txt",
          name: "target-only.txt",
          isDirectory: false,
          size: 80,
          modifiedTime: "2026-11-09T13:00:00Z",
        },
      ];

      const diff = computeDiffItems({
        sourceFiles,
        targetFiles,
        direction: "bidirectional",
        compareMode: "size_and_mtime",
        mirrorDelete: false,
      });

      // fileA is newer on source -> update_target
      const fileA = diff.find((d) => d.relativePath === "fileA.txt");
      expect(fileA?.action).toBe("update_target");

      // fileB is newer on target -> update_source
      const fileB = diff.find((d) => d.relativePath === "fileB.txt");
      expect(fileB?.action).toBe("update_source");

      // source-only -> copy_to_target
      const srcOnly = diff.find((d) => d.relativePath === "source-only.txt");
      expect(srcOnly?.action).toBe("copy_to_target");

      // target-only -> copy_to_source
      const tgtOnly = diff.find((d) => d.relativePath === "target-only.txt");
      expect(tgtOnly?.action).toBe("copy_to_source");
    });
  });
});
