export class JournalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalConflictError";
  }
}
