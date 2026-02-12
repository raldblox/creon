export const EntitlementRegistry = [
  {
    type: "function",
    stateMutability: "view",
    name: "hasEntitlement",
    inputs: [
      { name: "buyer", type: "address" },
      { name: "productId", type: "string" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "recordEntitlement",
    inputs: [
      { name: "buyer", type: "address" },
      { name: "productId", type: "string" },
    ],
    outputs: [],
  },
] as const;
