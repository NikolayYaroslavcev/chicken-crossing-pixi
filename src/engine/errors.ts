export type EngineErrorCode =
  'INVALID_BET' | 'INVALID_DIFFICULTY' | 'INSUFFICIENT_BALANCE' | 'INVALID_STATE' | 'INVALID_STEP';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
