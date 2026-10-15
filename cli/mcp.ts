#!/usr/bin/env node
import { Command } from 'commander';
import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createGaterunnerMcpServer } from './mcpServer.js';

export async function main(argv = process.argv) {
  const program = new Command().name('gaterunner-mcp')
    .description('GateRunner local MCP server over standard input/output')
    .option('--workspace <directory>', 'Directory containing projects and generated files', process.cwd());
  program.parse(argv);
  const server = await createGaterunnerMcpServer({ workspace: program.opts<{ workspace: string }>().workspace });
  const handle = serveStdio(() => server);
  process.once('SIGINT', () => { void handle.close(); });
  process.once('SIGTERM', () => { void handle.close(); });
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
