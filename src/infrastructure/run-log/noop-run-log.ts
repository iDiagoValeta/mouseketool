import type { RunLog } from '../../application/ports/run-log.ts';

export class NoopRunLog implements RunLog {
  async record(): Promise<void> {}
}
