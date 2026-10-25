# MeatProxy

> A meat proxy is a person who acts as an unthinking relay for AI-generated text, code, or other outputs by copying and pasting them to others without reading, validating, or adding personal insight.

MeatProxy helps you be a better meat proxy.

It is a small bridge between your clipboard and chatbots: paste the prompt into the chat, ask for a change, copy the reply, then run `mtp` in the terminal. The code runs against your project, and everything it prints is copied back to the clipboard, ready for the next round.

## Requirements

- Node.js 22.12 or newer
- PowerShell (`pwsh` or Windows PowerShell) if you use the `pwsh` tool

## Install

```sh
npm install -g @adyingdeath/meatproxy
```

This provides the `mtp` command (also available as `meatproxy`).

## Usage

```sh
# 1. copy the agent prompt to the clipboard
mtp init

# 2. paste it into a web chatbot and say what you want

# 3. copy the chatbot's reply, then run
mtp
```

`mtp init` copies the prompt and prints what to do next. `mtp` reads the clipboard, extracts the snippet, runs it, prints the output, and copies that output back to the clipboard.

The snippet runs with the same access as your terminal, so only paste replies you trust.

## Tools

The snippet gets a `tools` object with four methods: `read`, `write`, `edit` and `pwsh`, enough to inspect files, change them, and run PowerShell commands.

## Development

```sh
npm install
npm run build # bundles to dist/
npm run dev # runs src/index.ts directly
```
