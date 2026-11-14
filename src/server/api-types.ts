import { z } from "zod";

export const DELIVERY_KINDS = ["local", "github"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

export const CreateRunInput = z
  .object({
    repo: z.string().trim().min(1).max(500),
    branch: z
      .string()
      .trim()
      .regex(BRANCH_RE, "branch may contain letters, digits, . _ - and /")
      .refine((b) => !b.includes("..") && !b.startsWith("-") && !b.endsWith("/"), "invalid branch name")
      .default("main"),
    instruction: z.string().trim().min(1).max(8000),
    delivery: z.enum(DELIVERY_KINDS).default("local"),
  })
  .strict();
export type CreateRunInput = z.infer<typeof CreateRunInput>;

export const FollowUpInput = z.object({ message: z.string().trim().min(1).max(8000) }).strict();

/** Errors the HTTP layer maps to status codes. Anything else is a 500. */
export class DomainError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 415,
    message: string,
  ) {
    super(message);
  }
}
