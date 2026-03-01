// src/observability/langfuse.ts
// Langfuse observability wrapper for the supervisor daemon.
// Self-hosted Langfuse: see docker-compose.yml
// Source: https://langfuse.com/docs/sdk/typescript/guide

import { Langfuse } from "langfuse";

// Lazily initialize — only if env vars are present
let _langfuse: Langfuse | null = null;

function getLangfuse(): Langfuse | null {
  if (_langfuse) return _langfuse;

  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const baseUrl = process.env.LANGFUSE_HOST;

  if (!secretKey || !publicKey) {
    console.warn(
      "[observability] LANGFUSE_SECRET_KEY or LANGFUSE_PUBLIC_KEY not set — tracing disabled"
    );
    return null;
  }

  _langfuse = new Langfuse({
    secretKey,
    publicKey,
    baseUrl: baseUrl ?? "http://localhost:3000",
  });

  return _langfuse;
}

export interface SupervisorTrace {
  span: (name: string, input?: Record<string, unknown>) => SupervisorSpan;
  end: (output?: Record<string, unknown>) => void;
}

export interface SupervisorSpan {
  end: (output?: Record<string, unknown>) => void;
}

/**
 * Create a top-level trace for a supervisor run.
 * Returns a no-op trace if Langfuse is not configured.
 */
export function createTrace(name: string, metadata?: Record<string, unknown>): SupervisorTrace {
  const lf = getLangfuse();

  if (!lf) {
    return {
      span: (_name) => ({ end: () => {} }),
      end: () => {},
    };
  }

  const trace = lf.trace({
    name,
    userId: "supervisor-bot",
    metadata,
  });

  return {
    span: (spanName, input) => {
      const s = trace.span({ name: spanName, input });
      return {
        end: (output) => s.end({ output }),
      };
    },
    end: (output) => trace.update({ output }),
  };
}

/**
 * Flush all pending traces before process exit.
 * Must be called at the end of every daemon run.
 */
export async function flushTraces(): Promise<void> {
  const lf = getLangfuse();
  if (lf) {
    await lf.flushAsync();
  }
}
