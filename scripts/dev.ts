const commands = [
  {
    name: "api",
    command: ["bun", "--watch", "src/server.ts"],
  },
  {
    name: "web",
    command: ["bun", "run", "--cwd", "packages/frontend", "dev"],
  },
];

const children = commands.map(({ name, command }) => {
  const child = Bun.spawn(command, {
    env: { ...Bun.env, NODE_ENV: "development" },
    stdout: "pipe",
    stderr: "pipe",
  });

  pipeOutput(name, child.stdout);
  pipeOutput(name, child.stderr);

  return child;
});

function pipeOutput(name: string, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  async function read() {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (line.trim()) console.log(`[${name}] ${line}`);
      }
    }
  }

  read();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const child of children) {
      child.kill(signal);
    }
    process.exit(0);
  });
}

const results = await Promise.all(children.map((child) => child.exited));
const failed = results.find((code) => code !== 0);
process.exit(failed ?? 0);
