#!/usr/bin/env node
import { Command } from 'commander';
import { registerHello } from './commands/hello.js';

const program = new Command();

program
  .name('mp')
  .description('MeatProxy CLI')
  .version('1.0.0');

registerHello(program);
program.parse();