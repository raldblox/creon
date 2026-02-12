import { validateDecideInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleDecide: ActionHandler = (_runtime, input) => {
  const parsed = validateDecideInput(input);
  const allow = parsed.allow ?? true;
  const reasonCode = parsed.reasonCode ?? (allow ? "ALLOW" : "DENY");

  return {
    ok: allow,
    action: "decide",
    reasonCode,
    message: allow ? "decision allow" : "decision deny",
    data: parsed.context,
  };
};
