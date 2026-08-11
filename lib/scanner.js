import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

function addOperationContext(error, operation, targetPath) {
  const wrapped = new Error(`${operation}: ${targetPath}. ${error.message}`);
  wrapped.code = error.code;
  wrapped.cause = error;
  return wrapped;
}

export async function collectFilePaths(directory, excludedDirectory = null) {
  const result = [];
  const root = path.resolve(directory);
  const excluded = excludedDirectory ? path.resolve(excludedDirectory) : null;

  async function walk(currentDirectory) {
    let entries;

    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      throw addOperationContext(error, 'Cannot read directory', currentDirectory);
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (excluded && (entryPath === excluded || entryPath.startsWith(`${excluded}${path.sep}`))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        result.push(entryPath);
      }
    }
  }

  await walk(root);
  return result;
}

export class Scanner extends EventEmitter {
  async scan(directory) {
    const root = path.resolve(directory);
    this.emit('scan-start', { directory: root });

    const filePaths = await collectFilePaths(root);
    this.emit('files-counted', { total: filePaths.length });

    const now = Date.now();
    const byType = new Map();
    const files = [];
    let totalSize = 0;
    let last7Days = 0;
    let last30Days = 0;
    let olderThan90Days = 0;

    for (let index = 0; index < filePaths.length; index += 1) {
      const filePath = filePaths[index];
      let stats;

      try {
        stats = await fs.stat(filePath);
      } catch (error) {
        throw addOperationContext(error, 'Cannot get file information', filePath);
      }

      const extension = path.extname(filePath).toLowerCase() || '(other)';
      const daysOld = Math.max(0, (now - stats.mtimeMs) / DAY_MS);
      const fileData = {
        path: filePath,
        name: path.basename(filePath),
        extension,
        size: stats.size,
        mtime: stats.mtime,
        daysOld
      };

      files.push(fileData);
      totalSize += stats.size;

      const typeData = byType.get(extension) ?? { count: 0, totalSize: 0 };
      typeData.count += 1;
      typeData.totalSize += stats.size;
      byType.set(extension, typeData);

      if (daysOld <= 7) last7Days += 1;
      if (daysOld <= 30) last30Days += 1;
      if (daysOld > 90) olderThan90Days += 1;

      this.emit('file-found', {
        ...fileData,
        current: index + 1,
        total: filePaths.length
      });
    }

    const largestFiles = [...files]
      .sort((first, second) => second.size - first.size)
      .slice(0, 3);
    const oldestFile = files.length
      ? files.reduce((oldest, file) => (file.mtime < oldest.mtime ? file : oldest))
      : null;

    const statistics = {
      directory: root,
      totalFiles: files.length,
      totalSize,
      byType,
      age: { last7Days, last30Days, olderThan90Days },
      largestFiles,
      oldestFile,
      files
    };

    this.emit('scan-complete', statistics);
    return statistics;
  }
}

export default Scanner;
