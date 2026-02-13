type ProductIdInput = {
  merchant: string;
  title: string;
  category: string;
};

const cleanSegment = (value: string, fallback: string): string => {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 8);
};

const checksum = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).toUpperCase();
};

export const generateSkuProductId = (
  input: ProductIdInput,
): string => {
  const merchantPart = cleanSegment(input.merchant.replace(/^0x/i, ""), "MERCHANT");
  const titlePart = cleanSegment(input.title, "ITEM");
  const categoryPart = cleanSegment(input.category, "DIGITAL");
  const fingerprint = checksum(
    `${input.merchant.toLowerCase()}|${input.title.toLowerCase()}|${input.category.toLowerCase()}`,
  ).slice(0, 10);
  return `SKU_${merchantPart}_${categoryPart}_${titlePart}_${fingerprint}`;
};
