import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer, categories } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';

const DIVIDER = '━'.repeat(42);

export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function drawProgressBar(current, total, width = 20) {
  const percentage = total === 0 ? 1 : Math.min(current / total, 1);
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

function updateProgress(label, current, total) {
  const line = `${label} ${drawProgressBar(current, total)}`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K${line}`);
    if (current === total) process.stdout.write('\n');
  } else if (current === total || total === 0) {
    console.log(line);
  }
}

function printUsage() {
  console.log(`
file-organizer — analyze and organize files

Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <source> --output <target>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]

Options:
  --output <directory>  Destination for organized copies
  --older-than <days>  Select files older than this number of days
  --confirm            Actually delete selected files (otherwise dry run)
  --help               Show this help
`);
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

function requireDirectory(directory, command) {
  if (!directory || directory.startsWith('--')) {
    throw new Error(`Command "${command}" requires a directory path.`);
  }
  return path.resolve(directory);
}

function printFileList(files) {
  console.log(DIVIDER);
  for (const file of files) {
    console.log(`${file.path}\n  Size: ${formatSize(file.size)}\n  Modified: ${Math.floor(file.daysOld)} days ago (${file.mtime.toISOString().slice(0, 10)})\n`);
  }
  console.log(DIVIDER);
}

async function runScan(directory) {
  const scanner = new Scanner();
  let total = 0;

  scanner.on('scan-start', ({ directory: root }) => console.log(`📂 Scanning: ${root}`));
  scanner.on('files-counted', ({ total: count }) => {
    total = count;
    if (count === 0) updateProgress('Processing...', 0, 0);
  });
  scanner.on('file-found', ({ current }) => updateProgress('Processing...', current, total));

  const statistics = await scanner.scan(directory);

  console.log(`\n📊 Scan Results:\n${DIVIDER}`);
  console.log(`Total files: ${statistics.totalFiles}`);
  console.log(`Total size: ${formatSize(statistics.totalSize)}\n`);
  console.log('By File Type:');
  const types = [...statistics.byType.entries()].sort(
    ([, first], [, second]) => second.totalSize - first.totalSize
  );
  if (types.length === 0) console.log('  No files');
  for (const [extension, data] of types) {
    console.log(`  ${extension.padEnd(10)} ${String(data.count).padStart(4)} files   ${formatSize(data.totalSize)}`);
  }

  console.log('\nFile Age:');
  console.log(`  Last 7 days:     ${statistics.age.last7Days} files`);
  console.log(`  Last 30 days:    ${statistics.age.last30Days} files`);
  console.log(`  Older than 90:   ${statistics.age.olderThan90Days} files`);

  console.log('\nLargest files:');
  if (statistics.largestFiles.length === 0) console.log('  No files');
  statistics.largestFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.path}   ${formatSize(file.size)}`);
  });

  if (statistics.oldestFile) {
    console.log(`\nOldest file: ${statistics.oldestFile.path} (modified ${Math.floor(statistics.oldestFile.daysOld)} days ago)`);
  } else {
    console.log('\nOldest file: none');
  }
}

async function runDuplicates(directory) {
  const finder = new DuplicateFinder();

  finder.on('search-start', ({ directory: root, total }) => {
    console.log(`🔍 Searching for duplicates in: ${root}`);
    if (total === 0) updateProgress('Calculating hashes...', 0, 0);
  });
  finder.on('file-processed', ({ current, total }) => {
    updateProgress('Calculating hashes...', current, total);
  });

  const result = await finder.find(directory);
  console.log(`\nFound ${result.groups.length} duplicate groups (${formatSize(result.totalWastedSpace)} wasted):\n`);

  result.groups.forEach((group, index) => {
    console.log(DIVIDER);
    console.log(`Group ${index + 1} (${group.files.length} copies, ${formatSize(group.size)} each):`);
    console.log(`  SHA-256: ${group.hash}\n`);
    for (const filePath of group.files) console.log(`  📄 ${filePath}`);
    console.log(`\n  Wasted space: ${formatSize(group.wastedSpace)}\n`);
  });
  console.log(DIVIDER);
  console.log(`💾 Total wasted space: ${formatSize(result.totalWastedSpace)}`);
}

async function runOrganize(source, output) {
  const organizer = new Organizer();
  console.log(`📦 Organizing: ${source}\nTarget: ${output}\n\nCreating folders...`);

  organizer.on('folder-created', ({ category }) => console.log(`  ✓ ${category}/`));
  organizer.on('organize-start', ({ total }) => {
    console.log();
    if (total === 0) updateProgress('Copying files...', 0, 0);
  });
  organizer.on('copy-complete', ({ current, total }) => {
    updateProgress('Copying files...', current, total);
  });

  const result = await organizer.organize(source, output);
  console.log('\n✅ Organization complete!\n\nSummary:');
  for (const category of Object.keys(categories)) {
    const data = result.summary[category];
    console.log(`  ${category.padEnd(10)} ${String(data.count).padStart(4)} files → ${path.join(result.output, category)}/`);
  }
  console.log(`\nTotal copied: ${result.totalFiles} files (${formatSize(result.totalSize)})`);
}

async function runCleanup(directory, olderThanDays, confirm) {
  const cleanup = new Cleanup();
  console.log(`🧹 Cleanup: ${directory}\nLooking for files older than ${olderThanDays} days...\n`);

  cleanup.on('files-ready', ({ files, totalFiles, totalSize }) => {
    console.log(`Found ${totalFiles} files to delete:\n`);
    printFileList(files);
    console.log(`\nTotal: ${totalFiles} files (${formatSize(totalSize)})\n`);

    if (confirm && totalFiles > 0) {
      console.log(`⚠️  DELETING ${totalFiles} files (${formatSize(totalSize)}). This action cannot be undone!\n`);
    }
  });
  cleanup.on('file-deleted', ({ current, total }) => {
    updateProgress('Deleting...', current, total);
  });

  const result = await cleanup.cleanup(directory, olderThanDays, confirm);

  if (!confirm) {
    console.log('⚠️  DRY RUN MODE: No files were deleted.');
    console.log('To actually delete these files, run with --confirm flag.');
    return;
  }

  console.log('\n✅ Cleanup complete!');
  console.log(`Deleted: ${result.deletedFiles} files (${formatSize(result.freedSpace)} freed)`);
}

function printError(error) {
  if (error.code === 'ENOENT') {
    console.error(`❌ Error: File or directory not found. ${error.message}`);
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error(`❌ Error: Permission denied. ${error.message}`);
  } else if (error.code === 'ENOTDIR') {
    console.error(`❌ Error: Expected a directory. ${error.message}`);
  } else if (error.code === 'ENOSPC') {
    console.error(`❌ Error: Not enough disk space. ${error.message}`);
  } else if (error.code === 'EEXIST') {
    console.error(`❌ Error: Destination already exists. ${error.message}`);
  } else {
    console.error(`❌ Error: ${error.message}`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const [command, directory] = args;

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'scan') {
    await runScan(requireDirectory(directory, command));
    return;
  }

  if (command === 'duplicates') {
    await runDuplicates(requireDirectory(directory, command));
    return;
  }

  if (command === 'organize') {
    const source = requireDirectory(directory, command);
    const output = optionValue(args, '--output');
    if (!output || output.startsWith('--')) {
      throw new Error('Command "organize" requires --output <target-directory>.');
    }
    await runOrganize(source, path.resolve(output));
    return;
  }

  if (command === 'cleanup') {
    const root = requireDirectory(directory, command);
    const value = optionValue(args, '--older-than');
    const olderThanDays = Number(value);
    if (value === undefined || !Number.isFinite(olderThanDays) || olderThanDays < 0) {
      throw new Error('Command "cleanup" requires --older-than with a non-negative number of days.');
    }
    await runCleanup(root, olderThanDays, args.includes('--confirm'));
    return;
  }

  throw new Error(`Unknown command: ${command}. Run with --help to see available commands.`);
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch((error) => {
    printError(error);
    process.exitCode = 1;
  });
}
