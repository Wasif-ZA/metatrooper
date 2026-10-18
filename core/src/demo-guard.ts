import { demoProblem } from './paths.ts';

// main.ts imports this first, so a --demo core exits before anything opens the data folder, a pipe or settings
if (process.argv.includes('--demo')) {
  const problem = demoProblem(process.env.METATROOPER_HOME, process.env.METATROOPER_PIPE_PREFIX);
  if (problem) {
    console.error(`metatrooper core --demo refused: ${problem}`);
    process.exit(2);
  }
}
