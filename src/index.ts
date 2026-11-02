#!/usr/bin/env node
import { Command } from "commander";
import { run } from "./runner/core.js";
import { registerInit } from "./commands/init.js";

const program = new Command();

program
    .name("mtp")
    .description("MeatProxy CLI")
    .version(__VERSION__)
    .addHelpText("after", `
Usage:
  1. mtp init | copy the agent prompt to the clipboard
  2.          | paste it into a web chatbot and describe what you want
  3.          | copy the chatbot's reply
  4. mtp      | run the snippet locally; its output is copied back to the clipboard
  5.          | paste the output back to the chatbot and repeat

Snippets run with the same access as your terminal; only run replies you trust.
`)
    .action(run);

registerInit(program);

await program.parseAsync();
