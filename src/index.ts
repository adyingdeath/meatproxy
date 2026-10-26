#!/usr/bin/env node
import { Command } from "commander";
import { run } from "./core.js";
import { registerInit } from "./commands/init.js";

const program = new Command();

program
    .name("mtp")
    .description("MeatProxy CLI")
    .version("1.0.1")
    .action(run);

registerInit(program);

await program.parseAsync();
