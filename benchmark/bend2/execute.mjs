import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [bendRoot, sourceFile] = process.argv.slice(2);
const metadataFd = 3;
const signals = { parse: 'not_run', type: 'not_run', ownership: 'not_run' };

const detail = (error, Bend) => {
  if (error && error.$ === 'Err') {
    try { return Bend.err_show(error); } catch {}
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
};
const finish = (value) => {
  fs.writeSync(metadataFd, JSON.stringify({ signals, ...value }) + '\n');
};
const recordSignal = (stage, status) => {
  signals[stage] = status;
  fs.writeSync(metadataFd, JSON.stringify({ event: 'signal', stage, status }) + '\n');
};

try {
  const Bend = await import(pathToFileURL(`${bendRoot}/bend2/bend.ts`).href);
  const Comp = await import(pathToFileURL(`${bendRoot}/bend2/comp.ts`).href);
  const book = Bend.book_nil();
  try {
    await Bend.book_load(book, sourceFile, '', new Map());
    recordSignal('parse', 'pass');
  } catch (error) {
    recordSignal('parse', 'fail');
    finish({ status: 'compile_error', detail: detail(error, Bend) });
    process.exit(0);
  }
  try {
    Bend.book_valid(book, 0);
    recordSignal('type', 'pass');
  } catch (error) {
    recordSignal('type', 'fail');
    finish({ status: 'compile_error', detail: detail(error, Bend) });
    process.exit(0);
  }
  try {
    Comp.book_owned(book, Comp.SYNTH);
    recordSignal('ownership', 'pass');
  } catch (error) {
    recordSignal('ownership', 'fail');
    finish({ status: 'compile_error', detail: detail(error, Bend) });
    process.exit(0);
  }
  if (book.hols + book.open > 0) {
    finish({ status: 'compile_error', detail: `Bend reports ${book.hols + book.open} unfilled holes.` });
    process.exit(0);
  }
  try {
    const compiled = path.join(path.dirname(sourceFile), 'main.cjs');
    try {
      fs.writeFileSync(compiled, Comp.js_book(book));
    } catch (error) {
      finish({ status: 'compile_error', detail: detail(error, Bend) });
      process.exit(0);
    }
    const run = childProcess.spawnSync(process.execPath, [compiled], { encoding: 'utf8' });
    process.stdout.write(run.stdout ?? '');
    process.stderr.write(run.stderr ?? '');
    if (run.error) throw run.error;
    const exitCode = run.status ?? 1;
    finish(exitCode === 0 ? { status: 'ran', exitCode } : { status: 'runtime_error', exitCode, detail: `Bend main exited with ${exitCode}.` });
  } catch (error) {
    finish({ status: 'runtime_error', detail: detail(error, Bend) });
  }
} catch (error) {
  finish({ status: 'runtime_error', detail: error instanceof Error ? error.stack ?? error.message : String(error) });
}
