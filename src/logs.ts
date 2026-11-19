import type { GraphQLClient } from "./client";

const LOGS_QUERY = `query($stack: ID!, $run: ID!, $state: RunState!, $stateVersion: Int, $token: String) {
  stack(id: $stack) { run(id: $run) { logs(state: $state, stateVersion: $stateVersion, token: $token, sanitize: true) {
    messages { message } hasMore nextToken finished
  } } }
}`;

interface LogsData {
  stack: { run: { logs: { messages: { message: string }[]; hasMore: boolean; nextToken: string | null; finished: boolean } | null } };
}

export async function fetchLogs(
  client: Pick<GraphQLClient, "request">,
  stack: string,
  run: string,
  state: string,
  stateVersion?: number,
): Promise<{ text: string; finished: boolean }> {
  const lines: string[] = [];
  let token: string | null = null;
  for (;;) {
    const data: LogsData = await client.request<LogsData>(LOGS_QUERY, { stack, run, state, stateVersion, token });
    const logs = data.stack.run.logs;
    if (!logs) {
      return { text: lines.length ? lines.join("\n") : `No logs for state ${state}.`, finished: true };
    }
    lines.push(...logs.messages.map((m) => m.message));
    if (!logs.hasMore || !logs.nextToken) {
      return { text: lines.join("\n"), finished: logs.finished };
    }
    token = logs.nextToken;
  }
}
