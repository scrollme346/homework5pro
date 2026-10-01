/** An error with a message written for the user and optional technical details. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    public details?: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Операция отменена.');
    this.name = 'CancelledError';
  }
}

export function toUserFacing(err: unknown, fallback: string): UserFacingError {
  if (err instanceof UserFacingError) return err;
  if (err instanceof CancelledError) return new UserFacingError(err.message, undefined, 'cancelled');
  const e = err as { message?: string; stack?: string; code?: string };
  if (e?.code === 'ENOSPC') return new UserFacingError('На диске закончилось место.', e.stack, 'ENOSPC');
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return new UserFacingError('Нет доступа к файлу или папке.', e.stack, e.code);
  if (e?.code === 'ENOENT') return new UserFacingError('Файл не найден. Возможно, он был перемещён или удалён.', e.stack, 'ENOENT');
  return new UserFacingError(fallback, e?.stack ?? e?.message ?? String(err));
}
