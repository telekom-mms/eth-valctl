import { describe, expect, it } from 'bun:test';

const CLI_ENTRYPOINT = 'src/cli/main.ts';

async function runCli(
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI_ENTRYPOINT, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  return { exitCode, stdout, stderr };
}

describe('CLI entrypoint', () => {
  describe('global request fee options', () => {
    it('lists --max-request-fee with -x alias in help', async () => {
      const result = await runCli(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('-x, --max-request-fee <amount>');
      expect(result.stdout).toContain('default: 10wei');
    });

    it('lists --max-request-fee-wait-blocks and global --yes in help', async () => {
      const result = await runCli(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('-w, --max-request-fee-wait-blocks <blocks>');
      expect(result.stdout).toContain('-y, --yes');
      expect(result.stdout).toContain('default: 50');
    });

    it('rejects bare max-request-fee numbers before command execution', async () => {
      const result = await runCli(['--max-request-fee', '1000', 'fees', 'consolidate']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('wei/gwei/eth');
    });
  });

  describe('fees command', () => {
    it('lists all supported request types in help', async () => {
      const result = await runCli(['fees', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: eth-valctl fees');
      expect(result.stdout).toContain('consolidate');
      expect(result.stdout).toContain('switch');
      expect(result.stdout).toContain('withdraw');
      expect(result.stdout).toContain('exit');
    });

    it('accepts total request count alias and global batch size and fee cap', async () => {
      const result = await runCli(['-x', '5wei', '-m', '5', 'fees', 'consolidate', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('-c, --total-request-count <count>');
      expect(result.stdout).not.toContain('-m, --max-requests-per-block');
      expect(result.stdout).not.toContain('-x, --max-request-fee');
    });

    it('executes the command body and exits non-zero when the RPC is unreachable', async () => {
      const result = await runCli(['-r', 'http://127.0.0.1:1', 'fees', 'consolidate']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ECONNREFUSED');
    });
  });

  describe('Safe command option ownership', () => {
    it('does not expose a safe sign specific --yes option', async () => {
      const result = await runCli(['safe', 'sign', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('-y, --yes');
    });

    it('accepts global --yes before safe sign', async () => {
      const result = await runCli(['--yes', 'safe', 'sign', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: eth-valctl safe sign');
      expect(result.stderr).not.toContain("unknown option '--yes'");
    });

    it('does not expose safe execute specific --yes or max fee wait options', async () => {
      const result = await runCli(['safe', 'execute', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('-y, --yes');
      expect(result.stdout).not.toContain('--max-fee-wait-blocks');
    });

    it('accepts global wait budget before safe execute', async () => {
      const result = await runCli([
        '--max-request-fee-wait-blocks',
        '0',
        'safe',
        'execute',
        '--help'
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: eth-valctl safe execute');
      expect(result.stderr).not.toContain("unknown option '--max-request-fee-wait-blocks'");
    });

    it('accepts the -w wait budget alias before safe execute', async () => {
      const result = await runCli(['-w', '0', 'safe', 'execute', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: eth-valctl safe execute');
    });
  });
});
