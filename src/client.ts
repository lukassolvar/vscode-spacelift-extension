export interface ClientDeps {
  endpoint: () => string;
  getToken: (refresh: boolean) => Promise<string>;
  fetch?: typeof fetch;
}

export interface GraphQLClient {
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export class SpaceliftClient implements GraphQLClient {
  constructor(private deps: ClientDeps) {}

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res = await this.send(query, variables, false);
    if (res.status === 401) {
      res = await this.send(query, variables, true);
    }
    if (!res.ok) {
      throw new Error(`Spacelift API returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    return body.data as T;
  }

  private async send(query: string, variables: Record<string, unknown>, refresh: boolean) {
    const endpoint = this.deps.endpoint().replace(/\/$/, "");
    if (!endpoint.startsWith("https://")) {
      throw new Error(`Spacelift endpoint must use https:// (got "${endpoint}").`);
    }
    const token = await this.deps.getToken(refresh);
    const doFetch = this.deps.fetch ?? fetch;
    return doFetch(`${endpoint}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
  }
}
