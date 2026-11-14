import { getUserId } from "@/lib/userId";

/** The `userId` to put in a request body: the anonymous browser id. There are no accounts. */
export function getRequestUserId(): string {
  return getUserId();
}
