import type { Response } from 'express';

// Tracks open SSE connections per channel (e.g. "game:ab12cd34" or "lobby").
// Each client brings its own render function, so one broadcast sends every
// viewer HTML that matches what they are allowed to see.

interface Client {
  res: Response;
  viewer: string | null;
  event: string;
  render: (viewer: string | null) => string;
}

const HEARTBEAT_MS = 15000;

const channels = new Map<string, Set<Client>>();

// SSE data lines must each start with "data:", so multi-line HTML is split.
const formatEvent = (event: string, data: string, id?: number): string => {
  const lines = data.split('\n').map((line) => {
    return `data: ${line}`;
  });
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  return `${idLine}event: ${event}\n${lines.join('\n')}\n\n`;
};

export const subscribe = (
  channel: string,
  res: Response,
  client: Omit<Client, 'res'>,
  version?: number,
): void => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const entry: Client = {
    res,
    ...client,
  };
  let clients = channels.get(channel);
  if (!clients) {
    clients = new Set<Client>();
    channels.set(channel, clients);
  }
  clients.add(entry);

  // Send a snapshot immediately, so a reconnecting client catches up on
  // anything it missed instead of needing a replay log.
  res.write(formatEvent(entry.event, entry.render(entry.viewer), version));

  // Comment lines keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(entry);
    if (clients.size === 0) {
      channels.delete(channel);
    }
  });
};

export const publish = (channel: string, version?: number): void => {
  const clients = channels.get(channel);
  if (!clients) {
    return;
  }
  for (const client of clients) {
    client.res.write(formatEvent(client.event, client.render(client.viewer), version));
  }
};

export const connectionCount = (channel: string): number => {
  return channels.get(channel)?.size ?? 0;
};
