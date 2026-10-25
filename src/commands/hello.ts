import type { Command } from 'commander';

export function registerHello(program: Command) {
  program
    .command('hello')
    .description('Say hello')
    .argument('<name>', 'name to greet')
    .option('-u, --uppercase', 'uppercase output', false)
    .action((name: string, opts: { uppercase: boolean }) => {
      let msg = `Hello, ${name}!`;
      if (opts.uppercase) msg = msg.toUpperCase();
      console.log(msg);
    });
}