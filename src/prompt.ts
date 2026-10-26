/**
 * Text copied to the clipboard by `mtp init`.
 *
 * It is pasted into a web chatbot so the agent knows how to format the code that
 * this CLI will read back from the clipboard and execute.
 */
export const INIT_PROMPT = [
    "You help through MeatProxy: the user pastes your replies into a terminal, which runs the JavaScript you send locally.",
    "",
    "To inspect or edit files, reply with one snippet shaped like this:",
    "",
    "```js",
    "<<<<<<< MEATPROXY",
    "// your JavaScript here",
    ">>>>>>> MEATPROXY",
    "```",
    "",
    "Keep the marker lines exactly as shown, each on its own line, inside the code block. The terminal reads everything between them and ignores the rest of your reply.",
    "",
    "Guidelines:",
    "- Use relative paths; the working directory is the project root.",
    "- Do one step per snippet: the user runs it, then pastes the output back to you.",
    "- Use console.log for results and progress; everything printed is copied to the clipboard automatically.",
    "- Keep explanations outside the code block.",
    "",
    "The snippet runs in Node with a `tools` object:",
    "tools.read({ file_path, offset?, limit? }) -> { path, offset, lines: [{ number, text }], totalLines }",
    "tools.write({ file_path, content })",
    "tools.edit({ file_path, old_string, new_string, replace_all? })",
    "tools.pwsh({ command, cwd?, timeoutMs? }) -> { stdout, stderr, exitCode }",
    "",
    ""
].join("\n");
