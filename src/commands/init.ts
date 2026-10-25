import clipboard from "clipboardy";
import type { Command } from "commander";
import { INIT_PROMPT } from "../prompt.js";

export function registerInit(program: Command) {
    program
        .command("init")
        .description("Copy the agent prompt to the clipboard")
        .action(async () => {
            try {
                await clipboard.write(INIT_PROMPT);
            } catch (error) {
                console.log("could not write to the clipboard");
                return;
            }

            console.log("Prompt copied to the clipboard.");
            console.log("Paste it into a web chatbot, add what you want it to do, and send.");
            console.log("Then copy the chatbot's reply back here and run `mtp`.");
        });
}
