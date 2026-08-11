import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { collectFilePaths } from './scanner.js';

export const LARGE_FILE_SIZE = 10 * 1024 * 1024;

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: []
};

function addOperationContext(error, operation, targetPath) {
  const wrapped = new Error(`${operation}: ${targetPath}. ${error.message}`);
  wrapped.code = error.code;
  wrapped.cause = error;
  return wrapped;
}

export function getCategory(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(extension)) return category;
  }

  return 'Other';
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw addOperationContext(error, 'Cannot check destination', targetPath);
  }
}

async function getAvailableTarget(directory, fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let suffix = 1;

  while (await pathExists(candidate)) {
    candidate = path.join(directory, `${baseName}(${suffix})${extension}`);
    suffix += 1;
  }

  return candidate;
}

async function copyFile(sourcePath, targetPath, size) {
  if (size >= LARGE_FILE_SIZE) {
    try {
      await pipeline(
        fs.createReadStream(sourcePath),
        fs.createWriteStream(targetPath, { flags: 'wx' })
      );
    } catch (error) {
      if (error.code !== 'EEXIST') {
        try {
          await fsPromises.unlink(targetPath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            error.message += ` Partial file could not be removed: ${cleanupError.message}`;
          }
        }
      }
      throw addOperationContext(error, 'Cannot stream-copy file', sourcePath);
    }
    return 'stream';
  }

  try {
    await fsPromises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    return 'copyFile';
  } catch (error) {
    throw addOperationContext(error, 'Cannot copy file', sourcePath);
  }
}

export class Organizer extends EventEmitter {
  async organize(sourceDirectory, outputDirectory) {
    const source = path.resolve(sourceDirectory);
    const output = path.resolve(outputDirectory);

    if (source === output) {
      const error = new Error('Source and output directories must be different.');
      error.code = 'EINVAL';
      throw error;
    }

    const outputIsInsideSource = output.startsWith(`${source}${path.sep}`);
    const filePaths = await collectFilePaths(source, outputIsInsideSource ? output : null);

    for (const category of Object.keys(categories)) {
      const categoryPath = path.join(output, category);
      try {
        await fsPromises.mkdir(categoryPath, { recursive: true });
      } catch (error) {
        throw addOperationContext(error, 'Cannot create directory', categoryPath);
      }
      this.emit('folder-created', { category, path: categoryPath });
    }

    this.emit('organize-start', { source, output, total: filePaths.length });

    const summary = Object.fromEntries(
      Object.keys(categories).map((category) => [category, { count: 0, totalSize: 0 }])
    );
    let totalSize = 0;

    for (let index = 0; index < filePaths.length; index += 1) {
      const sourcePath = filePaths[index];
      const category = getCategory(sourcePath);
      let stats;

      try {
        stats = await fsPromises.stat(sourcePath);
      } catch (error) {
        const contextualError = addOperationContext(error, 'Cannot get file information', sourcePath);
        this.emit('copy-error', { source: sourcePath, error: contextualError });
        throw contextualError;
      }

      let targetPath;
      try {
        targetPath = await getAvailableTarget(path.join(output, category), path.basename(sourcePath));
      } catch (error) {
        this.emit('copy-error', { source: sourcePath, error });
        throw error;
      }

      this.emit('copy-start', {
        source: sourcePath,
        target: targetPath,
        category,
        size: stats.size
      });

      try {
        const method = await copyFile(sourcePath, targetPath, stats.size);
        summary[category].count += 1;
        summary[category].totalSize += stats.size;
        totalSize += stats.size;
        this.emit('copy-complete', {
          source: sourcePath,
          target: targetPath,
          category,
          size: stats.size,
          method,
          current: index + 1,
          total: filePaths.length
        });
      } catch (error) {
        this.emit('copy-error', { source: sourcePath, target: targetPath, error });
        throw error;
      }
    }

    const result = {
      source,
      output,
      totalFiles: filePaths.length,
      totalSize,
      summary
    };
    this.emit('organize-complete', result);
    return result;
  }
}

export default Organizer;
