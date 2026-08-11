import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectFilePaths } from './scanner.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function addOperationContext(error, operation, targetPath) {
  const wrapped = new Error(`${operation}: ${targetPath}. ${error.message}`);
  wrapped.code = error.code;
  wrapped.cause = error;
  return wrapped;
}

export class Cleanup extends EventEmitter {
  async cleanup(directory, olderThanDays, confirm = false) {
    const root = path.resolve(directory);
    const filePaths = await collectFilePaths(root);
    this.emit('cleanup-start', {
      directory: root,
      olderThanDays,
      confirm,
      total: filePaths.length
    });

    const oldFiles = [];
    const now = Date.now();

    for (const filePath of filePaths) {
      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch (error) {
        throw addOperationContext(error, 'Cannot get file information', filePath);
      }

      const daysOld = Math.max(0, (now - stats.mtimeMs) / DAY_MS);
      if (daysOld > olderThanDays) {
        const fileData = {
          path: filePath,
          name: path.basename(filePath),
          size: stats.size,
          mtime: stats.mtime,
          daysOld
        };
        oldFiles.push(fileData);
        this.emit('file-found', fileData);
      }
    }

    const totalSize = oldFiles.reduce((total, file) => total + file.size, 0);
    let deletedFiles = 0;
    let freedSpace = 0;

    this.emit('files-ready', {
      files: oldFiles,
      totalFiles: oldFiles.length,
      totalSize,
      confirm
    });

    if (confirm) {
      for (const file of oldFiles) {
        try {
          await fs.unlink(file.path);
        } catch (error) {
          throw addOperationContext(error, 'Cannot delete file', file.path);
        }

        deletedFiles += 1;
        freedSpace += file.size;
        this.emit('file-deleted', {
          ...file,
          current: deletedFiles,
          total: oldFiles.length
        });
      }
    }

    const result = {
      directory: root,
      olderThanDays,
      confirm,
      files: oldFiles,
      totalFiles: oldFiles.length,
      totalSize,
      deletedFiles,
      freedSpace
    };
    this.emit('cleanup-complete', result);
    return result;
  }
}

export default Cleanup;
