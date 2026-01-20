interface TargetConfig {
  name: string;
  bunTarget: string;
  outfile: string;
}

const targetMap: Record<string, TargetConfig> = {
  'linux-x64': {
    name: 'linux-x64',
    bunTarget: 'bun-linux-x64-modern',
    outfile: 'bin/eth-valctl-linux-x64'
  },
  'win-x64': {
    name: 'win-x64',
    bunTarget: 'bun-windows-x64-modern',
    outfile: 'bin/eth-valctl-win-x64.exe'
  },
  'macos-x64': {
    name: 'macos-x64',
    bunTarget: 'bun-darwin-x64-modern',
    outfile: 'bin/eth-valctl-macos-x64'
  },
  'linux-arm64': {
    name: 'linux-arm64',
    bunTarget: 'bun-linux-arm64',
    outfile: 'bin/eth-valctl-linux-arm64'
  },
  'macos-arm64': {
    name: 'macos-arm64',
    bunTarget: 'bun-darwin-arm64',
    outfile: 'bin/eth-valctl-macos-arm64'
  }
};

const allowedTargets = Object.keys(targetMap);

/**
 * Installs all platform-specific optional dependencies.
 *
 * This ensures native addons (like @chainsafe/blst) are available for all target platforms
 * before cross-compilation, allowing bun build --compile to bundle the correct .node files.
 */
async function installAllPlatformDependencies(): Promise<void> {
  console.log('Installing dependencies for all platforms...');
  const result = Bun.spawnSync(['bun', 'install', '--os', '*', '--cpu', '*'], {
    stdout: 'inherit',
    stderr: 'inherit'
  });

  if (result.exitCode !== 0) {
    console.error('Failed to install platform-specific dependencies');
    process.exit(result.exitCode);
  }

  console.log('✓ All platform dependencies installed\n');
}

async function buildTarget(config: TargetConfig): Promise<void> {
  console.log(`Building for ${config.name}...`);
  const result = Bun.spawnSync(
    [
      'bun',
      'build',
      '--compile',
      'src/cli/main.ts',
      '--outfile',
      config.outfile,
      '--target',
      config.bunTarget
    ],
    {
      stdout: 'inherit',
      stderr: 'inherit'
    }
  );

  if (result.exitCode !== 0) {
    console.error(`Failed to build for ${config.name}`);
    process.exit(result.exitCode);
  }

  console.log(`Successfully built ${config.outfile}`);
}

async function main(): Promise<void> {
  const targetArg = process.argv[2];
  if (targetArg && !allowedTargets.includes(targetArg)) {
    console.error(`Error: Invalid target "${targetArg}".`);
    console.error(`Allowed targets are: ${allowedTargets.join(', ')}`);
    process.exit(1);
  }
  const targetsToBuild = targetArg ? [targetMap[targetArg]] : Object.values(targetMap);
  console.log(
    targetArg
      ? `Building for target: ${targetArg}`
      : `Building for all targets: ${allowedTargets.join(', ')}`
  );

  await installAllPlatformDependencies();

  for (const config of targetsToBuild) {
    await buildTarget(config);
  }
  console.log('\n✓ Build completed successfully');
}

main();
