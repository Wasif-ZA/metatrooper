export const E = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  ACU_REFUSED: -32001,
  NOT_FOUND: -32002,
  VALIDATION: -32003,
  GATE_STALE: -32010,
  PUBLISH_RULE: -32011,
  NEEDS_UI: -32012,
  ENGINE_UNAVAILABLE: -32020,
  PANE_NOT_OWNED: -32030,
  NAV_BLOCKED: -32031,
  CLOUD_UNAVAILABLE: -32040,
  INTERRUPTED: -32098,
  INTERNAL: -32099,
} as const;

export class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
  toJSON() {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

export function toRpcError(e: unknown): RpcError {
  if (e instanceof RpcError) return e;
  return new RpcError(E.INTERNAL, e instanceof Error ? e.message : String(e));
}
