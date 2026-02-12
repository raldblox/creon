import { find } from "../integration/mongodb";
import { logStep } from "../lib/log";
import { validateRestoreInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleRestore: ActionHandler = (runtime, input) => {
  const parsed = validateRestoreInput(input);

  const product = find(runtime, {
    collection: "products",
    filter: { productId: parsed.productId },
    limit: 1,
  });

  if (product.documents.length === 0) {
    return {
      ok: false,
      action: "restore",
      reasonCode: "PRODUCT_NOT_FOUND",
      message: "product does not exist",
    };
  }

  const productStatus =
    typeof product.documents[0]?.status === "string"
      ? (product.documents[0].status as string)
      : "ACTIVE";

  if (productStatus === "BANNED") {
    return {
      ok: false,
      action: "restore",
      reasonCode: "RESTORE_DENIED_BANNED",
      message: "restore is denied for banned products",
    };
  }

  const entitlement = find(runtime, {
    collection: "entitlements",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    limit: 1,
  });
  logStep(runtime, "MONGODB", "restore entitlement lookup completed");

  if (entitlement.documents.length === 0) {
    return {
      ok: false,
      action: "restore",
      reasonCode: "NOT_OWNED",
      message: "buyer does not own this product",
    };
  }

  return {
    ok: true,
    action: "restore",
    reasonCode: "RESTORE_ALLOWED",
    message: "restore allowed",
    data: {
      buyer: parsed.buyer,
      productId: parsed.productId,
      status: productStatus,
    },
  };
};
