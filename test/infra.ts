export type RedisTestInfra = {
  client: {
    isOpen: boolean;
    connect: () => Promise<void>;
    quit: () => Promise<void>;
    flushAll: () => Promise<unknown>;
  };
  stop: () => Promise<void>;
  clear: () => Promise<void>;
};

export async function createRedisInfra(): Promise<RedisTestInfra> {
  const externalUrl = process.env.REDIS_URL;
  if (externalUrl) {
    const { createClient } = await import("redis");
    const client = createClient({ url: externalUrl });
    await client.connect();

    return {
      client,
      clear: async () => {
        await client.flushAll();
      },
      stop: async () => {
        await client.quit();
      },
    };
  }

  if (process.env.CI === "true") {
    throw new Error(
      "REDIS_URL must be set in CI. Configure a Redis service container in your workflow.",
    );
  }

  const { GenericContainer } = await import("testcontainers");
  const { createClient } = await import("redis");
  const container = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(6379);
  const client = createClient({ url: `redis://${host}:${port}` });
  await client.connect();

  return {
    client,
    clear: async () => {
      await client.flushAll();
    },
    stop: async () => {
      if (client.isOpen) {
        await client.quit();
      }
      await container.stop();
    },
  };
}
