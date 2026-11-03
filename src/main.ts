import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { compose } from './composition-root.ts';
import { InvalidTokenError, TokenMissingError } from './infrastructure/github/token.ts';

try {
  const server = await compose(process.env);
  // stdout carries the MCP protocol and nothing else; diagnostics go to stderr.
  await server.connect(new StdioServerTransport());
} catch (error) {
  if (error instanceof TokenMissingError || error instanceof InvalidTokenError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
