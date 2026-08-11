import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { collectFilePaths } from './scanner.js';

function addOperationContext(error, operation, targetPath) {
  const wrapped = new Error(`${operation}: ${targetPath}. ${error.message}`);
  wrapped.code = error.code;
  wrapped.cause = error;
  return wrapped;
}

export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let stream;

    try {
      stream = fs.createReadStream(filePath);
    } catch (error) {
      reject(addOperationContext(error, 'Cannot open file', filePath));
      return;
    }

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (error) => {
      reject(addOperationContext(error, 'Cannot read file', filePath));
    });
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const root = path.resolve(directory);
    const filePaths = await collectFilePaths(root);
    this.emit('search-start', { directory: root, total: filePaths.length });

    const hashes = new Map();

    for (let index = 0; index < filePaths.length; index += 1) {
      const filePath = filePaths[index];
      let stats;

      try {
        stats = await fsPromises.stat(filePath);
      } catch (error) {
        throw addOperationContext(error, 'Cannot get file information', filePath);
      }

      let hash;
      try {
        hash = await calculateHash(filePath);
      } catch (error) {
        this.emit('file-error', { path: filePath, error });
        throw error;
      }

      const group = hashes.get(hash) ?? { hash, size: stats.size, files: [] };
      group.files.push(filePath);
      hashes.set(hash, group);

      this.emit('file-processed', {
        path: filePath,
        hash,
        current: index + 1,
        total: filePaths.length
      });
    }

    const groups = [...hashes.values()]
      .filter((group) => group.files.length > 1)
      .map((group) => ({
        ...group,
        wastedSpace: group.size * (group.files.length - 1)
      }))
      .sort((first, second) => second.wastedSpace - first.wastedSpace);
    const totalWastedSpace = groups.reduce((total, group) => total + group.wastedSpace, 0);
    const result = {
      directory: root,
      totalFiles: filePaths.length,
      groups,
      totalWastedSpace
    };

    this.emit('duplicates-found', result);
    return result;
  }
}

export default DuplicateFinder;
