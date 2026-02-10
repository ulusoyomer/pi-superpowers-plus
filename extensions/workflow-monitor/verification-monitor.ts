export interface VerificationViolation {
  type: "commit-without-verification" | "push-without-verification" | "pr-without-verification";
  command: string;
}

const COMMIT_RE = /\bgit\s+commit\b/;
const PUSH_RE = /\bgit\s+push\b/;
const PR_RE = /\bgh\s+pr\s+create\b/;

export class VerificationMonitor {
  private verified = false;

  recordVerification(): void {
    this.verified = true;
  }

  onSourceWritten(): void {
    this.verified = false;
  }

  hasRecentVerification(): boolean {
    return this.verified;
  }

  checkCommitGate(command: string): VerificationViolation | null {
    if (COMMIT_RE.test(command)) {
      return this.verified ? null : { type: "commit-without-verification", command };
    }
    if (PUSH_RE.test(command)) {
      return this.verified ? null : { type: "push-without-verification", command };
    }
    if (PR_RE.test(command)) {
      return this.verified ? null : { type: "pr-without-verification", command };
    }
    return null;
  }

  reset(): void {
    this.verified = false;
  }
}
