#!/usr/bin/env node
import { Command } from 'commander';
import { run } from './core.js';
import { registerHello } from './commands/hello.js';

const program = new Command();

program
    .name('mp')
    .description('MeatProxy CLI')
    .version('1.0.0')
    .action(run);

registerHello(program);

await program.parseAsync();
