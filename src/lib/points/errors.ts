export type PointsErrorCode =
  | "POINTS_INSUFFICIENT"
  | "POINTS_REQUEST_LIMIT"
  | "POINTS_SELF_APPROVAL"
  | "POINTS_FORBIDDEN"
  | "POINTS_PERIOD_CLOSED"
  | "POINTS_NOT_FOUND"
  | "POINTS_INVALID_INPUT"
  | "POINTS_RESERVED_PENDING"
  | "POINTS_ALREADY_DECIDED";

const statusByCode: Record<PointsErrorCode, number> = {
  POINTS_INSUFFICIENT: 402,
  POINTS_REQUEST_LIMIT: 409,
  POINTS_SELF_APPROVAL: 403,
  POINTS_FORBIDDEN: 403,
  POINTS_PERIOD_CLOSED: 409,
  POINTS_NOT_FOUND: 404,
  POINTS_INVALID_INPUT: 400,
  POINTS_RESERVED_PENDING: 409,
  POINTS_ALREADY_DECIDED: 409,
};

export class PointsError extends Error {
  readonly code: PointsErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: PointsErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PointsError";
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}

export function isPointsError(error: unknown): error is PointsError {
  return error instanceof PointsError;
}

/** 把服务层异常转成 { error, code, status }，路由直接消费。 */
export function toPointsErrorPayload(error: unknown) {
  if (isPointsError(error)) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  return {
    status: 500,
    body: {
      error: error instanceof Error ? error.message : "积分服务异常。",
      code: "POINTS_INTERNAL" as const,
    },
  };
}
