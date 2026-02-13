import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  isAddress,
  parseUnits,
} from "viem";

const commerceCheckoutAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "quoteSplit",
    inputs: [{ name: "baseAmount", type: "uint256" }],
    outputs: [
      { name: "grossAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "merchantNetAmount", type: "uint256" },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "purchase",
    inputs: [
      { name: "productId", type: "string" },
      { name: "merchant", type: "address" },
      { name: "baseAmount", type: "uint256" },
    ],
    outputs: [
      { name: "grossAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "merchantNetAmount", type: "uint256" },
    ],
  },
] as const;

type SettleBody = {
  intentId?: string;
  productId?: string;
  merchant?: string;
  buyer?: string;
  merchantNetAmount?: string;
};

const parsePrivateKey = (value: string): `0x${string}` => {
  const v = value.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(v)) return v as `0x${string}`;
  if (/^[a-fA-F0-9]{64}$/.test(v)) return `0x${v}` as `0x${string}`;
  throw new Error("invalid AGENT_WALLET_PRIVATE_KEY");
};

export async function POST(request: NextRequest) {
  try {
    const configuredApiKey = process.env.COMMERCE_CHECKOUT_SETTLE_API_KEY?.trim() ?? "";
    if (configuredApiKey) {
      const incoming = request.headers.get("x-checkout-api-key") ?? "";
      if (incoming !== configuredApiKey) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const body = (await request.json().catch(() => ({}))) as SettleBody;
    const productId = String(body.productId ?? "").trim();
    const merchant = String(body.merchant ?? "").trim();
    const merchantNetAmount = String(body.merchantNetAmount ?? "").trim();

    if (!productId || !merchant || !merchantNetAmount) {
      return NextResponse.json(
        { ok: false, error: "productId, merchant, merchantNetAmount are required" },
        { status: 400 },
      );
    }
    if (!isAddress(merchant)) {
      return NextResponse.json({ ok: false, error: "invalid merchant address" }, { status: 400 });
    }

    const checkoutAddress =
      (process.env.COMMERCE_CHECKOUT_ADDRESS ?? "").trim() ||
      (process.env.NEXT_PUBLIC_COMMERCE_CHECKOUT_ADDRESS ?? "").trim();
    const tokenAddress = (process.env.COMMERCE_USDC_ADDRESS ?? "").trim();
    const privateKeyRaw = (process.env.AGENT_WALLET_PRIVATE_KEY ?? "").trim();
    const rpcUrl =
      (process.env.BASE_SEPOLIA_RPC_URL ?? "").trim() ||
      (process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "").trim() ||
      "https://base-sepolia-rpc.publicnode.com";

    if (!isAddress(checkoutAddress)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "COMMERCE_CHECKOUT_ADDRESS is required (or set NEXT_PUBLIC_COMMERCE_CHECKOUT_ADDRESS)",
        },
        { status: 500 },
      );
    }
    if (!isAddress(tokenAddress)) {
      return NextResponse.json(
        { ok: false, error: "COMMERCE_USDC_ADDRESS is required" },
        { status: 500 },
      );
    }
    if (!privateKeyRaw) {
      return NextResponse.json(
        { ok: false, error: "AGENT_WALLET_PRIVATE_KEY is required" },
        { status: 500 },
      );
    }

    const privateKey = parsePrivateKey(privateKeyRaw);
    const account = privateKeyToAccount(privateKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });

    const baseUnits = parseUnits(merchantNetAmount, 6);
    const [grossAmount, feeAmount, merchantNetQuoted] = await publicClient.readContract({
      address: checkoutAddress as `0x${string}`,
      abi: commerceCheckoutAbi,
      functionName: "quoteSplit",
      args: [baseUnits],
    });

    const allowance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, checkoutAddress as `0x${string}`],
    });
    if (allowance < grossAmount) {
      return NextResponse.json(
        {
          ok: false,
          error: "insufficient checkout allowance",
          requiredGrossUnits: grossAmount.toString(),
          currentAllowanceUnits: allowance.toString(),
          hint: "Approve COMMERCE_CHECKOUT_ADDRESS from AGENT_WALLET_ADDRESS for USDC first.",
        },
        { status: 400 },
      );
    }

    const hash = await walletClient.writeContract({
      address: checkoutAddress as `0x${string}`,
      abi: commerceCheckoutAbi,
      functionName: "purchase",
      args: [productId, merchant as `0x${string}`, baseUnits],
      chain: baseSepolia,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({
      ok: true,
      settlementTxHash: hash,
      quoted: {
        grossAmount: grossAmount.toString(),
        feeAmount: feeAmount.toString(),
        merchantNetAmount: merchantNetQuoted.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `checkout settle failed: ${String(error)}` },
      { status: 500 },
    );
  }
}
